import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { Organization } from "@/types/organization";

const CURRENT_ORG_LS_KEY = "pnyxy:current-org-id";

function readPersistedCurrent(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CURRENT_ORG_LS_KEY);
  } catch {
    return null;
  }
}

function writePersistedCurrent(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(CURRENT_ORG_LS_KEY, id);
    else window.localStorage.removeItem(CURRENT_ORG_LS_KEY);
  } catch {
    // localStorage may be disabled (private mode); fail silently.
  }
}

interface OrgState {
  organizations: Organization[];
  currentOrgId: string | null;
  isLoading: boolean;
  /** Set when the last fetchMine call failed; cleared on the next attempt. */
  error: string | null;

  fetchMine: () => Promise<void>;
  /** Switch the active org. Persists to localStorage so the choice
   *  survives reloads. No-op if the id isn't in the loaded list. */
  switchOrg: (id: string) => void;
  createOrg: (name: string, color: string | null) => Promise<string | null>;
  renameOrg: (id: string, name: string) => Promise<void>;
  recolorOrg: (id: string, color: string | null) => Promise<void>;
  deleteOrg: (id: string) => Promise<void>;
  reset: () => void;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  organizations: [],
  currentOrgId: null,
  isLoading: false,
  error: null,

  async fetchMine() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ organizations: [], currentOrgId: null });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const orgs = (data ?? []) as Organization[];

      // Resolve the active org id. Order of preference:
      //   1. Whatever's in localStorage AND still exists in the list
      //      (so reloads / new tabs preserve the user's choice).
      //   2. The default org.
      //   3. The first org. (Falls through if the list is empty.)
      const persisted = readPersistedCurrent();
      let nextId: string | null = null;
      if (persisted && orgs.some((o) => o.id === persisted)) {
        nextId = persisted;
      } else {
        nextId = orgs.find((o) => o.is_default)?.id ?? orgs[0]?.id ?? null;
        // Clear the stale persisted value so we don't keep checking it.
        if (persisted && nextId !== persisted) writePersistedCurrent(nextId);
      }

      set({ organizations: orgs, currentOrgId: nextId });
    } catch (err) {
      logError("org-store:fetchMine", err);
      set({ error: "fetchFailed" });
    } finally {
      set({ isLoading: false });
    }
  },

  switchOrg(id) {
    const orgs = get().organizations;
    if (!orgs.some((o) => o.id === id)) return;
    writePersistedCurrent(id);
    set({ currentOrgId: id });
  },

  async createOrg(name, color) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Organization name is required.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to create an organization.");

    const { data, error } = await supabase
      .from("organizations")
      .insert({
        user_id: user.id,
        name: trimmed,
        color: color ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      logError("org-store:createOrg", error);
      throw error ?? new Error("Could not create organization.");
    }
    await get().fetchMine();
    return data.id as string;
  },

  async renameOrg(id, name) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Organization name is required.");
    const { error } = await supabase
      .from("organizations")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      logError("org-store:renameOrg", error);
      throw error;
    }
    set((s) => ({
      organizations: s.organizations.map((o) =>
        o.id === id ? { ...o, name: trimmed } : o,
      ),
    }));
  },

  async recolorOrg(id, color) {
    const { error } = await supabase
      .from("organizations")
      .update({ color: color ?? null })
      .eq("id", id);
    if (error) {
      logError("org-store:recolorOrg", error);
      throw error;
    }
    set((s) => ({
      organizations: s.organizations.map((o) =>
        o.id === id ? { ...o, color: color ?? null } : o,
      ),
    }));
  },

  async deleteOrg(id) {
    // Defense-in-depth: the RLS policy already rejects deletes of the
    // default org, but we also block them here so the UI surfaces a
    // friendlier error than a Postgres permission violation.
    const target = get().organizations.find((o) => o.id === id);
    if (!target) return;
    if (target.is_default)
      throw new Error("The default organization cannot be deleted.");
    const { error } = await supabase
      .from("organizations")
      .delete()
      .eq("id", id);
    if (error) {
      logError("org-store:deleteOrg", error);
      throw error;
    }
    // If the user just deleted the active org, fall back to default.
    set((s) => {
      const next = s.organizations.filter((o) => o.id !== id);
      const fallback =
        s.currentOrgId === id
          ? next.find((o) => o.is_default)?.id ?? next[0]?.id ?? null
          : s.currentOrgId;
      if (s.currentOrgId === id) writePersistedCurrent(fallback);
      return { organizations: next, currentOrgId: fallback };
    });
  },

  reset() {
    set({ organizations: [], currentOrgId: null });
    writePersistedCurrent(null);
  },
}));
