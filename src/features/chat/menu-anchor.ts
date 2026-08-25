import {
  useContextMenuStore,
  type ContextMenuEntry,
} from "@/stores/context-menu-store";

/**
 * Opens the shared context menu anchored under a kebab button, so a hover
 * kebab and a right-click show the exact same item list.
 */
export function openMenuAtButton(
  e: React.MouseEvent<HTMLElement>,
  items: ContextMenuEntry[],
) {
  e.preventDefault();
  e.stopPropagation();
  if (items.length === 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  useContextMenuStore.getState().open(rect.right, rect.bottom + 4, items);
}
