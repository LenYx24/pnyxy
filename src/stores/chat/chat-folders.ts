/**
 * Chat folder actions. Chat folders live in the shared library `folders`
 * table, so every insert must carry the active org id (folders.org_id is
 * NOT NULL) and the rows are visible from the library tree too.
 */
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import i18n from "@/lib/i18n";
import { getUserOrNull } from "@/lib/supabase-auth";
import { useOrgStore } from "@/stores/org-store";
import type { ChatFolder } from "@/types/chat";
import type { ChatGet, ChatSet, ChatState } from "./chat-types";
import { isFolderOrDescendant } from "./chat-tree";

type ChatFolderSlice = Pick<
  ChatState,
  | "fetchFolders"
  | "createFolder"
  | "ensureQuickChatsFolder"
  | "renameFolder"
  | "deleteFolder"
  | "moveFolderToParent"
  | "reorderFolder"
>;

export function createChatFolderSlice(
  set: ChatSet,
  get: ChatGet,
): ChatFolderSlice {
  return {
    async fetchFolders() {
      const user = await getUserOrNull();
      if (!user) {
        set({ folders: [] });
        return;
      }
      const { data, error } = await supabase
        .from("folders")
        .select("*")
        .eq("user_id", user.id)
        // sort_order asc, created_at tiebreaker
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) {
        logError("chat:fetchFolders", error);
        return;
      }
      set({ folders: (data ?? []) as ChatFolder[] });
    },

    async createFolder(name, parentId = null) {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const user = await getUserOrNull();
      if (!user) return null;
      const orgId = useOrgStore.getState().currentOrgId;
      if (!orgId) {
        logError("chat:createFolder", "No active organization");
        return null;
      }
      // min(siblings) - 1 so new folders land at the top of their parent
      const siblingSorts = get()
        .folders.filter((f) => f.parent_id === parentId)
        .map((f) => f.sort_order);
      const sortOrder =
        siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;
      const { data, error } = await supabase
        .from("folders")
        .insert({
          user_id: user.id,
          org_id: orgId,
          name: trimmed,
          parent_id: parentId,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error || !data) {
        logError("chat:createFolder", error);
        return null;
      }
      await get().fetchFolders();
      return data.id as string;
    },

    async ensureQuickChatsFolder(parentId = null) {
      const name = i18n.t("chat.sidebar.quickChats", {
        defaultValue: "Quick chats",
      });
      const matches = (f: ChatFolder) =>
        f.parent_id === parentId &&
        f.name.trim().toLowerCase() === name.trim().toLowerCase();
      const existing = get().folders.find(matches);
      if (existing) return existing.id;
      // folders may not be loaded yet (e.g. a reader-panel quick chat): refresh
      // and re-check before creating, to avoid a duplicate.
      await get().fetchFolders();
      const rechecked = get().folders.find(matches);
      if (rechecked) return rechecked.id;
      const id = await get().createFolder(name, parentId);
      if (!id) return null;
      // Creating the shared (root) Quick chats folder also sweeps every loose
      // conversation into it, so the library root stays free of chats.
      // Per-folder Quick chats folders start empty.
      if (parentId === null) {
        const user = await getUserOrNull();
        if (user) {
          const { error } = await supabase
            .from("chat_conversations")
            .update({ folder_id: id })
            .eq("user_id", user.id)
            .is("folder_id", null);
          if (error) logError("chat:ensureQuickChatsFolder:sweep", error);
          else await get().fetchConversations();
        }
      }
      return id;
    },

    async renameFolder(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const { error } = await supabase
        .from("folders")
        .update({ name: trimmed })
        .eq("id", id);
      if (error) {
        logError("chat:renameFolder", error);
        return;
      }
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
      }));
    },

    async deleteFolder(id) {
      const { error } = await supabase
        .from("folders")
        .delete()
        .eq("id", id);
      if (error) {
        logError("chat:deleteFolder", error);
        return;
      }
      // server cascades subfolders + nulls conversations, refresh both
      await Promise.all([get().fetchFolders(), get().fetchConversations()]);
    },

    async moveFolderToParent(id, parentId, sortOrder) {
      if (id === parentId) return;
      // skip a drop onto the current parent with no sort change
      const current = get().folders.find((f) => f.id === id);
      if (!current) return;
      const parentUnchanged = current.parent_id === parentId;
      const sortUnchanged =
        sortOrder === undefined || current.sort_order === sortOrder;
      if (parentUnchanged && sortUnchanged) return;
      // cycle guard: a folder must not become its own descendant
      if (parentId !== null && isFolderOrDescendant(get().folders, id, parentId)) {
        return;
      }
      // optimistic patch, rolls back on error
      const previousParentId = current.parent_id;
      const previousSortOrder = current.sort_order;
      const patch: Partial<ChatFolder> = { parent_id: parentId };
      if (sortOrder !== undefined) patch.sort_order = sortOrder;
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === id ? { ...f, ...patch } : f,
        ),
      }));
      const update: Record<string, unknown> = { parent_id: parentId };
      if (sortOrder !== undefined) update.sort_order = sortOrder;
      const { error } = await supabase
        .from("folders")
        .update(update)
        .eq("id", id);
      if (error) {
        logError("chat:moveFolderToParent", error);
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id
              ? { ...f, parent_id: previousParentId, sort_order: previousSortOrder }
              : f,
          ),
        }));
        return;
      }
    },

    async reorderFolder(id, sortOrder) {
      const current = get().folders.find((f) => f.id === id);
      if (!current || current.sort_order === sortOrder) return;
      const previousSortOrder = current.sort_order;
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === id ? { ...f, sort_order: sortOrder } : f,
        ),
      }));
      const { error } = await supabase
        .from("folders")
        .update({ sort_order: sortOrder })
        .eq("id", id);
      if (error) {
        logError("chat:reorderFolder", error);
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, sort_order: previousSortOrder } : f,
          ),
        }));
      }
    },
  };
}
