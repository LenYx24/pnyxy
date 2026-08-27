/**
 * The model the Pnyxy proxy actually answered with on the last turn
 * (from its x-pnyxy-model response header). The proxy may fall through
 * the chain (bucket empty, upstream error), so the composer's quota
 * footer trusts this over its own prediction once a turn has been served.
 */
import { create } from "zustand";

interface ServedModelState {
  model: string | null;
  set: (model: string | null) => void;
}

export const useServedModelStore = create<ServedModelState>((set) => ({
  model: null,
  set: (model) => set({ model }),
}));
