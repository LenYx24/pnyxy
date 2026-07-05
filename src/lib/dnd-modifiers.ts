import type { Modifier } from "@dnd-kit/core";

/**
 * Pin the drag delta to the vertical axis only, useful for vertical
 * sortable lists where horizontal drift is just visual noise. Handy
 * for the library's list view and the quiz question reorder, where
 * the user always means to move a row up or down.
 *
 * `@dnd-kit/modifiers` ships an identical implementation; we keep
 * this inline to avoid adding another package for a 5-line function.
 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

/**
 * Clamp the drag delta so the dragging node can't be flung off-screen
 *, especially useful on mobile, where a fast finger can carry the
 * overlay into the address bar / chrome and confuse drop targeting.
 */
export const restrictToWindowEdges: Modifier = ({
  transform,
  draggingNodeRect,
  windowRect,
}) => {
  if (!draggingNodeRect || !windowRect) return transform;
  const value = { ...transform };

  // Horizontal clamp.
  if (draggingNodeRect.left + transform.x <= windowRect.left) {
    value.x = windowRect.left - draggingNodeRect.left;
  } else if (
    draggingNodeRect.left + transform.x + draggingNodeRect.width >=
    windowRect.left + windowRect.width
  ) {
    value.x =
      windowRect.left +
      windowRect.width -
      draggingNodeRect.left -
      draggingNodeRect.width;
  }

  // Vertical clamp.
  if (draggingNodeRect.top + transform.y <= windowRect.top) {
    value.y = windowRect.top - draggingNodeRect.top;
  } else if (
    draggingNodeRect.top + transform.y + draggingNodeRect.height >=
    windowRect.top + windowRect.height
  ) {
    value.y =
      windowRect.top +
      windowRect.height -
      draggingNodeRect.top -
      draggingNodeRect.height;
  }

  return value;
};
