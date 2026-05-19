import { useEffect, useRef } from "react";

/**
 * Make the browser/system "back" gesture close a modal or panel
 * instead of navigating away from the app.
 *
 * Call with `(isOpen, onClose)`. While `isOpen` is true the hook
 * pushes a sentinel history entry; pressing back fires popstate,
 * the centralized stack pops, and the matching close() runs. If
 * the user closes the modal any other way (Escape, X button,
 * backdrop tap), the cleanup pops the sentinel itself so the
 * history stack stays balanced.
 *
 * The stack is module-scoped on purpose: open three sliding panels
 * and back closes them in reverse order without any per-modal
 * coordination. There's ONE popstate listener and ONE
 * "I-initiated-this-back" counter at the module level. The
 * counter replaces the previous per-instance bookkeeping and
 * cleanly handles React StrictMode's setup → cleanup → setup
 * double-invocation: the cleanup's history.back() queues a
 * popstate that the listener recognises as ours and ignores.
 *
 * Tauri webview note: Android's hardware back button and the
 * system back gesture both fire the standard popstate event in
 * webview-based apps, so the same code path works for browser,
 * PWA, and Tauri builds. iOS swipe-from-edge on the other hand
 * hits Safari's history (still popstate) — also covered.
 */

interface StackEntry {
  id: number;
  close: () => void;
}

const stack: StackEntry[] = [];

/** Counter of popstate events we initiated ourselves via
 *  `history.back()`. The listener decrements and ignores them so we
 *  don't double-fire close() on what's already a programmatic
 *  dismissal. */
let pendingInternalBacks = 0;

let nextId = 1;
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached || typeof window === "undefined") return;
  window.addEventListener("popstate", () => {
    if (pendingInternalBacks > 0) {
      pendingInternalBacks -= 1;
      return;
    }
    const top = stack.pop();
    if (top) top.close();
  });
  listenerAttached = true;
}

function pushBackHandler(close: () => void): number {
  ensureListener();
  const id = nextId++;
  window.history.pushState({ __pnyxyBackSentinel: id }, "");
  stack.push({ id, close });
  return id;
}

function popBackHandler(id: number) {
  const idx = stack.findIndex((e) => e.id === id);
  if (idx === -1) return; // Already popped by a user-initiated back.
  // Only the top of the stack owns the topmost history sentinel.
  // If we're popping anything else (shouldn't happen with LIFO
  // close order, but guard anyway), just drop it from the stack —
  // touching history.back() out of order would re-dispatch closes
  // for entries the user hasn't dismissed.
  if (idx !== stack.length - 1) {
    stack.splice(idx, 1);
    return;
  }
  stack.pop();
  pendingInternalBacks += 1;
  window.history.back();
}

export function useBackToClose(isOpen: boolean, onClose: () => void) {
  // Pin onClose in a ref so the effect only re-runs on isOpen
  // transitions. Inline `() => setOpen(false)` callbacks would
  // otherwise trigger setup/cleanup on every parent render and
  // race history.back() against the next setup's listener.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = pushBackHandler(() => onCloseRef.current());
    return () => popBackHandler(id);
  }, [isOpen]);
}
