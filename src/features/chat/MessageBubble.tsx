import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  GitBranch,
  Pencil,
  RefreshCw,
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

/**
 * Shared confirm-modal shape — both ChatPage and AiChatPanel build
 * their own with useConfirm and thread the returned `confirm` fn
 * down to MessageBubble. The bubble itself doesn't pin the modal
 * (it doesn't render the JSX mount); it just calls confirm() and
 * awaits the answer for the AI-link guard.
 */
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
  /** Set when the conversation has a source doc — citation tokens
   *  in assistant messages get post-processed into clickable links. */
  sourceDocId: string | null;
  /** Parent's `useConfirm` handle, threaded down so the AI-link
   *  warning modal can reuse the page-level confirm dialog. */
  confirm: BubbleConfirmFn;
  onBranchHere: () => void;
  onPickBranch: (id: string) => void;
  /** Open the flashcards extractor over this message's content. */
  onSaveAsFlashcards?: () => void;
  /** Regenerate this assistant message — re-runs its parent user
   *  message as a sibling branch. Undefined for user messages and
   *  while another stream is in flight. */
  onRegenerate?: () => void;
  /** Edit-in-place for user messages — submits a fresh sibling
   *  branch with the new text under the same parent. Undefined for
   *  assistant messages and while another stream is in flight. */
  onEdit?: (newText: string) => void;
  /** Trim this message and every descendant out of the
   *  conversation. Confirm modal is the caller's responsibility;
   *  the bubble just renders the trigger. */
  onDelete?: () => void;
  /** Fork the conversation from this message into a fresh new
   *  conversation, preserving the original. */
  onDuplicate?: () => void;
  /** Shared TTS controller from the parent — single utterance lives
   *  at the thread level so starting a read on one message stops
   *  whatever was already speaking. */
  tts: ReturnType<typeof useReadAloud>;
  /** Optional follow-up question chips rendered below the assistant
   *  bubble. Populated by `requestFollowupSuggestions` after the
   *  turn settles; absent for user messages and for assistant
   *  messages whose response was too short / errored / aborted. */
  suggestions?: string[];
  /** Click handler for a suggestion chip — sends it as a new user
   *  message branched from the current assistant. */
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

  // Which child of this message is on the active path (if any)?
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
          // backdrop-blur frosts whatever drifts behind (the chat
          // aurora) so text stays legible and the bubble reads as a
          // pane of glass floating over the light rather than a flat
          // fill. The hairline border gives the glass an edge.
          // min-w-0 lets the bubble shrink below its content's intrinsic
          // width (flex items default to min-width:auto). Without it a wide
          // code block or table forces the bubble past max-w-[85%] and the
          // whole conversation scrolls sideways on mobile.
          "min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm backdrop-blur-md",
          isUser
            ? "bg-accent/20 text-text-primary rounded-br-md"
            : "border border-glass-border bg-glass-bg text-text-secondary rounded-bl-md",
          // Slightly taller while still empty so the typing indicator
          // sits comfortably; collapses back to py-2 once content is
          // streaming.
          isStreaming && msg.content.trim().length === 0 && "py-3",
        )}
      >
        {/* User messages render as preformatted text (the user typed
            them — no need to interpret markdown). Assistant messages
            go through marked + DOMPurify so code blocks, tables,
            lists, headings, and inline code all render properly. */}
        {isUser ? (
          isEditing ? (
            // Edit-in-place: textarea pre-filled with the original
            // content. Save = `onEdit` → branchFrom under the same
            // parent → fresh sibling branch + new assistant reply.
            // Original message stays accessible via the branch picker.
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
          // Empty assistant placeholder while waiting for the first
          // delta. Showing the typing indicator inside the bubble
          // beats pulsing an empty rectangle — that read as
          // "something's broken" on mobile where the bubble is
          // otherwise just a thin sliver.
          <div className="text-text-muted">
            <TypingIndicator label={t("chat.thinking", { defaultValue: "Thinking…" })} />
          </div>
        ) : (
          <div className="space-y-2">
            {/* Generated image (or any other attachment a future
                tool might emit) on an assistant turn. Rendered
                above the markdown so the image is the visual focal
                point and any caption/explanation reads below it. */}
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
          {/* Duplicate from here — creates a fresh conversation
              that mirrors the thread up to and including this
              message. Lets the user explore a different direction
              without losing the original. */}
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
          {/* Delete this message + everything underneath it.
              Confirm modal sits in the parent because it owns the
              useConfirm hook. */}
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
          {/* Edit: user messages only. Flips the bubble into a
              textarea; on save it branches a sibling under the same
              parent so the original message stays accessible via
              the branch picker. */}
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
          {/* Copy: assistant messages only (the user can already
              re-read what they typed; copying their own message is
              a niche need we can add later). Stays disabled while
              streaming so we don't capture a partial response. */}
          {!isUser && !isStreaming && msg.content.trim().length > 0 && (
            <CopyButton text={msg.content} />
          )}
          {/* Regenerate: assistant messages only, parent user msg
              must still exist in the tree (it does unless the
              conversation was edited externally). Disabled while
              another stream is in flight to avoid stacking turns. */}
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
          {/* Read aloud: assistant messages only, only when the Web
              Speech API is supported, only after streaming finishes
              (don't read a half-complete sentence). Toggles to Stop
              while the same message is speaking. */}
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
          {/* Save-as-flashcards: only on assistant messages, only
              once the stream has finished (the extractor would just
              choke on a half-written passage). */}
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

        {/* Follow-up suggestion chips. Only on assistant messages
            once the turn has settled. Hidden once the user has
            already replied to this assistant (countBranches > 0)
            since the chips would be re-asking what the user has
            already moved past. */}
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

// Throttle window for streaming-time markdown re-renders. The model
// pushes tokens every few ms; without this we'd re-parse the entire
// accumulated markdown + re-typeset every KaTeX formula + re-sanitize
// on each token, which froze the UI on weaker laptops. 60ms is faster
// than the eye can follow but slow enough that the parser only runs
// ~16×/s instead of hundreds. The final value is always flushed (the
// effect fires once more after the last update), so finalized
// messages never show a stale truncation.
const STREAM_RENDER_THROTTLE_MS = 60;

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
  // While streaming, throttle the value we actually render. State
  // updates batch into ~60ms windows; once streaming stops the
  // effect's dependency flip flushes the final content immediately.
  const [throttled, setThrottled] = useState(content);
  useEffect(() => {
    if (!isStreaming) {
      // Final flush — write the post-stream content synchronously so
      // the user doesn't see a stale truncated body after the model
      // settles. setState ignores no-op updates.
      setThrottled(content);
      return;
    }
    if (content === throttled) return;
    const id = window.setTimeout(
      () => setThrottled(content),
      STREAM_RENDER_THROTTLE_MS,
    );
    return () => window.clearTimeout(id);
  }, [content, isStreaming, throttled]);

  const { cleaned, books, videos } = useMemo(
    () => extractRecommendations(throttled),
    [throttled],
  );
  // The expensive part — full marked.parse → KaTeX → DOMPurify
  // pipeline. Cached on (cleaned, sourceDocId) so unrelated parent
  // re-renders (hover, branch toggle, sibling-message updates) don't
  // re-run it. Combined with the throttle above, parses drop from
  // hundreds during a long stream to a few dozen.
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
          // Relative in-app links (e.g. the "Open the generated
          // roadmap" link a roadmap-skill turn appends) navigate
          // through the SPA router instead of triggering a full reload.
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
      // Clipboard API blocked — extremely rare in our deploys, but
      // surface the failure rather than silently swallowing it.
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
