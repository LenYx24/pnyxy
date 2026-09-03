/**
 * Thread scroll behaviour: tracks whether the user is near the bottom (for
 * the scroll-to-bottom button) and auto-scrolls to the latest message:
 * instant on conversation switch, and while streaming only as long as the
 * user keeps following the bottom, so reading upward mid-stream isn't
 * yanked back down on every token.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";

interface UseThreadScrollArgs {
  activeId: string | null;
  activeLeafId: string | null;
  messages: Map<string, ChatMessage>;
  streamingMessageId: string | null;
}

// Show the jump-to-latest button once the user is this far from the bottom.
const BUTTON_GAP = 120;
// The follow gate re-arms only this close to the true bottom. Deliberately
// tight so only a deliberate return to the bottom resumes following.
const FOLLOW_GAP = 8;

export function useThreadScroll({
  activeId,
  activeLeafId,
  messages,
  streamingMessageId,
}: UseThreadScrollArgs) {
  const threadEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Button visibility (near the bottom within BUTTON_GAP).
  const [atBottom, setAtBottom] = useState(true);
  // The auto-follow gate, driven off scroll DIRECTION in handleScroll below.
  const followRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(dist < BUTTON_GAP);
    const prev = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "auto" });
    } else if (followRef.current) {
      threadEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [activeId, activeLeafId, messages, streamingMessageId]);

  return {
    scrollContainerRef,
    threadEndRef,
    atBottom,
    handleScroll,
    scrollToBottom,
  };
}
