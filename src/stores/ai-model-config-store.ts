// App-wide cache of the admin-editable LLM offering (public.ai_model_config,
// migration 00083). The model definitions live in code (ai-models.ts); this
// store only carries the parts an admin flips without a deploy: whether a
// provider is offered in the composer picker and its order there.
//
// Read is public (RLS `using (true)`), so this loads for signed-out sample
// flows too. Until it loads, every provider is treated as enabled so the
// picker never flickers to empty; a disabled row only ever removes a choice
// once the real config has arrived.

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { AiProvider } from "./settings-store";

interface ProviderConfig {
  enabled: boolean;
  sortOrder: number;
}

interface AiModelConfigState {
  config: Partial<Record<AiProvider, ProviderConfig>>;
  loaded: boolean;
  loading: boolean;
  /** Fetch once; concurrent callers share the in-flight request. */
  load: () => Promise<void>;
  /** Default-enabled: unknown/not-yet-loaded providers stay visible. */
  isEnabled: (provider: AiProvider) => boolean;
  /** Order for the picker; unknown providers sort after known ones. */
  sortOrder: (provider: AiProvider) => number;
}

let inFlight: Promise<void> | null = null;

export const useAiModelConfigStore = create<AiModelConfigState>((set, get) => ({
  config: {},
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loaded || inFlight) return inFlight ?? Promise.resolve();
    set({ loading: true });
    inFlight = (async () => {
      const { data, error } = await supabase
        .from("ai_model_config")
        .select("model_key, enabled, sort_order");
      if (error) {
        // Non-fatal: leave everything enabled (the picker keeps working).
        set({ loading: false, loaded: true });
        return;
      }
      const config: Partial<Record<AiProvider, ProviderConfig>> = {};
      for (const r of data ?? []) {
        config[r.model_key as AiProvider] = {
          enabled: r.enabled as boolean,
          sortOrder: r.sort_order as number,
        };
      }
      set({ config, loaded: true, loading: false });
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  isEnabled: (provider) => get().config[provider]?.enabled ?? true,

  sortOrder: (provider) => get().config[provider]?.sortOrder ?? 999,
}));
