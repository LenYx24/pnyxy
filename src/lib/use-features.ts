import { useMemo } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  resolveFeatures,
  serverUnlockedFeatures,
  type FeatureKey,
  type FeatureSet,
} from "./features";

/** Resolved feature set for the current user. See lib/features.ts. */
export function useFeatures(): FeatureSet {
  const preferences = useAuthStore((s) => s.profile?.preferences);
  const isAdmin = useAuthStore((s) => s.profile?.role === "admin");
  const localOverrides = useSettingsStore((s) => s.featureOverrides);
  const adminShowAll = useSettingsStore((s) => s.adminShowAllFeatures);
  return useMemo(
    () =>
      resolveFeatures({
        serverUnlocked: serverUnlockedFeatures(preferences),
        localOverrides,
        showAll: isAdmin && adminShowAll,
      }),
    [preferences, localOverrides, isAdmin, adminShowAll],
  );
}

export function useFeature(key: FeatureKey): boolean {
  return useFeatures()[key];
}

/** Non-hook variant for imperative code (stores, handlers). */
export function getFeatures(): FeatureSet {
  const profile = useAuthStore.getState().profile;
  const settings = useSettingsStore.getState();
  return resolveFeatures({
    serverUnlocked: serverUnlockedFeatures(profile?.preferences),
    localOverrides: settings.featureOverrides,
    showAll: profile?.role === "admin" && settings.adminShowAllFeatures,
  });
}
