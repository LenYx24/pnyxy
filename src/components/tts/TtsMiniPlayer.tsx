import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Settings as SettingsIcon,
} from "lucide-react";
import { useTtsStore } from "@/stores/tts-store";

/**
 * Slim floating mini-player surfaced whenever something is being
 * read aloud. Renders nothing in the idle state so it doesn't
 * clutter the chrome.
 *
 * Mobile: pinned above the bottom-nav spacer so it doesn't collide
 * with the tab bar. Desktop: bottom-centred. Voice + rate live in
 * a popover behind a gear icon to keep the resting size small.
 */
export function TtsMiniPlayer() {
  const { t } = useTranslation();
  const status = useTtsStore((s) => s.status);
  const queue = useTtsStore((s) => s.queue);
  const index = useTtsStore((s) => s.index);
  const voices = useTtsStore((s) => s.voices);
  const voiceUri = useTtsStore((s) => s.voiceUri);
  const rate = useTtsStore((s) => s.rate);
  const pause = useTtsStore((s) => s.pause);
  const resume = useTtsStore((s) => s.resume);
  const stop = useTtsStore((s) => s.stop);
  const skipNext = useTtsStore((s) => s.skipNext);
  const skipPrev = useTtsStore((s) => s.skipPrev);
  const setVoiceUri = useTtsStore((s) => s.setVoiceUri);
  const setRate = useTtsStore((s) => s.setRate);
  const refreshVoices = useTtsStore((s) => s.refreshVoices);

  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Some browsers populate the voice list asynchronously. Subscribe
  // to `voiceschanged` (which fires once on Chrome / Edge after the
  // OS list loads) and prime on mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    refreshVoices();
    const onChange = () => refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
  }, [refreshVoices]);

  // Pointerdown-outside dismisses the settings popover.
  useEffect(() => {
    if (!showSettings) return;
    const onDown = (e: PointerEvent) => {
      const el = settingsRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setShowSettings(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showSettings]);

  // Stop on unmount as a defensive guard, though `status: idle` on
  // route changes will already hide the player, an SSR-style remount
  // shouldn't strand a speaking utterance.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (status === "idle" || queue.length === 0) return null;

  const isPlaying = status === "playing";
  const progressLabel = t("tts.progress", {
    current: index + 1,
    total: queue.length,
  });

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),0.5rem)] md:bottom-4 md:pb-0"
      aria-live="polite"
    >
      <div className="pointer-events-auto relative mx-3 flex w-full max-w-md items-center gap-1 rounded-2xl border border-glass-border bg-bg-secondary/95 px-2 py-2 shadow-xl backdrop-blur-md md:gap-2 md:px-3">
        <button
          type="button"
          onClick={skipPrev}
          aria-label={t("tts.previous")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <SkipBack size={16} />
        </button>

        <button
          type="button"
          onClick={isPlaying ? pause : resume}
          aria-label={isPlaying ? t("tts.pause") : t("tts.resume")}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent transition-colors hover:bg-accent/30 cursor-pointer"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button
          type="button"
          onClick={skipNext}
          aria-label={t("tts.next")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <SkipForward size={16} />
        </button>

        <button
          type="button"
          onClick={stop}
          aria-label={t("tts.stop")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
        >
          <Square size={14} />
        </button>

        <div className="flex-1 truncate px-1 text-2xs text-text-muted">
          {progressLabel}
        </div>

        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-label={t("tts.settings")}
          aria-expanded={showSettings}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <SettingsIcon size={15} />
        </button>

        {showSettings && (
          <div
            ref={settingsRef}
            className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-glass-border bg-bg-secondary/95 p-3 shadow-xl backdrop-blur-md"
          >
            <div className="mb-2">
              <label
                htmlFor="tts-voice"
                className="mb-1 block text-2xs uppercase tracking-wide text-text-muted"
              >
                {t("tts.voice")}
              </label>
              <select
                id="tts-voice"
                value={voiceUri ?? ""}
                onChange={(e) => setVoiceUri(e.target.value || null)}
                className="w-full cursor-pointer rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                <option value="">{t("tts.voiceDefault")}</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              {voices.length === 0 && (
                <p className="mt-1 text-2xs text-text-muted">
                  {t("tts.noVoices")}
                </p>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label
                  htmlFor="tts-rate"
                  className="text-2xs uppercase tracking-wide text-text-muted"
                >
                  {t("tts.rate")}
                </label>
                <span className="text-2xs text-text-secondary">
                  {rate.toFixed(2)}x
                </span>
              </div>
              <input
                id="tts-rate"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
