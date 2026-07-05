import { useCallback, useRef } from "react";
import {
  useContextMenuStore,
  type ContextMenuEntry,
} from "@/stores/context-menu-store";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 8;

/**
 * Returns event handlers to spread on any element so it shows a custom
 * context menu on right-click (desktop) or long-press (touch).
 *
 * Pass items either as a stable array or as a getter function, the
 * getter is called at the moment the menu opens, so it can read fresh
 * state (e.g. "is this row currently selected").
 *
 * Usage:
 *
 *   const ctx = useContextMenu(() => [
 *     { id: "open",   label: "Open",   icon: BookOpen, onClick: () => navigate(...) },
 *     { id: "rename", label: "Rename", icon: Pencil,   onClick: () => ... },
 *     { id: "del",    label: "Delete", icon: Trash2,   onClick: () => ..., danger: true },
 *   ]);
 *   return <div {...ctx}>...</div>;
 */
export function useContextMenu(
  items: ContextMenuEntry[] | (() => ContextMenuEntry[]),
) {
  const open = useContextMenuStore((s) => s.open);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);

  const resolveItems = useCallback((): ContextMenuEntry[] => {
    return typeof items === "function" ? items() : items;
  }, [items]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const list = resolveItems();
      if (list.length === 0) return;
      open(e.clientX, e.clientY, list);
    },
    [open, resolveItems],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      longPressStart.current = { x: t.clientX, y: t.clientY };
      longPressTimer.current = setTimeout(() => {
        const list = resolveItems();
        if (list.length === 0) return;
        const start = longPressStart.current;
        if (!start) return;
        open(start.x, start.y, list);
        longPressTimer.current = null;
        longPressStart.current = null;
      }, LONG_PRESS_MS);
    },
    [open, resolveItems],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = longPressStart.current;
      if (!start) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > MOVE_TOLERANCE_PX || Math.abs(dy) > MOVE_TOLERANCE_PX) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  const onTouchEnd = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  return { onContextMenu, onTouchStart, onTouchMove, onTouchEnd };
}
