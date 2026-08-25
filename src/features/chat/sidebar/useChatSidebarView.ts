import { useCallback, useSyncExternalStore } from "react";

/**
 * Which list the chat sidebar shows:
 *  - "folders": the tree (folders + their chats, loose chats at the bottom)
 *  - "quick":   every conversation flat, newest first, date captions only
 *
 * Persisted in localStorage so the choice survives reloads; shared across
 * mounts (desktop column and mobile drawer are the same node anyway).
 */
export type ChatSidebarView = "folders" | "quick";

const PREF_KEY = "pnyxy-chat:sidebar-view";
const listeners = new Set<() => void>();

function readPref(): ChatSidebarView {
  try {
    return localStorage.getItem(PREF_KEY) === "quick" ? "quick" : "folders";
  } catch {
    return "folders";
  }
}

let cache = readPref();

function setPref(next: ChatSidebarView) {
  cache = next;
  try {
    localStorage.setItem(PREF_KEY, next);
  } catch {
    // ignore (private mode / quota)
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useChatSidebarView(): [
  ChatSidebarView,
  (next: ChatSidebarView) => void,
] {
  const view = useSyncExternalStore(
    subscribe,
    () => cache,
    (): ChatSidebarView => "folders",
  );
  const set = useCallback((next: ChatSidebarView) => setPref(next), []);
  return [view, set];
}
