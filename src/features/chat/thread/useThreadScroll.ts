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

  // auto-scroll to latest: instant on conversation switch, smooth within it,
  // but only while the user is already at the bottom, so scrolling up to
  // re-read mid-stream isn't yanked back down on every token.
  const lastScrollConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isConvSwitch = lastScrollConvIdRef.current !== activeId;
    lastScrollConvIdRef.current = activeId;
    if (isConvSwitch) {
      atBottomRef.current = true;
      // resets the follow gate on a thread switch; same code as before the
      // split, the lint only sees it now that the effect stands alone
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "auto" });
    } else if (atBottomRef.current) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
