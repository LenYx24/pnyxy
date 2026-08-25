import { useCallback, useEffect, useState, type RefObject } from "react";
import { useUIStore } from "@/stores/ui-store";

export interface ReaderFullscreen {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  zenMode: boolean;
  setZenMode: (on: boolean) => void;
  toggleZenMode: () => void;
}

/** Browser fullscreen on the reader container, plus zen (chrome-less) mode. */
export function useReaderFullscreen(
  readerContainerRef: RefObject<HTMLDivElement | null>,
): ReaderFullscreen {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const zenMode = useUIStore((s) => s.zenMode);
  const setZenMode = useUIStore((s) => s.setZenMode);
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);

  // Fullscreen can change externally (Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = readerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, [readerContainerRef]);

  // Esc exits zen mode regardless of focus
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZenMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode, setZenMode]);

  return { isFullscreen, toggleFullscreen, zenMode, setZenMode, toggleZenMode };
}
