/**
 * Thread scroll behaviour: tracks whether the user is near the bottom (for
 * the scroll-to-bottom button) and auto-scrolls to the latest message:
 * instant on conversation switch, and while streaming only as long as the
 * user keeps following the bottom, so reading upward mid-stream isn't
 * yanked back down on every token.
 *
 * It also PERSISTS the scroll position per conversation (sessionStorage) and
 * restores it on the first load of that conversation, so a full page reload
 * (e.g. a dev HMR reload) drops the reader back where they were instead of
 * snapping to the bottom. A deliberate switch to a different conversation
 * still lands at the latest message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";

interface UseThreadScrollArgs {
  activeId: string | null;
  activeLeafId: string | null;
  messages: Map<string, ChatMessage>;
  streamingMessageId: string | null;
  /** Follow the bottom as tokens stream in. Off = stay put during a reply. */
  autoScrollStreaming: boolean;
}

// Show the jump-to-latest button once the user is this far from the bottom.
const BUTTON_GAP = 120;
// The follow gate re-arms only this close to the true bottom. Deliberately
// tight so only a deliberate return to the bottom resumes following.
const FOLLOW_GAP = 8;

// Per-conversation scroll memory. sessionStorage is per-tab and cleared when
// the tab closes, which is the right lifetime: it survives a reload but does
// not leak a stale position into a brand-new session.
const scrollKey = (id: string) => `chat-scroll:${id}`;

function readSavedScroll(id: string): number | null {
  try {
    const raw = sessionStorage.getItem(scrollKey(id));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSavedScroll(id: string, top: number): void {
  try {
    sessionStorage.setItem(scrollKey(id), String(Math.round(top)));
  } catch {
    // sessionStorage unavailable (private mode / disabled): scroll memory is
    // a nicety, so a failure here is silently ignored.
  }
}

export function useThreadScroll({
  activeId,
  activeLeafId,
  messages,
  streamingMessageId,
  autoScrollStreaming,
}: UseThreadScrollArgs) {
  const threadEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Button visibility (near the bottom within BUTTON_GAP).
  const [atBottom, setAtBottom] = useState(true);
  // The auto-follow gate, driven off scroll DIRECTION in handleScroll below.
  const followRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  // Current conversation id, readable from the (dependency-free) scroll
  // handler so it can persist the position under the right key.
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Restore bookkeeping: decide the target once per mount (when the initial
  // conversation is first known), then apply it once its messages exist.
  const restoreDecidedRef = useRef(false);
  const pendingRestoreRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(dist < BUTTON_GAP);
    const prev = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    // Remember where the user is, so a reload can restore it.
    if (activeIdRef.current) writeSavedScroll(activeIdRef.current, el.scrollTop);
    // Direction-based follow gate. onScroll (a React prop) is always
    // attached, so this fires for every scroll input (wheel, touch,
    // scrollbar, keyboard): an upward move away from the bottom stops
    // following, so reading earlier text mid-stream isn't yanked back on
    // the next token; reaching the true bottom resumes it. The per-token
    // auto-scroll only ever moves scrollTop DOWN, so it never trips the
    // upward release. Reaching the bottom wins over the direction check
    // (a conversation switch to a shorter thread lands here too).
    if (dist < FOLLOW_GAP) {
      followRef.current = true;
    } else if (el.scrollTop < prev - 2) {
      followRef.current = false;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    followRef.current = true;
    setAtBottom(true);
  }, []);

  // Auto-scroll to latest, but only while the user follows the bottom.
  // The follow is INSTANT: a per-token smooth animation fought the scroll
  // (the animation is always "near bottom", so the gate never released).
  const lastScrollConvIdRef = useRef<string | null>(null);
  const lastStreamingIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isConvSwitch = lastScrollConvIdRef.current !== activeId;
    lastScrollConvIdRef.current = activeId;

    // On the first mount where a conversation is known, decide whether to
    // restore a saved position (set once, applied by the effect below).
    if (!restoreDecidedRef.current && activeId) {
      restoreDecidedRef.current = true;
      pendingRestoreRef.current = readSavedScroll(activeId);
    }
    const hasPendingRestore = pendingRestoreRef.current !== null;

    // A send from this client (a stream just started) re-arms the follow
    // gate even if the user had scrolled up to type: jump to the new turn
    // and track the reply. A scroll-up afterwards releases it as usual.
    const sendStarted =
      streamingMessageId !== null && lastStreamingIdRef.current === null;
    lastStreamingIdRef.current = streamingMessageId;
    if (sendStarted && !isConvSwitch && !followRef.current) {
      followRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (isConvSwitch) {
      followRef.current = true;
      lastScrollTopRef.current = 0;
      // resets the follow gate on a thread switch
      setAtBottom(true);
      // Skip the snap-to-bottom while a saved position is waiting to be
      // restored (initial load); the restore effect positions it instead.
      if (!hasPendingRestore) {
        threadEndRef.current?.scrollIntoView({ behavior: "auto" });
      }
    } else if (followRef.current && !hasPendingRestore) {
      // While a reply streams in, only follow the bottom if the user opted in;
      // otherwise the view stays where they left it during generation.
      const streaming = streamingMessageId !== null;
      if (!streaming || autoScrollStreaming) {
        threadEndRef.current?.scrollIntoView({ behavior: "auto" });
      }
    }
  }, [
    activeId,
    activeLeafId,
    messages,
    streamingMessageId,
    autoScrollStreaming,
  ]);

  // Apply a pending restore once the conversation's messages exist, so the
  // container has real height to scroll within. Runs after the effect above
  // (later definition order), so it wins the initial paint.
  useEffect(() => {
    if (pendingRestoreRef.current === null) return;
    const el = scrollContainerRef.current;
    if (!el || messages.size === 0) return;
    const saved = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    const target = Math.max(0, Math.min(saved, el.scrollHeight - el.clientHeight));
    el.scrollTop = target;
    lastScrollTopRef.current = target;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    followRef.current = dist < FOLLOW_GAP;
    setAtBottom(dist < BUTTON_GAP);
  }, [messages]);

  return {
    scrollContainerRef,
    threadEndRef,
    atBottom,
    handleScroll,
    scrollToBottom,
  };
}
