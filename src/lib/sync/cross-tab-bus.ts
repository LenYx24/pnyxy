/**
 * Cross-tab event bus. The app is happy to run in several browser tabs, but
 * nothing used to tell tab B that tab A had renamed a conversation or
 * finished a reply, so B kept showing a stale list until a reload. Writers
 * announce what changed here; cross-tab-sync.ts listens and refetches.
 *
 * Best-effort by design: BroadcastChannel is missing in a few browsers and
 * throws in some sandboxed frames, so every call degrades to a no-op instead
 * of breaking the write that triggered it. Events carry ids, never rows: the
 * receiving tab refetches, which keeps RLS and ordering the server's job.
 */

export type CrossTabEvent =
  /** Conversation list shape changed (create / rename / delete / move / archive). */
  | { kind: "chat:conversations" }
  /** Messages changed inside one conversation. */
  | { kind: "chat:thread"; conversationId: string }
  /** Library contents changed (books, folders, notes, resources). */
  | { kind: "library" };

const CHANNEL_NAME = "pnyxy:cross-tab";

// undefined = not tried yet, null = unavailable in this browser/context
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;
  } catch {
    channel = null;
  }
  return channel;
}

/** Tell the other tabs what this one just changed. Never throws. */
export function publishCrossTab(event: CrossTabEvent): void {
  try {
    getChannel()?.postMessage(event);
  } catch {
    // channel closed (page unloading) or structured-clone refused: ignore
  }
}

/** Listen for events from other tabs. A tab never hears its own posts. */
export function subscribeCrossTab(
  handler: (event: CrossTabEvent) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (ev: MessageEvent) => {
    const data = ev.data as CrossTabEvent | null;
    if (!data || typeof data.kind !== "string") return;
    handler(data);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
