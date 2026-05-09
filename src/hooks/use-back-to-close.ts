import { useEffect } from "react";

/**
 * Make the browser/system "back" gesture close a modal or panel
 * instead of navigating away from the app.
 *
 * Call with `(isOpen, onClose)`. While `isOpen` is true the hook
 * pushes a sentinel history entry; pressing back fires popstate, the
 * sentinel pops, and we call `onClose`. If the user closes the modal
 * any other way (Escape, X button, backdrop tap), the cleanup pops
 * the sentinel itself so the history stack stays balanced.
 *
 * Why a per-modal hook instead of a centralized back-stack: the
 * sentinels naturally stack — open three sliding panels and back
 * closes them in reverse order without any extra coordination.
 *
 * Tauri webview note: Android's hardware back button and the system
 * back gesture both fire the standard popstate event in webview-based
 * apps, so the same code path works for browser, PWA, and Tauri
 * builds. iOS swipe-from-edge on the other hand hits Safari's history
 * (still popstate) — also covered.
 */
export function useBackToClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;

    let closedByBack = false;
    // Mark our sentinel with a timestamp so we never confuse it with
    // a real navigation entry from elsewhere in the app.
    const sentinel = { __pnyxyBackSentinel: Date.now() };
    window.history.pushState(sentinel, "");

    const onPopState = () => {
      closedByBack = true;
      onClose();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // Modal closed via something other than back (Escape / X /
      // backdrop / programmatic). Pop the sentinel so the history
      // doesn't accumulate dead entries that the user would have to
      // back through.
      if (!closedByBack) {
        window.history.back();
      }
    };
  }, [isOpen, onClose]);
}
