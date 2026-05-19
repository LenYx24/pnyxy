import type { TextElement } from "@/types/whiteboard";
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from "./lib/text-layout";

/**
 * Inline text-editing overlay positioned in screen space over a
 * single TextElement on the canvas. While this is mounted, the
 * canvas render loop skips drawing the underlying element so the
 * HTML <textarea> is the only visible representation. Pan / zoom
 * subscriptions live in the parent and feed in via props — that way
 * the overlay follows the canvas transform without subscribing to
 * the whiteboard store itself.
 *
 * Keyboard handling: stop-propagation on keydown so shortcuts (undo,
 * tool keys) don't fire while typing. Escape and Ctrl/Cmd+Enter
 * commit. Plain Enter inserts a newline, matching the rest of the
 * app's text inputs.
 */
export function TextEditOverlay({
  element,
  draft,
  onDraftChange,
  onCommit,
  panX,
  panY,
  zoom,
}: {
  element: TextElement;
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  panX: number;
  panY: number;
  zoom: number;
}) {
  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => onDraftChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onCommit();
        }
      }}
      style={{
        position: "absolute",
        left: element.x * zoom + panX,
        top: element.y * zoom + panY,
        width: element.width * zoom,
        minHeight: element.fontSize * TEXT_LINE_HEIGHT * zoom,
        fontSize: element.fontSize * zoom,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
        color: element.color,
        background: "rgba(124, 92, 252, 0.08)",
        border: "1px dashed #7c5cfc",
        borderRadius: 4,
        padding: 0,
        margin: 0,
        outline: "none",
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        zIndex: 20,
      }}
    />
  );
}
