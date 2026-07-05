import { useEffect, useRef } from "react";

/**
 * Make the browser/system back gesture close a modal instead of navigating away.
 *
 * While isOpen, pushes a sentinel history entry; back fires popstate and pops
 * the module stack to run close(). Closing any other way pops the sentinel in
 * cleanup to keep history balanced. Module-scoped stack so nested panels close
 * in reverse order via a single popstate listener.
 */

interface StackEntry {
  id: number;
  close: () => void;
}

const stack: StackEntry[] = [];

// popstate events triggered by our own history.back(); listener decrements and
// ignores them so programmatic dismissals don't double-fire close().
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
  if (idx === -1) return; // already popped by a user back
  // only the top owns the topmost sentinel; calling history.back() out of order
  // would re-dispatch closes for entries the user hasn't dismissed, so just drop it.
  if (idx !== stack.length - 1) {
    stack.splice(idx, 1);
    return;
  }
  stack.pop();
  pendingInternalBacks += 1;
  window.history.back();
}

export function useBackToClose(isOpen: boolean, onClose: () => void) {
  // keep onClose in a ref so the effect only re-runs on isOpen changes, not on
  // every render (an inline callback would race history.back() across setups).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = pushBackHandler(() => onCloseRef.current());
    return () => popBackHandler(id);
  }, [isOpen]);
}
