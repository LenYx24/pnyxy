import { create } from "zustand";
import type { AiProvider } from "@/stores/settings-store";

/**
 * The provider the next chat turn uses, shared across the app.
 *
 * `null` = "Default" (the auto fallback chain / free Pnyxy route); a provider
 * value = a strict pick. This lived as local state inside ChatComposer, but the
 * mobile chat header now also shows the model picker (Gemini-style), so the
 * selection has to be shared so both pickers agree. Deliberately NOT persisted:
 * the pick resets on reload, exactly as the old local state did.
 */
interface ChatModelState {
  selectedProvider: AiProvider | null;
  setSelectedProvider: (provider: AiProvider | null) => void;
}

export const useChatModelStore = create<ChatModelState>((set) => ({
  selectedProvider: null,
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),
}));
