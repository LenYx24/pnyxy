import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-conversation edits to the prompt layers the context inspector
 * shows: a layer can be switched off, and the preset / document layers
 * can carry a hand-edited replacement text. The original is never
 * mutated (it is rebuilt from the sources on every send); the override
 * is applied on top in chat-stream.ts. Base instruction and teacher mode
 * are enforced server-side and cannot be changed here.
 */
export type OverridableLayer = "preset" | "document" | "toc" | "history";
export type EditableLayer = "preset" | "document";

export interface ConversationOverrides {
  disabled: OverridableLayer[];
  edits: Partial<Record<EditableLayer, string>>;
}

const EMPTY: ConversationOverrides = { disabled: [], edits: {} };
/** Key for edits made before a conversation exists (fresh /chat). */
export const NEW_CONVERSATION_KEY = "__new__";

interface ContextOverridesState {
  byConversation: Record<string, ConversationOverrides>;
  get: (conversationId: string | null | undefined) => ConversationOverrides;
  setDisabled: (conversationId: string | null | undefined, layer: OverridableLayer, disabled: boolean) => void;
  setEdit: (conversationId: string | null | undefined, layer: EditableLayer, text: string | null) => void;
  /** Move the "not yet created" edits onto the conversation that was just created. */
  adopt: (conversationId: string) => void;
  clear: (conversationId: string | null | undefined) => void;
}

const keyOf = (id: string | null | undefined) => id ?? NEW_CONVERSATION_KEY;

export const useContextOverridesStore = create<ContextOverridesState>()(
  persist(
    (set, get) => ({
      byConversation: {},
      get: (id) => get().byConversation[keyOf(id)] ?? EMPTY,
      setDisabled: (id, layer, disabled) =>
        set((s) => {
          const cur = s.byConversation[keyOf(id)] ?? EMPTY;
          const next = disabled
            ? Array.from(new Set([...cur.disabled, layer]))
            : cur.disabled.filter((l) => l !== layer);
          return { byConversation: { ...s.byConversation, [keyOf(id)]: { ...cur, disabled: next } } };
        }),
      setEdit: (id, layer, text) =>
        set((s) => {
          const cur = s.byConversation[keyOf(id)] ?? EMPTY;
          const edits = { ...cur.edits };
          if (text === null || !text.trim()) delete edits[layer];
          else edits[layer] = text;
          return { byConversation: { ...s.byConversation, [keyOf(id)]: { ...cur, edits } } };
        }),
      adopt: (id) =>
        set((s) => {
          const pending = s.byConversation[NEW_CONVERSATION_KEY];
          if (!pending) return s;
          const rest = { ...s.byConversation };
          delete rest[NEW_CONVERSATION_KEY];
          return { byConversation: { ...rest, [id]: pending } };
        }),
      clear: (id) =>
        set((s) => {
          const rest = { ...s.byConversation };
          delete rest[keyOf(id)];
          return { byConversation: rest };
        }),
    }),
    { name: "pnyxy:context-overrides", version: 1 },
  ),
);

/** Apply overrides to a freshly built context pack (pure). */
export function applyContextOverrides<T extends { customContext: string; pageContext: string; imageAttachments: unknown[] }>(
  pack: T,
  o: ConversationOverrides,
): T {
  let next = { ...pack };
  if (o.disabled.includes("preset")) next = { ...next, customContext: "" };
  else if (o.edits.preset) next = { ...next, customContext: o.edits.preset };
  if (o.disabled.includes("document")) next = { ...next, pageContext: "", imageAttachments: [] };
  else if (o.edits.document) next = { ...next, pageContext: o.edits.document, imageAttachments: [] };
  return next;
}
