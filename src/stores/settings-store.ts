import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  pageScrollBehavior: "smooth" | "instant";
  scrollAnimationDuration: number;

  setPageScrollBehavior: (v: "smooth" | "instant") => void;
  setScrollAnimationDuration: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      pageScrollBehavior: "smooth",
      scrollAnimationDuration: 300,

      setPageScrollBehavior: (v) => set({ pageScrollBehavior: v }),
      setScrollAnimationDuration: (v) =>
        set({ scrollAnimationDuration: Math.min(Math.max(v, 100), 1000) }),
    }),
    { name: "pnyxy-reader:settings" },
  ),
);
