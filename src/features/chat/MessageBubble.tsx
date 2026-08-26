import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  GitBranch,
  Layers,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Button,
  IconButton,
  TypingIndicator,
  chipClass,
  fieldClass,
} from "@/components/ui";
import {
  renderMarkdown,
  handleCodeBlockCopy,
  detectAiLinkClick,
} from "@/lib/ai/markdown-message";
import { promptOpenAiLink } from "@/lib/ai/ai-link-prompt";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { useReadAloud, markdownToSpeech } from "@/hooks/use-read-aloud";
import { extractRecommendations } from "@/lib/ai/extract-recommendations";
import { extractInlineQuiz } from "@/lib/ai/extract-quiz";
import { RecommendationCards } from "./RecommendationsRenderer";
import { InlineQuizCard } from "./InlineQuizCard";
import { openMenuAtButton } from "./menu-anchor";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/types/chat";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import {
  countBranches,
  childrenOf,
  pathFromRoot,
} from "@/stores/chat-store";
import { usePromptGalleryStore } from "@/stores/prompt-gallery-store";
import { showToast } from "@/stores/toast-store";

/** Confirm-modal handle threaded down from the parent's useConfirm. */
export type BubbleConfirmFn = (opts: {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

/**
 * Page citations ([p.42]) come out of renderMarkdown as `/reader/...`
 * anchors styled by the global `.ai-message a[href^="/reader/"]` rule
 * (which still carries a 1 px border). Override them here into the
 * neutral-language accent pill: the one accent on the screen.
 */
const CITATION_CHIP_CLASS = cn(
  "[&_a[href^='/reader/']]:inline-flex!",
  "[&_a[href^='/reader/']]:items-center",
  "[&_a[href^='/reader/']]:rounded-chip!",
  "[&_a[href^='/reader/']]:border-0!",
  "[&_a[href^='/reader/']]:bg-accent-soft!",
  "[&_a[href^='/reader/']]:px-2!",
  "[&_a[href^='/reader/']]:py-0.5!",
  "[&_a[href^='/reader/']]:text-xs!",
  "[&_a[href^='/reader/']]:font-medium!",
  "[&_a[href^='/reader/']]:leading-4!",
  "[&_a[href^='/reader/']]:align-middle",
  "[&_a[href^='/reader/']:hover]:bg-accent/25!",
);

interface MessageBubbleProps {
  msg: ChatMessage;
  messages: Map<string, ChatMessage>;
  activeLeafId: string | null;
  streamingMessageId: string | null;
  /** When set, citation tokens become clickable page links. */
  sourceDocId: string | null;
  confirm: BubbleConfirmFn;
  onBranchHere: () => void;
  onPickBranch: (id: string) => void;
  /** Open the flashcards extractor over this message's content. */
  onSaveAsFlashcards?: () => void;
  /** Regenerate assistant message as a sibling branch under its parent. */
  onRegenerate?: () => void;
  /** Edit-in-place for user messages, submits a new sibling branch. */
  onEdit?: (newText: string) => void;
  /** Delete this message and every descendant. Caller owns the confirm. */
  onDelete?: () => void;
  /** Fork the thread up to here into a new conversation. */
  onDuplicate?: () => void;
  /** Shared thread-level TTS controller so only one message speaks at a time. */
  tts: ReturnType<typeof useReadAloud>;
  /** Follow-up chips below the assistant bubble. */
  suggestions?: string[];
  onPickSuggestion?: (text: string) => void;
}

export function MessageBubble({
  msg,
  messages,
  activeLeafId,
  streamingMessageId,
  sourceDocId,
  confirm,
  onBranchHere,
  onPickBranch,
  onSaveAsFlashcards,
  onRegenerate,
  onEdit,
  onDelete,
  onDuplicate,
  tts,
  suggestions,
  onPickSuggestion,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  const isStreaming = msg.id === streamingMessageId;
  const anyStreaming = streamingMessageId !== null;
  const branches = countBranches(messages, msg.id);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);
  const handleCitationClick = usePageCitationDispatch();

  // Share this answer (+ its question) to the public prompt gallery.
  const shareAnswer = usePromptGalleryStore((s) => s.shareAnswer);
  const [shared, setShared] = useState(false);
  const handleShare = async () => {
    // question = the nearest ancestor user message
    let cur = msg.parent_message_id ? messages.get(msg.parent_message_id) : null;
    while (cur && cur.role !== "user") {
      cur = cur.parent_message_id
        ? messages.get(cur.parent_message_id) ?? null
        : null;
    }
    try {
      await shareAnswer({ question: cur?.content ?? "", answer: msg.content });
      setShared(true);
      showToast(
        t("chat.shareAnswer.done", {
          defaultValue: "Shared to the prompt gallery.",
        }),
        "success",
      );
    } catch {
      showToast(
        t("chat.shareAnswer.failed", {
          defaultValue: "Couldn't share this answer.",
        }),
        "error",
      );
    }
  };

  // which child of this message sits on the active path
  const activePath = pathFromRoot(messages, activeLeafId).map((m) => m.id);
  const children = childrenOf(messages, msg.id);
  const activeChildIndex = children.findIndex((c) => activePath.includes(c.id));

  const hasText = msg.content.trim().length > 0;
  const speaking = tts.speakingId === msg.id;

  // Collapse-to-short: long user messages start collapsed (Gemini-style),
  // assistant messages collapse on demand from the action row.
  const isLong = msg.content.length > 280;
  const [collapsed, setCollapsed] = useState(isUser && isLong);

  const submitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed.length > 0 && trimmed !== msg.content.trim() && onEdit) {
      onEdit(trimmed);
    }
    setIsEditing(false);
  };

  // secondary actions behind the per-message kebab
  const overflowItems = (): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [];
    if (!isUser && !isStreaming && hasText) {
      items.push({
        id: "share",
        label: shared
          ? t("chat.shareAnswer.shared", { defaultValue: "Shared" })
          : t("chat.shareAnswer.action", { defaultValue: "Share" }),
        icon: Share2,
        disabled: shared,
        onClick: () => void handleShare(),
      });
    }
    if (!isUser && !isStreaming && tts.supported && hasText) {
      items.push({
        id: "read-aloud",
        label: speaking ? t("chat.readAloudStop") : t("chat.readAloud"),
        icon: speaking ? VolumeX : Volume2,
        onClick: () => {
          if (speaking) tts.stop();
          else tts.read(msg.id, markdownToSpeech(msg.content));
        },
      });
    }
    if (
      !isUser &&
      !isStreaming &&
      msg.content.trim().length > 40 &&
      onSaveAsFlashcards
    ) {
      items.push({
        id: "flashcards",
        label: t("chat.flashcards.saveAction"),
        icon: Layers,
        onClick: onSaveAsFlashcards,
      });
    }
    if (onDuplicate && !isStreaming) {
      if (items.length > 0) items.push({ id: "div-dup", divider: true });
      items.push({
        id: "duplicate",
        label: t("chat.duplicateFromHere", {
          defaultValue: "Duplicate from here",
        }),
        icon: Copy,
        disabled: anyStreaming,
        onClick: onDuplicate,
      });
    }
    if (onDelete && !isStreaming) {
      items.push({
        id: "delete",
        label: t("chat.deleteMessage", { defaultValue: "Delete" }),
        icon: Trash2,
        danger: true,
        disabled: anyStreaming,
        onClick: onDelete,
      });
    }
    return items;
  };

  const actionRow = !isEditing && !isStreaming && (
    <div
      className={cn(
        "-ml-1 flex items-center gap-0.5 text-text-muted transition-opacity",
        "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        isUser && "justify-end",
      )}
    >
      {!isUser && hasText && <CopyButton text={msg.content} />}
      {!isUser && hasText && isLong && (
        <IconButton
          size="sm"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={
            collapsed
              ? t("chat.expandMessage", { defaultValue: "Expand message" })
              : t("chat.collapseMessage", { defaultValue: "Collapse message" })
          }
          title={
            collapsed
              ? t("chat.expandMessage", { defaultValue: "Expand message" })
              : t("chat.collapseMessage", { defaultValue: "Collapse message" })
          }
        >
          {collapsed ? (
            <ChevronDown size={16} strokeWidth={1.5} />
          ) : (
            <ChevronUp size={16} strokeWidth={1.5} />
          )}
        </IconButton>
      )}
      {isUser && onEdit && (
        <IconButton
          size="sm"
          disabled={anyStreaming}
          onClick={() => {
            setEditText(msg.content);
            setIsEditing(true);
          }}
          aria-label={t("chat.editAction")}
          title={t("chat.editAction")}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      {!isUser && onRegenerate && (
        <IconButton
          size="sm"
          disabled={anyStreaming}
          onClick={onRegenerate}
          aria-label={t("chat.regenerate")}
          title={t("chat.regenerate")}
        >
          <RefreshCw size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      <IconButton
        size="sm"
        onClick={onBranchHere}
        aria-label={t("chat.branchHere")}
        title={t("chat.branchHere")}
      >
        <GitBranch size={16} strokeWidth={1.5} />
      </IconButton>
      {overflowItems().length > 0 && (
        <IconButton
          size="sm"
          onClick={(e) => openMenuAtButton(e, overflowItems())}
          aria-label={t("chat.messageActions")}
          title={t("chat.messageActions")}
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </IconButton>
      )}
    </div>
  );

  // branch switcher: small pager, always visible when this turn has siblings
  const branchPager = branches > 1 && (
    <div
      className={cn(
        "flex items-center gap-0.5 text-2xs tabular-nums text-text-muted",
        isUser && "justify-end",
      )}
      role="group"
      aria-label={t("chat.branchesCount", { count: branches })}
    >
      <IconButton
        size="sm"
        disabled={activeChildIndex <= 0}
        onClick={() => onPickBranch(children[activeChildIndex - 1].id)}
        aria-label={t("chat.branchPrev")}
        title={t("chat.branchPrev")}
      >
        <ChevronLeft size={16} strokeWidth={1.5} />
      </IconButton>
      <span>
        {Math.max(activeChildIndex, 0) + 1} / {children.length}
      </span>
      <IconButton
        size="sm"
        disabled={activeChildIndex >= children.length - 1}
        onClick={() => onPickBranch(children[activeChildIndex + 1].id)}
        aria-label={t("chat.branchNext")}
        title={t("chat.branchNext")}
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );

  const attachments = msg.attachments && msg.attachments.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {msg.attachments.map((att, idx) =>
        att.kind === "image" ? (
          <a
            key={idx}
            href={`data:${att.media_type};base64,${att.data}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
            title={att.name ?? ""}
          >
            <img
              src={`data:${att.media_type};base64,${att.data}`}
              alt={att.name ?? (isUser ? "attachment" : "generated image")}
              className={cn(
                "max-w-full rounded-control object-cover",
                isUser ? "max-h-48" : "max-h-96 object-contain",
              )}
            />
          </a>
        ) : null,
      )}
    </div>
  );

  if (isUser) {
    return (
      <div className="group flex w-full justify-end">
        <div className="flex min-w-0 max-w-[560px] flex-col items-end gap-1.5">
          {isEditing ? (
            // save branches a sibling under the same parent, original stays in the picker
            <div className="flex w-full flex-col gap-2">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditText(msg.content);
                    setIsEditing(false);
                  }
                }}
                rows={Math.min(8, Math.max(2, msg.content.split("\n").length))}
                aria-label={t("chat.editAction")}
                className={cn(fieldClass, "block resize-none text-[15px]")}
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditText(msg.content);
                    setIsEditing(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={submitEdit}
                  disabled={
                    !editText.trim() ||
                    editText.trim() === msg.content.trim()
                  }
                >
                  {t("chat.editSaveAndSend")}
                </Button>
              </div>
            </div>
          ) : (
            <div
              // collapsed: the whole bubble is a click target to expand
              onClick={collapsed ? () => setCollapsed(false) : undefined}
              className={cn(
                "relative flex min-w-0 max-w-full flex-col gap-2 rounded-[18px] rounded-br-[4px] bg-bg-tertiary px-4 py-3 text-[15px] leading-normal text-text-primary",
                isLong && "pr-10",
                collapsed && "cursor-pointer",
              )}
            >
              {attachments}
              {msg.content && (
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    collapsed && "max-h-[4.55rem] overflow-hidden",
                  )}
                >
                  {msg.content}
                </div>
              )}
              {isLong && (
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-expanded={!collapsed}
                  aria-label={
                    collapsed
                      ? t("chat.expandMessage", { defaultValue: "Expand message" })
                      : t("chat.collapseMessage", {
                          defaultValue: "Collapse message",
                        })
                  }
                  className="absolute right-2 top-2.5 rounded-full p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
                >
                  <ChevronDown
                    size={16}
                    strokeWidth={1.5}
                    className={cn("transition-transform", !collapsed && "rotate-180")}
                  />
                </button>
              )}
            </div>
          )}
          {actionRow}
          {branchPager}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full max-w-[720px]">
      <div className="flex min-w-0 flex-1 flex-col gap-3 text-[15px] leading-normal text-text-primary">
        {isStreaming && !hasText ? (
          // placeholder while waiting for the first delta: three dots, nothing else
          <div className="text-text-muted">
            <TypingIndicator />
          </div>
        ) : (
          <>
            {/* attachments above the markdown so the image reads first */}
            {attachments}
            {msg.content && (
              <div
                // collapsed: clicking anywhere on the clamped body expands
                onClick={collapsed ? () => setCollapsed(false) : undefined}
                className={cn(
                  "relative",
                  collapsed && "max-h-24 cursor-pointer overflow-hidden",
                )}
              >
                <AssistantContent
                  content={msg.content}
                  isStreaming={isStreaming}
                  sourceDocId={sourceDocId}
                  confirm={confirm}
                  handleCitationClick={handleCitationClick}
                />
                {collapsed && (
                  <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    aria-label={t("chat.expandMessage", {
                      defaultValue: "Expand message",
                    })}
                    className="absolute inset-x-0 bottom-0 h-12 cursor-pointer bg-gradient-to-b from-transparent to-bg-secondary"
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* follow-up chips, hidden once the user has already replied (branches === 0) */}
        {!isStreaming &&
          suggestions &&
          suggestions.length > 0 &&
          branches === 0 &&
          onPickSuggestion && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPickSuggestion(q)}
                  disabled={anyStreaming}
                  className={cn(
                    chipClass,
                    "whitespace-normal px-3 py-[7px] text-left text-[13px] leading-4 transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

        {actionRow}
        {branchPager}
      </div>
    </div>
  );
}

// throttle markdown re-parse during streaming so KaTeX/DOMPurify don't run per token
const STREAM_RENDER_THROTTLE_MS = 50;

const AssistantContent = memo(function AssistantContent({
  content,
  isStreaming,
  sourceDocId,
  confirm,
  handleCitationClick,
}: {
  content: string;
  isStreaming: boolean;
  sourceDocId: string | null;
  confirm: BubbleConfirmFn;
  handleCitationClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // throttle the rendered value while streaming; flush immediately once it stops
  const [throttled, setThrottled] = useState(content);
  // latest content, so the trailing timer flushes the freshest value
  const contentRef = useRef(content);
  contentRef.current = content;
  const lastFlushRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // final flush so no stale truncated body lingers
      setThrottled(content);
      return;
    }
    if (content === throttled) return;
    // A debounce resets its timer on every delta, so a fast, gapless stream
    // never flushes until it pauses, the text then arrives in lurches. Use a
    // real throttle instead: flush immediately when the interval has elapsed,
    // otherwise let a single trailing timer fire on schedule.
    const now = performance.now();
    const elapsed = now - lastFlushRef.current;
    if (elapsed >= STREAM_RENDER_THROTTLE_MS) {
      lastFlushRef.current = now;
      setThrottled(content);
    } else if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        lastFlushRef.current = performance.now();
        setThrottled(contentRef.current);
      }, STREAM_RENDER_THROTTLE_MS - elapsed);
    }
  }, [content, isStreaming, throttled]);

  // quiz fence first (also strips a mid-stream open fence), then the
  // recommendation fences on what's left
  const quizExtract = useMemo(() => extractInlineQuiz(throttled), [throttled]);
  const { cleaned, books, videos } = useMemo(
    () => extractRecommendations(quizExtract.cleaned),
    [quizExtract.cleaned],
  );
  // expensive marked.parse -> KaTeX -> DOMPurify, memoized on (cleaned, sourceDocId)
  const html = useMemo(
    () => renderMarkdown(cleaned, sourceDocId),
    [cleaned, sourceDocId],
  );
  return (
    <>
      <div
        className={cn("ai-message break-words", CITATION_CHIP_CLASS)}
        onClick={(e) => {
          handleCodeBlockCopy(e);
          if (e.defaultPrevented) return;
          const aiLink = detectAiLinkClick(e);
          if (aiLink) {
            void promptOpenAiLink(aiLink, confirm, t);
            return;
          }
          // relative in-app links go through the SPA router, not a full reload
          const anchor = (e.target as HTMLElement)?.closest?.("a");
          const href = anchor?.getAttribute("href");
          if (href && href.startsWith("/") && !href.startsWith("//")) {
            e.preventDefault();
            navigate(href);
            return;
          }
          handleCitationClick(e);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(books || videos) && (
        <RecommendationCards books={books} videos={videos} />
      )}
      {quizExtract.pending && (
        <div className="flex items-center gap-2 rounded-panel bg-bg-tertiary px-4 py-3 text-xs text-text-muted">
          <TypingIndicator />
          {t("chat.inlineQuiz.incoming", { defaultValue: "Building your quiz…" })}
        </div>
      )}
      {quizExtract.quiz && <InlineQuizCard quiz={quizExtract.quiz} />}
    </>
  );
});

/** Quiet icon copy button; flips to a check for 1.5 s after copying. */
export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked, surface it instead of failing silently
      showToast(t("chat.copy.failed"), "error");
    }
  };
  const label = copied ? t("chat.copy.copied") : t("chat.copy.action");
  return (
    <IconButton
      size="sm"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={cn(copied && "text-success")}
    >
      {copied ? (
        <Check size={16} strokeWidth={1.5} />
      ) : (
        <Copy size={16} strokeWidth={1.5} />
      )}
    </IconButton>
  );
}
