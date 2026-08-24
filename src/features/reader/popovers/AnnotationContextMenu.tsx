import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { createPortal } from "react-dom";
import {
  Bot,
  BookOpen,
  Copy,
  Globe,
  Languages,
  MessageSquare,
  Share2,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useChatStore } from "@/stores/chat-store";
import { useReaderStore } from "@/stores/reader-store";
import { useTtsStore } from "@/stores/tts-store";
import { useUIStore } from "@/stores/ui-store";
import type { HighlightColor } from "@/types/annotation";
import { AnnotationMenuDefinePanel } from "../panels/AnnotationMenuDefinePanel";
import { AnnotationMenuTranslatePanel } from "../panels/AnnotationMenuTranslatePanel";
import { AnnotationMenuWikiPanel } from "../panels/AnnotationMenuWikiPanel";
import { AnnotationMenuExplainPanel } from "../panels/AnnotationMenuExplainPanel";

const COLORS: { color: HighlightColor; hex: string }[] = [
  { color: "yellow", hex: "#facc15" },
  { color: "green", hex: "#4ade80" },
  { color: "blue", hex: "#60a5fa" },
  { color: "pink", hex: "#f472b6" },
  { color: "orange", hex: "#fb923c" },
];

// Active sub-view. "none" = action list, "comment" = inline textarea, the
// rest each mount their own panel component. Single tagged state so only one
// panel can be open at a time.
type ActivePanel =
  | "none"
  | "comment"
  | "define"
  | "translate"
  | "wiki"
  | "explain";

// memo: mounted under the reader's high-frequency re-render tree but takes no
// props, so it can skip parent updates that don't touch its store slice.
export const AnnotationContextMenu = memo(function AnnotationContextMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const contextMenu = useAnnotationStore((s) => s.contextMenu);
  const addHighlight = useAnnotationStore((s) => s.addHighlight);
  const addComment = useAnnotationStore((s) => s.addComment);
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);
  const removeHighlight = useAnnotationStore((s) => s.removeHighlight);
  const updateHighlightColor = useAnnotationStore(
    (s) => s.updateHighlightColor,
  );
  const highlights = useAnnotationStore((s) => s.highlights);

  const [activePanel, setActivePanel] = useState<ActivePanel>("none");
  const [commentText, setCommentText] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const highlight = contextMenu.highlightId
    ? highlights.get(contextMenu.highlightId)
    : null;

  const selectedText =
    contextMenu.selection?.text ?? highlight?.selection.text ?? "";
  const hasSelection = !!contextMenu.selection;
  const hasHighlight = !!highlight;
  const trimmedSelected = selectedText.trim();

  // Reset to the action list whenever the menu reopens at a new spot.
  useEffect(() => {
    if (!contextMenu.visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset when the menu reopens for a new selection; can't cascade
    setActivePanel("none");
    setCommentText("");
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  // Position before paint so the menu doesn't flash at the touch point and jump.
  useLayoutEffect(() => {
    if (!contextMenu.visible) return;
    const el = menuRef.current;
    if (!el) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fallback position before the ref attaches; never cascades because the next effect run replaces it once the ref is up
      setMenuPos({ x: contextMenu.x, y: contextMenu.y + 8 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(contextMenu.y + 8, window.innerHeight - rect.height - 8);
    setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  // Re-clamp when the panel changes, since panels have different heights.
  useEffect(() => {
    if (!contextMenu.visible) return;
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
      const y = Math.min(
        contextMenu.y + 8,
        window.innerHeight - rect.height - 8,
      );
      setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    });
  }, [activePanel, contextMenu.visible, contextMenu.x, contextMenu.y]);

  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!contextMenu.selection) return;
      addHighlight(contextMenu.selection, color);
      window.getSelection()?.removeAllRanges();
    },
    [contextMenu.selection, addHighlight],
  );

  const handleCopy = useCallback(() => {
    const text = contextMenu.selection?.text ?? highlight?.selection.text;
    if (text) navigator.clipboard.writeText(text);
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, highlight, hideContextMenu]);

  const handleSendToChat = useCallback(() => {
    const selection =
      contextMenu.selection ?? highlight?.selection ?? null;
    const text = (selection?.text ?? "").trim();
    const doc = useReaderStore.getState().getActiveDoc();
    const openInReader = useUIStore.getState().openReaderAiChat;
    if (!text) {
      return;
    }
    if (!doc) {
      return;
    }
    // Stash a draft for AiChatPanel/ChatPage to drain into a new conversation.
    // selection rides along so a citation can be saved on first send.
    useChatStore.getState().setPendingDraft({
      text: `> ${text.replace(/\n/g, "\n> ")}\n\n`,
      source: {
        docId: doc.meta.id,
        docTitle: doc.customTitle || doc.meta.title || "Untitled",
        page: doc.currentPage ?? null,
      },
      selection,
    });
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
    // Prefer the reader side panel; fall back to /chat if it isn't registered.
    if (openInReader) {
      openInReader();
    } else {
      navigate("/chat");
    }
  }, [contextMenu.selection, highlight, hideContextMenu, navigate]);

  const handleShare = useCallback(async () => {
    const text =
      contextMenu.selection?.text ?? highlight?.selection.text ?? "";
    if (!text.trim()) return;
    const doc = useReaderStore.getState().getActiveDoc();
    const title = doc?.customTitle ?? doc?.meta.title ?? "";
    const page =
      contextMenu.selection?.rects[0]?.pageNum ??
      highlight?.selection.rects[0]?.pageNum;
    const attribution = [title, page != null ? `p. ${page}` : null]
      .filter(Boolean)
      .join(" · ");
    const body = attribution ? `"${text}"\n\n- ${attribution}` : `"${text}"`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title || "Pnyxy highlight",
          text: body,
        });
        hideContextMenu();
        return;
      } catch {
        // cancelled or failed, fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // clipboard may be blocked
    }
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, highlight, hideContextMenu]);

  const handleReadAloud = useCallback(() => {
    if (!trimmedSelected) return;
    useTtsStore.getState().speak(trimmedSelected);
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [trimmedSelected, hideContextMenu]);

  const handleSubmitComment = useCallback(() => {
    const selection = contextMenu.selection ?? highlight?.selection;
    if (!selection || !commentText.trim()) return;
    addComment(
      selection,
      commentText.trim(),
      contextMenu.highlightId ?? undefined,
    );
    setActivePanel("none");
    setCommentText("");
    window.getSelection()?.removeAllRanges();
  }, [
    contextMenu.selection,
    contextMenu.highlightId,
    highlight,
    commentText,
    addComment,
  ]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitComment();
      }
      if (e.key === "Escape") setActivePanel("none");
    },
    [handleSubmitComment],
  );

  const handleChangeColor = useCallback(
    (color: HighlightColor) => {
      if (!contextMenu.highlightId) return;
      updateHighlightColor(contextMenu.highlightId, color);
      hideContextMenu();
    },
    [contextMenu.highlightId, updateHighlightColor, hideContextMenu],
  );

  const handleRemoveHighlight = useCallback(() => {
    if (!contextMenu.highlightId) return;
    removeHighlight(contextMenu.highlightId);
    hideContextMenu();
  }, [contextMenu.highlightId, removeHighlight, hideContextMenu]);

  const backToActions = useCallback(() => setActivePanel("none"), []);

  if (!contextMenu.visible) return null;
  if (!contextMenu.selection && !contextMenu.highlightId) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-annotation-context-menu
      className="fixed z-50 flex flex-col gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-2 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
    >
      {/* Color row: pick a color to highlight, or on an existing highlight
          change its color / hit the trailing X to remove. */}
      {(hasSelection || hasHighlight) && activePanel === "none" && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map(({ color, hex }) => (
              <button
                key={color}
                className="h-6 w-6 rounded-full border-2 border-transparent transition-colors cursor-pointer hover:border-white/40 hover:scale-110"
                style={{
                  backgroundColor: hex,
                  borderColor:
                    hasHighlight && highlight.color === color
                      ? "rgba(255,255,255,0.6)"
                      : undefined,
                }}
                title={
                  hasHighlight
                    ? color
                    : t("reader.annotationMenu.highlightTitle", { color })
                }
                onClick={() =>
                  hasHighlight
                    ? handleChangeColor(color)
                    : handleHighlight(color)
                }
              />
            ))}
            {hasHighlight && (
              <button
                onClick={handleRemoveHighlight}
                className="ml-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-transparent bg-danger/15 text-danger transition-colors cursor-pointer hover:border-danger/60 hover:bg-danger/25 hover:scale-110"
                title={t("reader.annotationMenu.removeHighlight")}
                aria-label={t("reader.annotationMenu.removeHighlight")}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="h-px bg-glass-border my-0.5" />
        </>
      )}

      {activePanel === "none" && (
        <div className="flex flex-col gap-0.5">
          {trimmedSelected && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setActivePanel("define")}
            >
              <BookOpen size={14} />
              {t("reader.annotationMenu.define", {
                word:
                  trimmedSelected.length > 20
                    ? trimmedSelected.slice(0, 20) + "…"
                    : trimmedSelected,
              })}
            </button>
          )}

          {trimmedSelected && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setActivePanel("translate")}
            >
              <Languages size={14} />
              {t("reader.annotationMenu.translate")}
            </button>
          )}

          {trimmedSelected && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleReadAloud}
            >
              <Volume2 size={14} />
              {t("reader.annotationMenu.readAloud")}
            </button>
          )}

          {trimmedSelected && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setActivePanel("wiki")}
            >
              <Globe size={14} />
              {t("reader.annotationMenu.wikipedia")}
            </button>
          )}

          {trimmedSelected && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setActivePanel("explain")}
            >
              <Sparkles size={14} />
              {t("reader.annotationMenu.explain")}
            </button>
          )}

          {trimmedSelected && <div className="h-px bg-glass-border my-0.5" />}

          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setActivePanel("comment")}
          >
            <MessageSquare size={14} />
            {t("reader.annotationMenu.addComment")}
          </button>

          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleSendToChat}
            >
              <Bot size={14} />
              {t("reader.annotationMenu.sendToChat")}
            </button>
          )}

          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleCopy}
            >
              <Copy size={14} />
              {t("reader.annotationMenu.copyText")}
            </button>
          )}

          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleShare}
            >
              <Share2 size={14} />
              {t("reader.annotationMenu.share")}
            </button>
          )}
        </div>
      )}

      {activePanel === "define" && (
        <AnnotationMenuDefinePanel
          selectedText={selectedText}
          onBack={backToActions}
        />
      )}

      {activePanel === "translate" && (
        <AnnotationMenuTranslatePanel
          selectedText={selectedText}
          onBack={backToActions}
        />
      )}

      {activePanel === "wiki" && (
        <AnnotationMenuWikiPanel
          initialQuery={trimmedSelected}
          onBack={backToActions}
        />
      )}

      {activePanel === "explain" && (
        <AnnotationMenuExplainPanel
          selectedText={selectedText}
          onBack={backToActions}
        />
      )}

      {activePanel === "comment" && (
        <div className="flex flex-col gap-1.5 p-1">
          <textarea
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleCommentKeyDown}
            placeholder={t("reader.annotationMenu.commentPlaceholder")}
            className="w-48 h-16 rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none resize-none focus:border-accent"
          />
          <div className="flex justify-end gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              onClick={backToActions}
            >
              {t("common.cancel")}
            </button>
            <button
              className="rounded bg-accent/20 px-2 py-1 text-xs text-accent hover:bg-accent/30 transition-colors cursor-pointer disabled:opacity-40"
              disabled={!commentText.trim()}
              onClick={handleSubmitComment}
            >
              {t("reader.annotationMenu.commentAction")}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
});
