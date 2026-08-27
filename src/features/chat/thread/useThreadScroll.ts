/**
 * Thread scroll behaviour: tracks whether the user is near the bottom
 * (auto-follow gate + the scroll-to-bottom button) and auto-scrolls to the
 * latest message: instant on conversation switch, smooth within one, and
 * only while already at the bottom so reading upward mid-stream isn't
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

export function useThreadScroll({
  activeId,
  activeLeafId,
  messages,
  streamingMessageId,
}: UseThreadScrollArgs) {
  const threadEndRef = useRef<HTMLDivElement>(null);
  // tracks whether the thread is scrolled near the bottom; drives both the
  // auto-follow gate and the scroll-to-bottom button
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < 120;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);
  const scrollToBottom = useCallback(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // Any upward wheel/touch intent releases the follow gate IMMEDIATELY,
  // even mid-animation. Without this, the per-token smooth scroll kept
  // swallowing the user's upward scroll while a reply streamed.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const release = () => {
      atBottomRef.current = false;
      setAtBottom(false);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) release();
    };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY + 4) release();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Auto-scroll to latest, but only while the user sits at the bottom.
  // The follow is INSTANT: a per-token smooth animation fights the wheel
  // (the animation is always "near bottom", so the gate never released).
  const lastScrollConvIdRef = useRef<string | null>(null);
  const lastStreamingIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isConvSwitch = lastScrollConvIdRef.current !== activeId;
    lastScrollConvIdRef.current = activeId;
    // A send from this client (a stream just started) re-arms the follow
    // gate even if the user had scrolled up to type: jump to the new turn
    // and track the reply. A wheel-up afterwards releases it as usual.
    const sendStarted =
      streamingMessageId !== null && lastStreamingIdRef.current === null;
    lastStreamingIdRef.current = streamingMessageId;
    if (sendStarted && !isConvSwitch && !atBottomRef.current) {
      atBottomRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (isConvSwitch) {
      atBottomRef.current = true;
      // resets the follow gate on a thread switch; same code as before the
      // split, the lint only sees it now that the effect stands alone
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "auto" });
    } else if (atBottomRef.current) {
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
