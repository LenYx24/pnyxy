import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, MessageSquare, Trash2, Palette } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import type { HighlightColor } from "@/types/annotation";

const COLORS: { color: HighlightColor; hex: string }[] = [
  { color: "yellow", hex: "#facc15" },
  { color: "green", hex: "#4ade80" },
  { color: "blue", hex: "#60a5fa" },
  { color: "pink", hex: "#f472b6" },
  { color: "orange", hex: "#fb923c" },
];

export function AnnotationContextMenu() {
  const contextMenu = useAnnotationStore((s) => s.contextMenu);
  const addHighlight = useAnnotationStore((s) => s.addHighlight);
  const addComment = useAnnotationStore((s) => s.addComment);
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);
  const removeHighlight = useAnnotationStore((s) => s.removeHighlight);
  const updateHighlightColor = useAnnotationStore(
    (s) => s.updateHighlightColor,
  );
  const highlights = useAnnotationStore((s) => s.highlights);

  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showColorChange, setShowColorChange] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const highlight = contextMenu.highlightId
    ? highlights.get(contextMenu.highlightId)
    : null;

  // Clamp menu position to viewport
  useEffect(() => {
    if (!contextMenu.visible) return;
    // Reset sub-states when menu opens
    setShowCommentInput(false);
    setShowColorChange(false);
    setCommentText("");

    // Position after a tick so the ref is populated
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) {
        setMenuPos({ x: contextMenu.x, y: contextMenu.y + 8 });
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
      const y = Math.min(
        contextMenu.y + 8,
        window.innerHeight - rect.height - 8,
      );
      setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

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
    if (text) {
      navigator.clipboard.writeText(text);
    }
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, highlight, hideContextMenu]);

  const handleAddComment = useCallback(() => {
    setShowCommentInput(true);
    setCommentText("");
  }, []);

  const handleSubmitComment = useCallback(() => {
    const selection = contextMenu.selection ?? highlight?.selection;
    if (!selection || !commentText.trim()) return;
    addComment(selection, commentText.trim(), contextMenu.highlightId ?? undefined);
    setShowCommentInput(false);
    setCommentText("");
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, contextMenu.highlightId, highlight, commentText, addComment]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitComment();
      }
      if (e.key === "Escape") {
        setShowCommentInput(false);
      }
    },
    [handleSubmitComment],
  );

  const handleChangeColor = useCallback(
    (color: HighlightColor) => {
      if (!contextMenu.highlightId) return;
      updateHighlightColor(contextMenu.highlightId, color);
      setShowColorChange(false);
      hideContextMenu();
    },
    [contextMenu.highlightId, updateHighlightColor, hideContextMenu],
  );

  const handleRemoveHighlight = useCallback(() => {
    if (!contextMenu.highlightId) return;
    removeHighlight(contextMenu.highlightId);
    hideContextMenu();
  }, [contextMenu.highlightId, removeHighlight, hideContextMenu]);

  if (!contextMenu.visible) return null;
  // Need either a selection or a highlight to show menu
  if (!contextMenu.selection && !contextMenu.highlightId) return null;

  const hasSelection = !!contextMenu.selection;
  const hasHighlight = !!highlight;

  return createPortal(
    <div
      ref={menuRef}
      data-annotation-context-menu
      className="fixed z-50 flex flex-col gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-2 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
    >
      {/* Highlight color circles (only for new selections) */}
      {hasSelection && !showCommentInput && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map(({ color, hex }) => (
              <button
                key={color}
                className="h-6 w-6 rounded-full border-2 border-transparent hover:border-white/40 transition-colors cursor-pointer hover:scale-110"
                style={{ backgroundColor: hex }}
                title={`Highlight ${color}`}
                onClick={() => handleHighlight(color)}
              />
            ))}
          </div>
          <div className="h-px bg-glass-border my-0.5" />
        </>
      )}

      {/* Change color for existing highlight */}
      {hasHighlight && showColorChange && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map(({ color, hex }) => (
              <button
                key={color}
                className="h-6 w-6 rounded-full border-2 border-transparent hover:border-white/40 transition-colors cursor-pointer hover:scale-110"
                style={{
                  backgroundColor: hex,
                  borderColor:
                    highlight.color === color
                      ? "rgba(255,255,255,0.6)"
                      : undefined,
                }}
                title={color}
                onClick={() => handleChangeColor(color)}
              />
            ))}
          </div>
          <div className="h-px bg-glass-border my-0.5" />
        </>
      )}

      {/* Action buttons */}
      {!showCommentInput ? (
        <div className="flex flex-col gap-0.5">
          {/* Comment action */}
          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            onClick={handleAddComment}
          >
            <MessageSquare size={14} />
            Add comment...
          </button>

          {/* Copy action */}
          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleCopy}
            >
              <Copy size={14} />
              Copy text
            </button>
          )}

          {/* Highlight-specific actions */}
          {hasHighlight && (
            <>
              <div className="h-px bg-glass-border my-0.5" />
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
                onClick={() => setShowColorChange(!showColorChange)}
              >
                <Palette size={14} />
                Change color
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-red-400/70 hover:bg-red-400/10 hover:text-red-400 transition-colors cursor-pointer"
                onClick={handleRemoveHighlight}
              >
                <Trash2 size={14} />
                Remove highlight
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 p-1">
          <textarea
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleCommentKeyDown}
            placeholder="Add a comment..."
            className="w-48 h-16 rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none resize-none focus:border-accent-purple"
          />
          <div className="flex justify-end gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              onClick={() => setShowCommentInput(false)}
            >
              Cancel
            </button>
            <button
              className="rounded bg-accent-purple/20 px-2 py-1 text-xs text-accent-purple hover:bg-accent-purple/30 transition-colors cursor-pointer disabled:opacity-40"
              disabled={!commentText.trim()}
              onClick={handleSubmitComment}
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
