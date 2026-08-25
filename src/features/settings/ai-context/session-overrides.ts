import { create } from "zustand";

/**
 * Per-conversation preset picks made from the chat composer's "+" menu
 * for conversations without a book. Session-only on purpose: the
 * durable bindings live in settings-store (`aiContextBindings`).
 */
interface AiContextSessionState {
  overrides: Record<string, string>;
  setOverride: (conversationId: string, presetId: string | null) => void;
}

export const useAiContextSessionStore = create<AiContextSessionState>()((set) => ({
  overrides: {},
  setOverride: (conversationId, presetId) =>
    set((s) => {
      const next = { ...s.overrides };
      if (presetId) next[conversationId] = presetId;
      else delete next[conversationId];
      return { overrides: next };
    }),
}));

/** Key used for a conversation that has not been created yet (fresh /chat draft). */
export const AI_CONTEXT_DRAFT_CONVERSATION_KEY = "__draft__";
