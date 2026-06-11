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

/**
 * Which sub-view the menu is currently showing. `"none"` renders the
 * top-level action list (Define / Translate / Read aloud / Wikipedia
 * / Explain / Add comment / Send to chat / Copy / Share). `"comment"`
 * shows the inline reply textarea. The other four mount their own
 * panel components, each of which owns its data and abort state.
 *
 * Replacing the previous "five separate `showX` boolean useStates"
 * with a single tagged state lets us encode "only one panel open at
 * a time" structurally — no risk of two panels rendering due to a
 * missed reset.
 */
type ActivePanel =
  | "none"
  | "comment"
  | "define"
  | "translate"
  | "wiki"
  | "explain";

/**
 * Wrapped in `memo` because the menu is mounted under high-frequency
 * re-rendering ancestors (reader scroll, page virtualisation) but
 * takes no props of its own — every dynamic input comes from zustand
 * subscriptions. memo lets it skip re-renders on parent updates that
 * don't touch the menu's slice of the store, materially reducing
 * cost during PDF scroll.
 */
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

  // Reset to the top-level action list whenever the menu opens for a
  // new spot (different selection / right-click position). The
  // panel sub-components unmount automatically when activePanel
  // flips to "none", so their internal data + AbortControllers
  // self-clean — no manual reset needed here.
  useEffect(() => {
    if (!contextMenu.visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset when the menu reopens for a new selection; can't cascade
    setActivePanel("none");
    setCommentText("");
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  // Position the menu before paint so it never appears at the touch
  // point and then jumps. useLayoutEffect runs after the ref is
  // populated but before the browser paints — same effect as a
  // requestAnimationFrame would give, but ~16ms faster perceived.
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

  // Re-clamp when the active panel changes (different panel = different
  // menu size, e.g. Translate is taller than the action list).
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
    // Diagnostic — flat string so Chrome doesn't collapse it on
    // copy/paste. Strip once Send-to-AI-chat is reliably delivering
    // the selection into the composer.
    console.log(
      `[send-to-chat] textLen=${text.length} preview="${text.slice(
        0,
        60,
      )}" hasDoc=${!!doc} docId=${doc?.meta.id ?? "null"} hasOpenInReader=${!!openInReader}`,
    );
    if (!text) {
      console.warn("[send-to-chat] early-return: empty text");
      return;
    }
    if (!doc) {
      console.warn("[send-to-chat] early-return: no active doc");
      return;
    }
    // Stash a draft. Either the reader's in-panel AiChatPanel or
    // ChatPage will pick it up — both subscribe to pendingDraft and
    // drain it into a fresh conversation prefilled with the quote.
    // `selection` rides along so AiChatPanel can arm a citation that
    // gets saved on the first send, letting us underline the source
    // passage in the PDF.
    useChatStore.getState().setPendingDraft({
      text: `> ${text.replace(/\n/g, "\n> ")}\n\n`,
      source: {
        docId: doc.meta.id,
        docTitle: doc.customTitle || doc.meta.title || "Untitled",
        page: doc.currentPage ?? null,
      },
      selection,
    });
    console.log("[send-to-chat] pendingDraft set");
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
    // Prefer the reader's side panel — keeps the user in their
    // reading context. Fall back to /chat only if no reader is
    // mounted (defensive; this menu only renders inside the reader).
    if (openInReader) {
      console.log("[send-to-chat] opening in-reader panel");
      openInReader();
    } else {
      console.log(
        "[send-to-chat] navigating to /chat (in-reader panel not registered)",
      );
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
    const body = attribution ? `"${text}"\n\n— ${attribution}` : `"${text}"`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title || "Pnyxy highlight",
          text: body,
        });
        hideContextMenu();
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // Clipboard may be blocked; nothing else we can do here.
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
      {/* Color row — for new selections, click a color to highlight;
          for existing highlights, click to change color, click the
          trailing X to remove. Keeping the picker and the remove
          action in the same row means delete is one click from
          where the user just set the highlight, instead of buried
          three rows down in the menu. */}
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
