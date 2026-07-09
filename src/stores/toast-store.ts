import { create } from "zustand";

export type ToastType = "error" | "success" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  /** Show a toast; returns its id. durationMs <= 0 keeps it until dismissed. */
  show: (message: string, type?: ToastType, durationMs?: number) => string;
  dismiss: (id: string) => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}-${Date.now()}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show(message, type = "info", durationMs = 5000) {
    const id = nextId();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs);
    }
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Imperative helper for use outside React (stores, async handlers, catch
 * blocks). e.g. `showToast(t("reader.openFailed"), "error")`.
 */
export function showToast(
  message: string,
  type: ToastType = "info",
  durationMs?: number,
): string {
  return useToastStore.getState().show(message, type, durationMs);
}
