/**
 * Receiving half of the cross-tab bus: turns another tab's "this changed"
 * announcement into a refetch here. See cross-tab-bus.ts for the sender.
 *
 * Two rules keep this cheap. Events are coalesced over a short window, so a
 * burst (a reply finishing touches both the thread and the list) costs one
 * pass. And a hidden tab only records what it owes and settles up when it
 * becomes visible again, so background tabs don't fetch lists nobody reads.
 */
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import { logError } from "@/lib/logger";
import { subscribeCrossTab } from "@/lib/sync/cross-tab-bus";

const COALESCE_MS = 250;
/** localStorage key the settings store persists under. */
const SETTINGS_KEY = "pnyxy-reader:settings";

let started = false;
let timer: number | null = null;
let wantConversations = false;
let wantLibrary = false;
const wantThreads = new Set<string>();

function schedule(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void flush();
  }, COALESCE_MS);
}

async function flush(): Promise<void> {
  // Hidden tab: keep the flags, catch up on the way back in.
  if (document.visibilityState === "hidden") return;
  if (!useAuthStore.getState().user) {
    wantConversations = false;
    wantLibrary = false;
    wantThreads.clear();
    return;
  }
  const chat = useChatStore.getState();
  const jobs: Array<Promise<unknown>> = [];

  if (wantConversations) {
    wantConversations = false;
    jobs.push(chat.fetchConversations());
  }
  if (wantThreads.size > 0) {
    const active = chat.activeConversationId;
    const hit = active !== null && wantThreads.has(active);
    wantThreads.clear();
    // Only the open thread is worth re-reading; the rest load on open.
    if (hit) jobs.push(chat.refreshActiveThread());
  }
  if (wantLibrary) {
    wantLibrary = false;
    const library = useLibraryStore.getState();
    // Don't warm a library this tab has never shown.
    if (library.lastFetchedAt.books !== null) {
      jobs.push(library.fetchLibrary(true));
    }
    if (library.lastFetchedAt.folders !== null) {
      jobs.push(library.fetchFolders(true));
    }
  }
  try {
    await Promise.all(jobs);
  } catch (err) {
    logError("cross-tab-sync:flush", err);
  }
}

/** Idempotent startup, called once from main.tsx. */
export function startCrossTabSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  subscribeCrossTab((event) => {
    switch (event.kind) {
      case "chat:conversations":
        wantConversations = true;
        break;
      case "chat:thread":
        wantThreads.add(event.conversationId);
        break;
      case "library":
        wantLibrary = true;
        break;
    }
    schedule();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule();
  });

  // Settings persist to localStorage, so the browser already tells us when
  // another tab writes them: re-read that snapshot instead of leaving this
  // tab's in-memory copy to overwrite it on the next change.
  window.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_KEY) return;
    void useSettingsStore.persist.rehydrate();
  });
}
