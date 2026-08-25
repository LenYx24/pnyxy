import { useSettingsStore } from "@/stores/settings-store";
import { useLibraryStore } from "@/stores/library-store";
import { useOrgStore } from "@/stores/org-store";
import { resolveAiContext, type ResolvedAiContext } from "./resolve";
import {
  AI_CONTEXT_DRAFT_CONVERSATION_KEY,
  useAiContextSessionStore,
} from "./session-overrides";
import { findLibraryItemByDocId } from "./library-keys";

/**
 * Store-backed resolver used by the prompt builder: looks up the book's
 * library folder and the current org, then delegates to the pure
 * `resolveAiContext`. `conversationId` picks up a session override set
 * from the composer; the draft key covers a not-yet-created chat.
 */
export function resolveAiContextForConversation(opts: {
  docId?: string | null;
  conversationId?: string | null;
}): ResolvedAiContext | null {
  const settings = useSettingsStore.getState();
  const overrides = useAiContextSessionStore.getState().overrides;
  const overridePresetId =
    (opts.conversationId ? overrides[opts.conversationId] : undefined) ??
    overrides[AI_CONTEXT_DRAFT_CONVERSATION_KEY] ??
    null;
  const item = opts.docId
    ? findLibraryItemByDocId(useLibraryStore.getState().books, opts.docId)
    : undefined;
  return resolveAiContext(settings, {
    overridePresetId,
    bookId: opts.docId ?? null,
    folderId: item?.folder_id ?? null,
    orgId: useOrgStore.getState().currentOrgId,
  });
}
