import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuDivider {
  id: string;
  divider: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
  open: (x: number, y: number, items: ContextMenuEntry[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  visible: false,
  x: 0,
  y: 0,
  items: [],
  open: (x, y, items) => set({ visible: true, x, y, items }),
  close: () => set({ visible: false, items: [] }),
}));

export function isDivider(
  entry: ContextMenuEntry,
): entry is ContextMenuDivider {
  return "divider" in entry;
}
