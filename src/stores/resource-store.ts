import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { Resource } from "@/types/resource";
import {
  detectResourceKind,
  deriveTitleFromUrl,
  isValidUrl,
  normalizeUrl,
  parseYouTubeId,
  youtubeThumbnail,
} from "@/lib/resource-url";

/**
 * Library "resources" — saved web pages / YouTube links (migration 00053,
 * beta). Mirrors the chat store's folder/reorder plumbing so resources drag
 * and drop in the library exactly like conversations. Enrichment (title,
 * thumbnail, extracted article) is attempted via the `ingest-url` edge
 * function; if it's unavailable the item is still saved as a bare link.
 */
interface ResourceState {
  resources: Resource[];
  loading: boolean;
  error: string | null;

  fetchResources: () => Promise<void>;
  createResource: (input: {
    url: string;
    folderId?: string | null;
  }) => Promise<string | null>;
  deleteResource: (id: string) => Promise<void>;
  renameResource: (id: string, title: string) => Promise<void>;
  moveResourceToFolder: (
    id: string,
    folderId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  reorderResource: (id: string, sortOrder: number) => Promise<void>;
}

export const useResourceStore = create<ResourceState>((set, get) => ({
  resources: [],
  loading: false,
  error: null,

  async fetchResources() {
    set({ loading: true });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        set({ resources: [] });
        return;
      }
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) {
        logError("resource:fetch", error);
        set({ error: error.message });
        return;
      }
      set({ resources: (data ?? []) as Resource[] });
    } finally {
      set({ loading: false });
    }
  },

  async createResource({ url, folderId = null }) {
    const clean = normalizeUrl(url);
    if (!isValidUrl(clean)) throw new Error("Enter a valid URL.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to add a resource.");
    const kind = detectResourceKind(clean);

    // Enrichment via the ingest-url edge function; degrade gracefully so the
    // item is still saved as a plain link if the function isn't deployed.
    let title = "";
    let description: string | null = null;
    let thumbnail_url: string | null = null;
    let content: string | null = null;
    try {
      const { data, error } = await supabase.functions.invoke("ingest-url", {
        body: { url: clean },
      });
      if (!error && data && typeof data === "object") {
        const r = data as Partial<Resource>;
        if (typeof r.title === "string") title = r.title;
        description = r.description ?? null;
        thumbnail_url = r.thumbnail_url ?? null;
        content = r.content ?? null;
      }
    } catch (err) {
      logError("resource:ingest", err);
    }
    if (!title.trim()) title = deriveTitleFromUrl(clean);
    if (!thumbnail_url && kind === "youtube") {
      const vid = parseYouTubeId(clean);
      if (vid) thumbnail_url = youtubeThumbnail(vid);
    }

    // min(siblings) - 1 lands new resources at the top of their folder
    const siblingSorts = get()
      .resources.filter((r) => r.folder_id === folderId)
      .map((r) => r.sort_order);
    const sortOrder =
      siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;

    const { data, error } = await supabase
      .from("resources")
      .insert({
        user_id: user.id,
        folder_id: folderId,
        kind,
        url: clean,
        title: title.slice(0, 300),
        description,
        thumbnail_url,
        content,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error || !data) {
      logError("resource:create", error);
      throw error ?? new Error("Could not save resource.");
    }
    set((s) => ({ resources: [data as Resource, ...s.resources] }));
    return data.id as string;
  },

  async deleteResource(id) {
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) {
      logError("resource:delete", error);
      throw error;
    }
    set((s) => ({ resources: s.resources.filter((r) => r.id !== id) }));
  },

  async renameResource(id, title) {
    const trimmed = title.trim();
    const { error } = await supabase
      .from("resources")
      .update({ title: trimmed })
      .eq("id", id);
    if (error) {
      logError("resource:rename", error);
      throw error;
    }
    set((s) => ({
      resources: s.resources.map((r) =>
        r.id === id ? { ...r, title: trimmed } : r,
      ),
    }));
  },

  async moveResourceToFolder(id, folderId, sortOrder) {
    const current = get().resources.find((r) => r.id === id);
    if (!current) return;
    const folderUnchanged = current.folder_id === folderId;
    const sortUnchanged =
      sortOrder === undefined || current.sort_order === sortOrder;
    if (folderUnchanged && sortUnchanged) return;
    const prevFolder = current.folder_id;
    const prevSort = current.sort_order;
    const patch: Partial<Resource> = { folder_id: folderId };
    if (sortOrder !== undefined) patch.sort_order = sortOrder;
    set((s) => ({
      resources: s.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    const update: Record<string, unknown> = { folder_id: folderId };
    if (sortOrder !== undefined) update.sort_order = sortOrder;
    const { error } = await supabase
      .from("resources")
      .update(update)
      .eq("id", id);
    if (error) {
      logError("resource:move", error);
      set((s) => ({
        resources: s.resources.map((r) =>
          r.id === id
            ? { ...r, folder_id: prevFolder, sort_order: prevSort }
            : r,
        ),
      }));
      throw error;
    }
  },

  async reorderResource(id, sortOrder) {
    const current = get().resources.find((r) => r.id === id);
    if (!current || current.sort_order === sortOrder) return;
    const prev = current.sort_order;
    set((s) => ({
      resources: s.resources.map((r) =>
        r.id === id ? { ...r, sort_order: sortOrder } : r,
      ),
    }));
    const { error } = await supabase
      .from("resources")
      .update({ sort_order: sortOrder })
      .eq("id", id);
    if (error) {
      logError("resource:reorder", error);
      set((s) => ({
        resources: s.resources.map((r) =>
          r.id === id ? { ...r, sort_order: prev } : r,
        ),
      }));
    }
  },
}));
