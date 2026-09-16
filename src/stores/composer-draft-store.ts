import { create } from "zustand";

/** Draft key for the "new chat" composer (no conversation open yet). */
export const NEW_CHAT_DRAFT_KEY = "__new__";

/**
 * Per-conversation composer drafts, keyed by conversation id (or
 * NEW_CHAT_DRAFT_KEY for the not-yet-created chat). Each chat tab keeps its own
 * unsent text, so switching tabs shows that tab's draft (empty if you never
 * typed there) instead of carrying one tab's text into another. Session-only
 * (not persisted) — same lifetime as the old single input state.
 */
interface ComposerDraftState {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
}

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: {},
  setDraft: (key, value) =>
    set((s) => ({ drafts: { ...s.drafts, [key]: value } })),
}));
