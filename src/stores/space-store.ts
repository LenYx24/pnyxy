import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useChatStore } from "@/stores/chat-store";
import type {
  Offering,
  OfferingStatus,
  Space,
  SpaceContent,
  SpaceContentKind,
  SpaceKind,
  SpaceVisibility,
} from "@/types/space";

/**
 * Store for the public community / course hierarchy (Spaces, migration
 * 00052). Phase 1a: list my spaces + discover public spaces, create,
 * join, leave. Nesting/content/offerings land later.
 */
interface SpaceState {
  mySpaces: Space[];
  publicSpaces: Space[];
  memberIds: Set<string>;
  loading: boolean;
  error: string | null;

  /** The space currently open on a course page, plus its attached content + offerings + child spaces. */
  activeSpace: Space | null;
  /** Ancestor chain of the active space, root first (breadcrumb). */
  activeSpaceAncestors: { id: string; name: string }[];
  activeSpaceContent: SpaceContent[];
  activeSpaceOfferings: Offering[];
  /** Child spaces (subspaces / courses) nested under the active space. */
  activeSpaceChildren: Space[];

  fetchMine: () => Promise<void>;
  fetchPublic: () => Promise<void>;
  fetchAll: () => Promise<void>;
  createSpace: (input: {
    name: string;
    kind: SpaceKind;
    visibility: SpaceVisibility;
    description?: string | null;
    parentId?: string | null;
  }) => Promise<string | null>;
  joinSpace: (spaceId: string) => Promise<void>;
  /** Join a private space with its invite code; returns the space id. */
  joinWithCode: (code: string) => Promise<string>;
  /** Owner-only: (re)generate the invite code; returns the new code. */
  rotateInviteCode: (spaceId: string) => Promise<string>;
  /** Owner or admin: delete the space (children/members cascade). */
  deleteSpace: (spaceId: string) => Promise<void>;
  leaveSpace: (spaceId: string) => Promise<void>;
  /**
   * Enroll in a course: join it AND build a library folder tree so chats,
   * quizzes and notes about each resource have a home, `<course>/<resource>`.
   * Idempotent (find-or-create by name). Relies on activeSpaceContent being
   * loaded (call after loadSpace).
   */
  enrollInCourse: (space: Space) => Promise<void>;

  /** Load one space + its attached content for the course page. */
  loadSpace: (spaceId: string) => Promise<void>;
  addSpaceContent: (input: {
    spaceId: string;
    kind: SpaceContentKind;
    refId?: string | null;
    title: string;
    subtitle?: string | null;
    url?: string | null;
  }) => Promise<void>;
  removeSpaceContent: (id: string) => Promise<void>;
  addOffering: (input: {
    spaceId: string;
    termLabel: string;
    startsAt?: string | null;
    endsAt?: string | null;
    status?: OfferingStatus;
  }) => Promise<void>;
  removeOffering: (id: string) => Promise<void>;
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  mySpaces: [],
  publicSpaces: [],
  memberIds: new Set(),
  loading: false,
  error: null,
  activeSpace: null,
  activeSpaceAncestors: [],
  activeSpaceContent: [],
  activeSpaceOfferings: [],
  activeSpaceChildren: [],

  async fetchMine() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ mySpaces: [], memberIds: new Set() });
      return;
    }
    // space_members joined to the space rows the user belongs to.
    const { data, error } = await supabase
      .from("space_members")
      .select("space_id, spaces(*)")
      .eq("user_id", user.id);
    if (error) {
      logError("space-store:fetchMine", error);
      set({ error: error.message });
      return;
    }
    const rows = (data ?? []) as {
      space_id: string;
      spaces: Space | Space[] | null;
    }[];
    const spaces = rows
      .map((r) => (Array.isArray(r.spaces) ? r.spaces[0] : r.spaces))
      .filter((s): s is Space => !!s)
      .sort((a, b) => a.name.localeCompare(b.name));
    set({
      mySpaces: spaces,
      memberIds: new Set(rows.map((r) => r.space_id)),
    });
  },

  async fetchPublic() {
    // Top-level public spaces (community/course roots). RLS already
    // restricts to visibility='public' | owned | member.
    const { data, error } = await supabase
      .from("spaces")
      .select("*")
      .eq("visibility", "public")
      .is("parent_id", null)
      .order("official", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      logError("space-store:fetchPublic", error);
      set({ error: error.message });
      return;
    }
    set({ publicSpaces: (data ?? []) as Space[] });
  },

  async fetchAll() {
    set({ loading: true, error: null });
    try {
      await Promise.all([get().fetchMine(), get().fetchPublic()]);
    } finally {
      set({ loading: false });
    }
  },

  async createSpace({ name, kind, visibility, description = null, parentId = null }) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name is required.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to create a space.");

    const { data, error } = await supabase
      .from("spaces")
      .insert({
        owner_id: user.id,
        parent_id: parentId,
        kind,
        name: trimmed,
        description: description?.trim() || null,
        visibility,
      })
      .select()
      .single();
    if (error || !data) {
      logError("space-store:createSpace", error);
      throw error ?? new Error("Could not create space.");
    }
    await get().fetchAll();
    return data.id as string;
  },

  async joinSpace(spaceId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to join.");
    const { error } = await supabase
      .from("space_members")
      .insert({ space_id: spaceId, user_id: user.id, role: "member" });
    if (error) {
      logError("space-store:joinSpace", error);
      throw error;
    }
    await get().fetchMine();
  },

  async joinWithCode(code) {
    const { data, error } = await supabase.rpc("join_space_with_code", {
      p_code: code.trim().toLowerCase(),
    });
    if (error || !data) {
      logError("space-store:joinWithCode", error);
      throw error ?? new Error("invalid code");
    }
    await get().fetchMine();
    return data as string;
  },

  async rotateInviteCode(spaceId) {
    const { data, error } = await supabase.rpc("rotate_space_invite_code", {
      p_space: spaceId,
    });
    if (error || !data) {
      logError("space-store:rotateInviteCode", error);
      throw error ?? new Error("rotate failed");
    }
    const codeStr = data as string;
    set((s) => ({
      activeSpace:
        s.activeSpace?.id === spaceId
          ? { ...s.activeSpace, invite_code: codeStr }
          : s.activeSpace,
    }));
    return codeStr;
  },

  async deleteSpace(spaceId) {
    // best-effort: clear the shared file store first (rows cascade, blobs don't)
    try {
      const { data } = await supabase.storage.from("space-files").list(spaceId);
      const names = (data ?? []).map((o) => `${spaceId}/${o.name}`);
      if (names.length > 0) {
        await supabase.storage.from("space-files").remove(names);
      }
    } catch {
      // orphaned blobs are invisible (member-only read) and harmless
    }
    const { error } = await supabase.from("spaces").delete().eq("id", spaceId);
    if (error) {
      logError("space-store:deleteSpace", error);
      throw error;
    }
    set((s) => ({
      activeSpace: s.activeSpace?.id === spaceId ? null : s.activeSpace,
      mySpaces: s.mySpaces.filter((sp) => sp.id !== spaceId),
      publicSpaces: s.publicSpaces.filter((sp) => sp.id !== spaceId),
    }));
  },

  async leaveSpace(spaceId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("space_members")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", user.id);
    if (error) {
      logError("space-store:leaveSpace", error);
      throw error;
    }
    await get().fetchMine();
  },

  async enrollInCourse(space) {
    await get().joinSpace(space.id);
    // Build a library folder tree so study material about each resource has a
    // home: <course>/<resource>. Best-effort; a failure mustn't fail enroll.
    try {
      await useChatStore.getState().fetchFolders();
      const ensure = async (
        name: string,
        parentId: string | null,
      ): Promise<string | null> => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const folders = useChatStore.getState().folders;
        const existing = folders.find(
          (f) =>
            (f.parent_id ?? null) === parentId &&
            f.name.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        if (existing) return existing.id;
        return await useChatStore.getState().createFolder(trimmed, parentId);
      };
      const courseFolderId = await ensure(space.name, null);
      if (courseFolderId) {
        for (const item of get().activeSpaceContent) {
          await ensure(item.title.slice(0, 120), courseFolderId);
        }
      }
    } catch (err) {
      logError("space-store:enrollInCourse:folders", err);
    }
  },

  async loadSpace(spaceId) {
    // Keep the previous space rendered while the next one loads; the
    // page decides from activeSpace.id whether it may show content or
    // a skeleton. Nulling here caused a full-page spinner on every hop.
    set({ loading: true, error: null });
    try {
      const [
        { data: space, error: sErr },
        { data: content, error: cErr },
        { data: offerings, error: oErr },
        { data: children, error: chErr },
      ] = await Promise.all([
        supabase.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
        supabase
          .from("space_content")
          .select("*")
          .eq("space_id", spaceId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
        supabase
          .from("offerings")
          .select("*")
          .eq("space_id", spaceId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
        // child spaces (subspaces / courses); RLS filters to visible ones
        supabase
          .from("spaces")
          .select("*")
          .eq("parent_id", spaceId)
          .order("kind", { ascending: true })
          .order("name", { ascending: true }),
      ]);
      if (sErr) {
        logError("space-store:loadSpace", sErr);
        set({ error: sErr.message });
      }
      // paint the page as soon as the main data is in; the breadcrumb
      // and the membership refresh fill in right after
      set({
        activeSpace: (space as Space) ?? null,
        activeSpaceAncestors: [],
        activeSpaceContent: cErr ? [] : ((content ?? []) as SpaceContent[]),
        activeSpaceOfferings: oErr ? [] : ((offerings ?? []) as Offering[]),
        activeSpaceChildren: chErr ? [] : ((children ?? []) as Space[]),
        loading: false,
      });
      void get().fetchMine();

      // ancestor chain for the breadcrumb (root first). Bounded walk;
      // RLS may hide a private ancestor from a mere member, then the
      // trail simply starts lower.
      const ancestors: { id: string; name: string }[] = [];
      let parentId = (space as Space | null)?.parent_id ?? null;
      for (let depth = 0; parentId && depth < 8; depth++) {
        const { data: parent } = await supabase
          .from("spaces")
          .select("id, name, parent_id")
          .eq("id", parentId)
          .maybeSingle();
        if (!parent) break;
        ancestors.unshift({ id: parent.id as string, name: parent.name as string });
        parentId = (parent.parent_id as string | null) ?? null;
      }
      if (get().activeSpace?.id === spaceId) {
        set({ activeSpaceAncestors: ancestors });
      }
    } finally {
      set({ loading: false });
    }
  },

  async addOffering({
    spaceId,
    termLabel,
    startsAt = null,
    endsAt = null,
    status = "active",
  }) {
    const trimmed = termLabel.trim();
    if (!trimmed) throw new Error("Term label is required.");
    const sorts = get()
      .activeSpaceOfferings.filter((o) => o.space_id === spaceId)
      .map((o) => o.sort_order);
    const sortOrder = sorts.length > 0 ? Math.min(...sorts) - 1 : 0;
    const { data, error } = await supabase
      .from("offerings")
      .insert({
        space_id: spaceId,
        term_label: trimmed,
        starts_at: startsAt,
        ends_at: endsAt,
        status,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error || !data) {
      logError("space-store:addOffering", error);
      throw error ?? new Error("Could not add offering.");
    }
    set((s) => ({
      activeSpaceOfferings: [data as Offering, ...s.activeSpaceOfferings],
    }));
  },

  async removeOffering(id) {
    const { error } = await supabase.from("offerings").delete().eq("id", id);
    if (error) {
      logError("space-store:removeOffering", error);
      throw error;
    }
    set((s) => ({
      activeSpaceOfferings: s.activeSpaceOfferings.filter((o) => o.id !== id),
    }));
  },

  async addSpaceContent({
    spaceId,
    kind,
    refId = null,
    title,
    subtitle = null,
    url = null,
  }) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to add content.");
    const sorts = get()
      .activeSpaceContent.filter((c) => c.space_id === spaceId)
      .map((c) => c.sort_order);
    const sortOrder = sorts.length > 0 ? Math.min(...sorts) - 1 : 0;
    const { data, error } = await supabase
      .from("space_content")
      .insert({
        space_id: spaceId,
        kind,
        ref_id: refId,
        title: title.slice(0, 300),
        subtitle,
        url,
        sort_order: sortOrder,
        added_by: user.id,
      })
      .select()
      .single();
    if (error || !data) {
      logError("space-store:addSpaceContent", error);
      throw error ?? new Error("Could not add content.");
    }
    set((s) => ({
      activeSpaceContent: [data as SpaceContent, ...s.activeSpaceContent],
    }));
  },

  async removeSpaceContent(id) {
    const { error } = await supabase
      .from("space_content")
      .delete()
      .eq("id", id);
    if (error) {
      logError("space-store:removeSpaceContent", error);
      throw error;
    }
    set((s) => ({
      activeSpaceContent: s.activeSpaceContent.filter((c) => c.id !== id),
    }));
  },
}));
