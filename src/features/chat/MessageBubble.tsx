import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  GitBranch,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import { TypingIndicator } from "@/components/ui";
import {
  renderMarkdown,
  handleCodeBlockCopy,
  detectAiLinkClick,
} from "@/lib/ai/markdown-message";
import { promptOpenAiLink } from "@/lib/ai/ai-link-prompt";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { useReadAloud, markdownToSpeech } from "@/hooks/use-read-aloud";
import { extractRecommendations } from "@/lib/ai/extract-recommendations";
import { RecommendationCards } from "./RecommendationsRenderer";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/types/chat";
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
  const branches = countBranches(messages, msg.id);
  const [showBranches, setShowBranches] = useState(false);
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
  const activeChildId = childrenOf(messages, msg.id).find((c) =>
    activePath.includes(c.id),
  )?.id;

  return (
    <div
      className={cn(
        "group flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          // min-w-0 lets content shrink below its intrinsic width; without it a
          // wide code block/table blows past the width and scrolls sideways.
          "min-w-0 text-sm",
          isUser
            // the user's question keeps a bubble
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-accent/20 px-3.5 py-2 text-text-primary backdrop-blur-md"
            // assistant answer: no bubble, full width (Gemini-style) so long
            // answers get the whole panel instead of an 85% pill
            : "w-full text-text-primary",
        )}
      >
        {/* User text is preformatted; assistant text goes through marked + DOMPurify. */}
        {isUser ? (
          isEditing ? (
            // save branches a sibling under the same parent, original stays in the picker
            <div className="space-y-2">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const trimmed = editText.trim();
                    if (
                      trimmed.length > 0 &&
                      trimmed !== msg.content.trim() &&
                      onEdit
                    ) {
                      onEdit(trimmed);
                    }
                    setIsEditing(false);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditText(msg.content);
                    setIsEditing(false);
                  }
                }}
                rows={Math.min(8, Math.max(2, msg.content.split("\n").length))}
                className="block w-full resize-none rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60"
              />
              <div className="flex justify-end gap-1.5 text-2xs">
                <button
                  type="button"
                  onClick={() => {
                    setEditText(msg.content);
                    setIsEditing(false);
                  }}
                  className="rounded px-2 py-0.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = editText.trim();
                    if (
                      trimmed.length > 0 &&
                      trimmed !== msg.content.trim() &&
                      onEdit
                    ) {
                      onEdit(trimmed);
                    }
                    setIsEditing(false);
                  }}
                  disabled={
                    !editText.trim() ||
                    editText.trim() === msg.content.trim()
                  }
                  className="rounded bg-accent/80 px-2 py-0.5 font-medium text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                >
                  {t("chat.editSaveAndSend")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {msg.attachments && msg.attachments.length > 0 && (
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
                          alt={att.name ?? "attachment"}
                          className="max-h-48 max-w-full rounded-md object-cover"
                        />
                      </a>
                    ) : null,
                  )}
                </div>
              )}
              {msg.content && (
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>
          )
        ) : isStreaming && msg.content.trim().length === 0 ? (
          // placeholder while waiting for the first delta
          <div className="text-text-muted">
            <TypingIndicator label={t("chat.thinking", { defaultValue: "Thinking…" })} />
          </div>
        ) : (
          <div className="space-y-2">
            {/* attachments above the markdown so the image reads first */}
            {msg.attachments && msg.attachments.length > 0 && (
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
                        alt={att.name ?? "generated image"}
                        className="max-h-96 max-w-full rounded-md object-contain"
                      />
                    </a>
                  ) : null,
                )}
              </div>
            )}
            {msg.content && (
              <AssistantContent
                content={msg.content}
                isStreaming={isStreaming}
                sourceDocId={sourceDocId}
                confirm={confirm}
                handleCitationClick={handleCitationClick}
              />
            )}
          </div>
        )}

        {/* Actions: visible on hover or when there are branches */}
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-2xs text-text-muted transition-opacity",
            branches > 1 || showBranches
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            onClick={onBranchHere}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            title={t("chat.branchHere")}
          >
            <GitBranch size={10} />
            {t("chat.branchHere")}
          </button>
          {/* fork the thread up to here into a new conversation */}
          {onDuplicate && !isStreaming && (
            <button
              onClick={onDuplicate}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.duplicateFromHere", {
                defaultValue:
                  "Duplicate as new conversation from this point",
              })}
            >
              <Copy size={10} />
              {t("chat.duplicateFromHere", {
                defaultValue: "Duplicate from here",
              })}
            </button>
          )}
          {/* delete this message and its descendants */}
          {onDelete && !isStreaming && (
            <button
              onClick={onDelete}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.deleteMessage", {
                defaultValue: "Delete message + descendants",
              })}
            >
              <Trash2 size={10} />
              {t("chat.deleteMessage", {
                defaultValue: "Delete",
              })}
            </button>
          )}
          {/* edit, user messages only */}
          {isUser && !isStreaming && onEdit && !isEditing && (
            <button
              onClick={() => {
                setEditText(msg.content);
                setIsEditing(true);
              }}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.editAction")}
            >
              <Pencil size={10} />
              {t("chat.editAction")}
            </button>
          )}
          {/* copy, assistant messages only, hidden mid-stream */}
          {!isUser && !isStreaming && msg.content.trim().length > 0 && (
            <CopyButton text={msg.content} />
          )}
          {/* share to the public prompt gallery, assistant only */}
          {!isUser && !isStreaming && msg.content.trim().length > 0 && (
            <button
              onClick={handleShare}
              disabled={shared}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              title={t("chat.shareAnswer.action", {
                defaultValue: "Share this answer to the gallery",
              })}
            >
              <Share2 size={10} />
              {shared
                ? t("chat.shareAnswer.shared", { defaultValue: "Shared" })
                : t("chat.shareAnswer.action", { defaultValue: "Share" })}
            </button>
          )}
          {/* regenerate, assistant messages only */}
          {!isUser && !isStreaming && onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.regenerate")}
            >
              <RefreshCw size={10} />
              {t("chat.regenerate")}
            </button>
          )}
          {/* read aloud, only when Web Speech API is supported and stream is done */}
          {!isUser && !isStreaming && tts.supported && msg.content.trim() && (
            <button
              onClick={() => {
                if (tts.speakingId === msg.id) {
                  tts.stop();
                } else {
                  tts.read(msg.id, markdownToSpeech(msg.content));
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer",
                tts.speakingId === msg.id && "text-accent",
              )}
              title={
                tts.speakingId === msg.id
                  ? t("chat.readAloudStop")
                  : t("chat.readAloud")
              }
            >
              <Volume2 size={10} />
              {tts.speakingId === msg.id
                ? t("chat.readAloudStop")
                : t("chat.readAloud")}
            </button>
          )}
          {/* save-as-flashcards, assistant messages only, after the stream ends */}
          {!isUser &&
            !isStreaming &&
            msg.content.trim().length > 40 &&
            onSaveAsFlashcards && (
              <button
                onClick={onSaveAsFlashcards}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                title={t("chat.flashcards.saveAction")}
              >
                <Sparkles size={10} />
                {t("chat.flashcards.saveAction")}
              </button>
            )}
          {branches > 1 && (
            <button
              onClick={() => setShowBranches((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              {t("chat.branchesCount", { count: branches })}
            </button>
          )}
        </div>

        {/* Branch switcher */}
        {showBranches && branches > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {childrenOf(messages, msg.id).map((child, i) => {
              const isActiveChild = child.id === activeChildId;
              return (
                <button
                  key={child.id}
                  onClick={() => onPickBranch(child.id)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-2xs transition-colors cursor-pointer",
                    isActiveChild
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-glass-border text-text-muted hover:border-accent/40 hover:text-text-primary",
                  )}
                  title={child.content.slice(0, 80)}
                >
                  {t("chat.branchN", { n: i + 1 })}
                </button>
              );
            })}
          </div>
        )}

        {/* follow-up chips, hidden once the user has already replied (branches === 0) */}
        {!isUser &&
          !isStreaming &&
          suggestions &&
          suggestions.length > 0 &&
          branches === 0 &&
          onPickSuggestion && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onPickSuggestion(q)}
                  disabled={streamingMessageId !== null}
                  className="inline-flex items-center rounded-full border border-glass-border bg-glass-bg/40 px-2.5 py-1 text-2xs text-text-secondary transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
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

  const { cleaned, books, videos } = useMemo(
    () => extractRecommendations(throttled),
    [throttled],
  );
  // expensive marked.parse -> KaTeX -> DOMPurify, memoized on (cleaned, sourceDocId)
  const html = useMemo(
    () => renderMarkdown(cleaned, sourceDocId),
    [cleaned, sourceDocId],
  );
  return (
    <>
      <div
        className="ai-message break-words"
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
    </>
  );
});

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
      window.alert(t("chat.copy.failed"));
    }
  };
  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title={copied ? t("chat.copy.copied") : t("chat.copy.action")}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? t("chat.copy.copied") : t("chat.copy.action")}
    </button>
  );
}
