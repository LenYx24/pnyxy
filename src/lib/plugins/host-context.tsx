import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeEffect } from "@/lib/themes/use-theme-effect";
import { PluginManager, type PluginLoadStatus } from "./manager";

interface PluginHostContextValue {
  manager: PluginManager;
  statuses: ReadonlyMap<string, PluginLoadStatus>;
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);

// Hook + provider live together for cohesion; HMR concern is not
// meaningful for a top-level provider file.
// eslint-disable-next-line react-refresh/only-export-components
export function usePluginHost(): PluginHostContextValue {
  const ctx = useContext(PluginHostContext);
  if (!ctx) {
    throw new Error("usePluginHost must be used inside <PluginHost>");
  }
  return ctx;
}

/**
 * Wraps the app: applies the active theme, instantiates the plugin
 * manager singleton, runs initial reconcile, and re-reconciles when
 * the enabled/installed plugin maps change.
 */
export function PluginHost({ children }: { children: ReactNode }) {
  useThemeEffect();

  const manager = useMemo(() => new PluginManager(), []);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, PluginLoadStatus>>(
    () => manager.getStatuses(),
  );

  useEffect(() => {
    return manager.onStatusChange((next) => {
      // Map is mutable; clone for snapshot semantics so React treats
      // it as a new value.
      setStatuses(new Map(next));
    });
  }, [manager]);

  // Initial reconcile + re-reconcile on settings changes.
  useEffect(() => {
    void manager.reconcile();
    const unsub = useSettingsStore.subscribe((state, prev) => {
      if (
        state.enabledPlugins !== prev.enabledPlugins ||
        state.installedPlugins !== prev.installedPlugins
      ) {
        void manager.reconcile();
      }
    });
    return () => {
      unsub();
    };
  }, [manager]);

  const value = useMemo(() => ({ manager, statuses }), [manager, statuses]);
  return (
    <PluginHostContext.Provider value={value}>
      {children}
    </PluginHostContext.Provider>
  );
}
