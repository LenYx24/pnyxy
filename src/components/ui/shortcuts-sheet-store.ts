import { create } from "zustand";

export interface ShortcutsSheetState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/**
 * Open/closed state of the shortcuts cheat sheet. A tiny store so the
 * global hotkey (AppLayout), the command palette and the Settings >
 * Shortcuts tab can all open the same overlay without prop drilling.
 */
export const useShortcutsSheet = create<ShortcutsSheetState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
