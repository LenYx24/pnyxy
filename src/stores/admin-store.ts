import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { Profile, UserReport, UserBan, UserRole } from "@/types/database";
import type { CatalogBook } from "@/types/catalog";

const PAGE_SIZE = 20;

interface AdminStats {
  totalUsers: number;
  pendingReports: number;
  pendingBooks: number;
  activeBans: number;
}

interface ReportWithProfiles extends UserReport {
  reporter: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
  reported_user: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}

interface UserWithBan extends Profile {
  activeBan: UserBan | null;
}

interface AdminState {
  // Stats
  stats: AdminStats | null;
  statsLoading: boolean;
  fetchStats: () => Promise<void>;

  // Reports
  reports: ReportWithProfiles[];
  reportsLoading: boolean;
  reportsTotal: number;
  fetchReports: (page: number) => Promise<void>;
  resolveReport: (id: string, status: UserReport["status"], note: string) => Promise<void>;

  // Catalog
  pendingBooks: CatalogBook[];
  catalogLoading: boolean;
  fetchPendingBooks: () => Promise<void>;
  approveBook: (id: string) => Promise<void>;
  rejectBook: (id: string) => Promise<void>;

  // Users
  users: UserWithBan[];
  usersLoading: boolean;
  usersTotal: number;
  fetchUsers: (page: number) => Promise<void>;
  banUser: (userId: string, reason: string, days: number | null) => Promise<void>;
  liftBan: (banId: string) => Promise<void>;
  updateUserRole: (userId: string, role: UserRole) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  // Stats
  stats: null,
  statsLoading: false,

  fetchStats: async () => {
    set({ statsLoading: true });
    try {
      const [usersRes, reportsRes, booksRes, bansRes] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("user_reports").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("catalog_books").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("user_bans").select("*", { count: "exact", head: true }).or("banned_until.is.null,banned_until.gt.now()"),
      ]);

      set({
        stats: {
          totalUsers: usersRes.count ?? 0,
          pendingReports: reportsRes.count ?? 0,
          pendingBooks: booksRes.count ?? 0,
          activeBans: bansRes.count ?? 0,
        },
      });
    } finally {
      set({ statsLoading: false });
    }
  },

  // Reports
  reports: [],
  reportsLoading: false,
  reportsTotal: 0,

  fetchReports: async (page: number) => {
    set({ reportsLoading: true });
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error } = await supabase
        .from("user_reports")
        .select(
          "*, reporter:profiles!user_reports_reporter_id_fkey(id, display_name, avatar_url), reported_user:profiles!user_reports_reported_user_id_fkey(id, display_name, avatar_url)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      set({
        reports: (data ?? []) as unknown as ReportWithProfiles[],
        reportsTotal: count ?? 0,
      });
    } finally {
      set({ reportsLoading: false });
    }
  },

  resolveReport: async (id, status, note) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("user_reports")
      .update({
        status,
        admin_action: note,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    set((s) => ({
      reports: s.reports.map((r) =>
        r.id === id ? { ...r, status, admin_action: note, resolved_by: user.id, resolved_at: new Date().toISOString() } : r,
      ),
    }));
  },

  // Catalog
  pendingBooks: [],
  catalogLoading: false,

  fetchPendingBooks: async () => {
    set({ catalogLoading: true });
    try {
      const { data, error } = await supabase
        .from("catalog_books")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      set({ pendingBooks: data ?? [] });
    } finally {
      set({ catalogLoading: false });
    }
  },

  approveBook: async (id) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("catalog_books")
      .update({
        status: "verified",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;
    set((s) => ({ pendingBooks: s.pendingBooks.filter((b) => b.id !== id) }));
  },

  rejectBook: async (id) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("catalog_books")
      .update({
        status: "rejected",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;
    set((s) => ({ pendingBooks: s.pendingBooks.filter((b) => b.id !== id) }));
  },

  // Users
  users: [],
  usersLoading: false,
  usersTotal: 0,

  fetchUsers: async (page: number) => {
    set({ usersLoading: true });
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data: profiles, count, error } = await supabase
        .from("profiles")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      // Fetch active bans for these users
      const userIds = (profiles ?? []).map((p) => p.id);
      const { data: bans } = userIds.length > 0
        ? await supabase
            .from("user_bans")
            .select("*")
            .in("user_id", userIds)
            .or("banned_until.is.null,banned_until.gt.now()")
        : { data: [] };

      const banMap = new Map<string, UserBan>();
      for (const ban of bans ?? []) {
        if (!banMap.has(ban.user_id) || ban.created_at > banMap.get(ban.user_id)!.created_at) {
          banMap.set(ban.user_id, ban);
        }
      }

      set({
        users: (profiles ?? []).map((p) => ({ ...p, activeBan: banMap.get(p.id) ?? null })),
        usersTotal: count ?? 0,
      });
    } finally {
      set({ usersLoading: false });
    }
  },

  banUser: async (userId, reason, days) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const bannedUntil = days ? new Date(Date.now() + days * 86400000).toISOString() : null;

    const { error } = await supabase
      .from("user_bans")
      .insert({
        user_id: userId,
        reason,
        banned_by: user.id,
        banned_until: bannedUntil,
      });

    if (error) throw error;

    // Refresh user list to show updated ban status
    const currentPage = Math.floor(get().users.length > 0 ? 0 : 0);
    await get().fetchUsers(currentPage);
  },

  liftBan: async (banId) => {
    const { error } = await supabase
      .from("user_bans")
      .update({ banned_until: new Date().toISOString() })
      .eq("id", banId);

    if (error) throw error;

    set((s) => ({
      users: s.users.map((u) =>
        u.activeBan?.id === banId ? { ...u, activeBan: null } : u,
      ),
    }));
  },

  updateUserRole: async (userId, role) => {
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    if (error) throw error;

    set((s) => ({
      users: s.users.map((u) =>
        u.id === userId ? { ...u, role } : u,
      ),
    }));
  },
}));
