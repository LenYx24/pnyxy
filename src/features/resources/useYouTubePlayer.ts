import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Talks to an embedded YouTube player (an iframe with `enablejsapi=1`)
 * over the postMessage protocol the IFrame API uses under the hood, so
 * the page never has to load YouTube's script. Exposes the playhead and
 * duration (the side-chat's "from now" clip buttons and quota estimate)
 * plus `seekTo` for [mm:ss] citations.
 */
export function useYouTubePlayer(iframeRef: React.RefObject<HTMLIFrameElement | null>) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const post = useCallback(
    (message: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(JSON.stringify({ ...message, channel: "widget" }), "*");
    },
    [iframeRef],
  );

  // Subscribe to playhead updates once the iframe is up. The player only
  // starts emitting `infoDelivery` after a `listening` handshake, which we
  // repeat until the first reply lands (the iframe may still be loading).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        typeof event.origin !== "string" ||
        !/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(event.origin)
      ) {
        return;
      }
      if (event.source !== iframeRef.current?.contentWindow) return;
      let data: { event?: string; info?: Record<string, unknown> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      if (data.event === "onReady" || data.event === "initialDelivery") {
        readyRef.current = true;
        setReady(true);
      }
      if (data.event === "infoDelivery" && data.info) {
        readyRef.current = true;
        setReady(true);
        const t = data.info.currentTime;
        if (typeof t === "number" && Number.isFinite(t)) setCurrentTime(t);
        const d = data.info.duration;
        if (typeof d === "number" && d > 0) setDuration(d);
      }
    };
    window.addEventListener("message", onMessage);
    const handshake = () => {
      post({ event: "listening", id: 1 });
    };
    handshake();
    const timer = window.setInterval(() => {
      if (readyRef.current) {
        window.clearInterval(timer);
        return;
      }
      handshake();
    }, 500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [iframeRef, post]);

  const seekTo = useCallback(
    (seconds: number) => {
      post({ event: "command", func: "seekTo", args: [Math.max(0, seconds), true] });
      post({ event: "command", func: "playVideo", args: [] });
    },
    [post],
  );

  return { currentTime, duration, ready, seekTo };
}
