import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { getUserOrNull, requireUser } from "@/lib/supabase-auth";
import { track } from "@/lib/telemetry";
import { useChatStore } from "@/stores/chat-store";
import type {
  Offering,
  OfferingStatus,
  Space,
  SpaceContent,
  SpaceContentKind,
  SpaceKind,
  SpaceSection,
  SpaceVisibility,
} from "@/types/space";

/**
 * Store for the public community / course hierarchy (Spaces, migration
 * 00052): list, create, join, and leave spaces; load one space's content,
 * sections, offerings, and child spaces for the course page; manage that
 * content (add/move/remove) and per-user completion ticks.
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
  /** Ordered sections of the active course page (00069). */
  activeSpaceSections: SpaceSection[];
  /** Content ids the current user has manually ticked done (00070). */
  completedContentIds: Set<string>;

  fetchMine: () => Promise<void>;
  fetchPublic: () => Promise<void>;
  fetchAll: () => Promise<void>;
  createSpace: (input: {
    name: string;
    kind: SpaceKind;
    visibility: SpaceVisibility;
    description?: string | null;
    parentId?: string | null;
    /** Section titles to seed (courses get a first editable section). */
    seedSections?: string[];
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
  /** Find-or-create the member's library folder tree for a course:
   *  <course>/<section title> for each section. Returns the course
   *  folder id (null when folders are unavailable). */
  /** Owner/admin preview: render the course page as a plain member sees
   *  it (no editor affordances). Session-only, applies across navigation. */
  previewAsMember: boolean;
  setPreviewAsMember: (v: boolean) => void;
  ensureCourseFolders: (space: Space) => Promise<string | null>;
  /** Folder for one section of a course (<course>/<section>); null title
   *  = the course folder itself. Creates what is missing. */
  ensureSectionFolder: (
    space: Space,
    sectionTitle: string | null,
  ) => Promise<string | null>;

  /** Load one space + its attached content for the course page. */
  loadSpace: (spaceId: string) => Promise<void>;
  addSpaceContent: (input: {
    spaceId: string;
    kind: SpaceContentKind;
    refId?: string | null;
    title: string;
    subtitle?: string | null;
    url?: string | null;
    sectionId?: string | null;
  }) => Promise<SpaceContent>;
  removeSpaceContent: (id: string) => Promise<void>;
  /** Move an item to another section (null = general) and/or reorder it. */
  updateSpaceContent: (
    id: string,
    patch: { sectionId?: string | null; sortOrder?: number; title?: string },
  ) => Promise<void>;
  addSection: (spaceId: string, title: string) => Promise<SpaceSection>;
  updateSection: (
    id: string,
    patch: { title?: string; description?: string | null; sortOrder?: number },
  ) => Promise<void>;
  removeSection: (id: string) => Promise<void>;
  /** Toggle the current user's completion tick on a course item.
   *  Optimistic: flips the local set first, reverts on error. */
  toggleCompleted: (contentId: string) => Promise<void>;
  addOffering: (input: {
    spaceId: string;
    termLabel: string;
    startsAt?: string | null;
    endsAt?: string | null;
    status?: OfferingStatus;
  }) => Promise<void>;
  removeOffering: (id: string) => Promise<void>;
  /** Offerings across a set of spaces, for the "my spaces" term column
   *  and filter (one call instead of one query per row). */
  fetchOfferingsFor: (spaceIds: string[]) => Promise<Offering[]>;
  /** Direct children of a space; used when browsing an org the user
   *  hasn't joined any courses under yet (RLS still filters visibility). */
  fetchChildrenOf: (spaceId: string) => Promise<Space[]>;
}

/** Find-or-create a library folder by name under `parentId` (case-insensitive). */
async function ensureFolder(
  name: string,
  parentId: string | null,
): Promise<string | null> {
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
  activeSpaceSections: [],
  completedContentIds: new Set(),
  previewAsMember: false,
  setPreviewAsMember: (v) => set({ previewAsMember: v }),

  async fetchMine() {
    const user = await getUserOrNull();
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

  async createSpace({ name, kind, visibility, description = null, parentId = null, seedSections = [] }) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name is required.");
    const user = await requireUser("Sign in to create a space.");

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
    // Seed the requested starting sections (a fresh course gets one real,
    // editable/deletable section instead of a phantom "General").
    for (const title of seedSections) {
      const t = title.trim();
      if (!t) continue;
      const { error: secErr } = await supabase
        .from("space_sections")
        .insert({ space_id: data.id, title: t.slice(0, 200), sort_order: 0 });
      if (secErr) logError("space-store:createSpace:seedSection", secErr);
    }
    await get().fetchAll();
    return data.id as string;
  },

  async joinSpace(spaceId) {
    const user = await requireUser("Sign in to join.");
    const { error } = await supabase
      .from("space_members")
      .insert({ space_id: spaceId, user_id: user.id, role: "member" });
    if (error) {
      logError("space-store:joinSpace", error);
      throw error;
    }
    track("space_join", { space: spaceId });
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
    track("space_join", { space: data as string, viaCode: true });
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
    const user = await getUserOrNull();
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
    // Best-effort: a folder failure mustn't fail the enroll.
    await get().ensureCourseFolders(space);
  },

  async ensureCourseFolders(space) {
    try {
      await useChatStore.getState().fetchFolders();
      const courseFolderId = await ensureFolder(space.name, null);
      if (courseFolderId) {
        // mirror the course page's sections (General items live in the root)
        const sections =
          get().activeSpace?.id === space.id ? get().activeSpaceSections : [];
        for (const section of sections) {
          await ensureFolder(section.title.slice(0, 120), courseFolderId);
        }
      }
      return courseFolderId;
    } catch (err) {
      logError("space-store:ensureCourseFolders", err);
      return null;
    }
  },

  async ensureSectionFolder(space, sectionTitle) {
    const courseFolderId = await get().ensureCourseFolders(space);
    if (!courseFolderId || !sectionTitle) return courseFolderId;
    try {
      return await ensureFolder(sectionTitle.slice(0, 120), courseFolderId);
    } catch (err) {
      logError("space-store:ensureSectionFolder", err);
      return courseFolderId;
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
        { data: sections, error: secErr },
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
        supabase
          .from("space_sections")
          .select("*")
          .eq("space_id", spaceId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      if (sErr) {
        logError("space-store:loadSpace", sErr);
        set({ error: sErr.message });
        return;
      }
      if (space) track("course_open", { space: spaceId });
      // paint the page as soon as the main data is in; the breadcrumb
      // and the membership refresh fill in right after
      const loadedContent = cErr ? [] : ((content ?? []) as SpaceContent[]);
      set({
        activeSpace: (space as Space) ?? null,
        activeSpaceAncestors: [],
        activeSpaceContent: loadedContent,
        activeSpaceOfferings: oErr ? [] : ((offerings ?? []) as Offering[]),
        activeSpaceChildren: chErr ? [] : ((children ?? []) as Space[]),
        // pre-00069 DB: the table is missing, the page just shows one group
        activeSpaceSections: secErr ? [] : ((sections ?? []) as SpaceSection[]),
        // reset here so a previous space's ticks never flash on the next
        // one; the real set (or an empty one) lands once the 6th query below resolves
        completedContentIds: new Set(),
      });
      void get().fetchMine();

      // 6th query, fired once content ids are known: this user's completion
      // ticks for this space's items. Pre-00070 DB / any error -> empty set,
      // never throw (the page must still render).
      const contentIds = loadedContent.map((c) => c.id);
      if (contentIds.length > 0) {
        void (async () => {
          const { data: progress, error: pErr } = await supabase
            .from("space_content_progress")
            .select("content_id")
            .in("content_id", contentIds);
          if (get().activeSpace?.id !== spaceId) return;
          if (pErr) {
            logError("space-store:loadSpace:progress", pErr);
            return;
          }
          set({
            completedContentIds: new Set(
              (progress ?? []).map((p) => p.content_id as string),
            ),
          });
        })();
      }

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
    sectionId = null,
  }) {
    const user = await requireUser("Sign in to add content.");
    // append at the end of its section (Moodle order: newest last)
    const sorts = get()
      .activeSpaceContent.filter(
        (c) => c.space_id === spaceId && (c.section_id ?? null) === sectionId,
      )
      .map((c) => c.sort_order);
    const sortOrder = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
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
        // pre-00069 DB has no column; only send it when set
        ...(sectionId ? { section_id: sectionId } : {}),
      })
      .select()
      .single();
    if (error || !data) {
      logError("space-store:addSpaceContent", error);
      throw error ?? new Error("Could not add content.");
    }
    set((s) => ({
      activeSpaceContent: [...s.activeSpaceContent, data as SpaceContent],
    }));
    return data as SpaceContent;
  },

  async updateSpaceContent(id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.sectionId !== undefined) row.section_id = patch.sectionId;
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    if (patch.title !== undefined) row.title = patch.title.slice(0, 300);
    const { error } = await supabase.from("space_content").update(row).eq("id", id);
    if (error) {
      logError("space-store:updateSpaceContent", error);
      throw error;
    }
    set((s) => ({
      activeSpaceContent: s.activeSpaceContent.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(patch.sectionId !== undefined ? { section_id: patch.sectionId } : {}),
              ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
              ...(patch.title !== undefined ? { title: patch.title.slice(0, 300) } : {}),
            }
          : c,
      ),
    }));
  },

  async addSection(spaceId, title) {
    const sorts = get().activeSpaceSections.map((x) => x.sort_order);
    const sortOrder = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
    const { data, error } = await supabase
      .from("space_sections")
      .insert({ space_id: spaceId, title: title.slice(0, 200), sort_order: sortOrder })
      .select()
      .single();
    if (error || !data) {
      logError("space-store:addSection", error);
      throw error ?? new Error("Could not add section.");
    }
    set((s) => ({ activeSpaceSections: [...s.activeSpaceSections, data as SpaceSection] }));
    return data as SpaceSection;
  },

  async updateSection(id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title.slice(0, 200);
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    const { error } = await supabase.from("space_sections").update(row).eq("id", id);
    if (error) {
      logError("space-store:updateSection", error);
      throw error;
    }
    set((s) => ({
      activeSpaceSections: s.activeSpaceSections
        .map((x) =>
          x.id === id
            ? {
                ...x,
                ...(patch.title !== undefined ? { title: patch.title.slice(0, 200) } : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
                ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
              }
            : x,
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
  },

  async removeSection(id) {
    // items fall back to the general group (FK on delete set null)
    const { error } = await supabase.from("space_sections").delete().eq("id", id);
    if (error) {
      logError("space-store:removeSection", error);
      throw error;
    }
    set((s) => ({
      activeSpaceSections: s.activeSpaceSections.filter((x) => x.id !== id),
      activeSpaceContent: s.activeSpaceContent.map((c) =>
        c.section_id === id ? { ...c, section_id: null } : c,
      ),
    }));
  },

  async toggleCompleted(contentId) {
    const user = await getUserOrNull();
    if (!user) return;
    const wasCompleted = get().completedContentIds.has(contentId);
    // optimistic: flip the local set before the round trip
    set((s) => {
      const next = new Set(s.completedContentIds);
      if (wasCompleted) next.delete(contentId);
      else next.add(contentId);
      return { completedContentIds: next };
    });
    const { error } = wasCompleted
      ? await supabase
          .from("space_content_progress")
          .delete()
          .eq("content_id", contentId)
          .eq("user_id", user.id)
      : await supabase
          .from("space_content_progress")
          .insert({ content_id: contentId, user_id: user.id });
    if (error) {
      logError("space-store:toggleCompleted", error);
      // revert
      set((s) => {
        const next = new Set(s.completedContentIds);
        if (wasCompleted) next.add(contentId);
        else next.delete(contentId);
        return { completedContentIds: next };
      });
    }
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

  async fetchOfferingsFor(spaceIds) {
    if (spaceIds.length === 0) return [];
    const { data, error } = await supabase
      .from("offerings")
      .select("*")
      .in("space_id", spaceIds);
    if (error) {
      logError("space-store:fetchOfferingsFor", error);
      return [];
    }
    return (data ?? []) as Offering[];
  },

  async fetchChildrenOf(spaceId) {
    const { data, error } = await supabase
      .from("spaces")
      .select("*")
      .eq("parent_id", spaceId);
    if (error) {
      logError("space-store:fetchChildrenOf", error);
      return [];
    }
    return (data ?? []) as Space[];
  },
}));
