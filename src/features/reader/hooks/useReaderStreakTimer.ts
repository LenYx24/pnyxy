import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useStreakStore } from "@/stores/streak-store";

/**
 * Reading timer for streaks. Respects the active tracker's enabled flag so a
 * toggled-off tracker doesn't quietly accumulate streak time.
 */
export function useReaderStreakTimer(hasDocuments: boolean): void {
  useEffect(() => {
    if (!hasDocuments) return;

    let lastTick = Date.now();
    let accumulated = 0;

    const flush = () => {
      const now = Date.now();
      accumulated += (now - lastTick) / 1000;
      lastTick = now;
      if (accumulated >= 1) {
        const whole = Math.floor(accumulated);
        // Only credit streak time when the active tracker is enabled. Only the
        // toggle tracker has an `enabled` flag; others always credit.
        const settingsState = useSettingsStore.getState();
        const activeId = settingsState.activeTrackerId;
        const activeSettings = settingsState.trackerSettings[activeId];
        const tracking =
          activeId !== "toggle" ||
          (activeSettings as { enabled?: boolean } | undefined)?.enabled !== false;
        if (tracking) {
          useStreakStore.getState().addReadingTime(whole);
        }
        accumulated -= whole;
      }
    };

    const interval = setInterval(() => {
      if (!document.hidden) {
        flush();
      }
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flush();
      } else {
        lastTick = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, [hasDocuments]);
}
