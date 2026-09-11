import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ShieldBan,
  ShieldOff,
  ExternalLink,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { FormModal } from "@/components/ui";
import { fieldClass } from "@/components/ui/classes";
import { useAdminStore } from "@/stores/admin-store";

const PAGE_SIZE = 20;

/** Compact "last active" label: today / yesterday / Nd ago / a date. */
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const day = 86_400_000;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "today";
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString();
}

export function UserManagementTab() {
  const {
    users,
    usersLoading,
    usersTotal,
    fetchUsers,
    banUser,
    liftBan,
    updateUserRole,
  } = useAdminStore();
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const [banTarget, setBanTarget] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("7");

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new search term always resets to the first page.
  useEffect(() => {
    setPage(0);
  }, [debounced]);

  // Single fetch on page / search change (server-side search + paging).
  useEffect(() => {
    fetchUsers(page, debounced);
  }, [page, debounced, fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(usersTotal / PAGE_SIZE));

  const handleRoleChange = async (userId: string, role: "admin" | "user") => {
    setActing(userId);
    try {
      await updateUserRole(userId, role);
    } finally {
      setActing(null);
    }
  };

  const handleLiftBan = async (banId: string, userId: string) => {
    setActing(userId);
    try {
      await liftBan(banId);
    } finally {
      setActing(null);
    }
  };

  const handleBan = async () => {
    if (!banTarget) return;
    setActing(banTarget);
    try {
      const days = banDays.trim() === "" ? null : Number(banDays);
      await banUser(banTarget, banReason.trim(), days);
      setBanTarget(null);
      setBanReason("");
      setBanDays("7");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          autoComplete="off"
          className={cn(fieldClass, "w-full pl-9")}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-glass-border bg-glass-bg backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-glass-border text-left text-xs text-text-muted">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Method</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="px-4 py-2.5 text-right font-medium">Books</th>
                <th className="px-4 py-2.5 text-right font-medium">Chats</th>
                <th className="px-4 py-2.5 font-medium">Last active</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-glass-border/60 last:border-0 hover:bg-glass-hover/50"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/users/${user.id}`)}
                        className="block max-w-[220px] truncate text-left font-medium text-text-primary hover:text-accent"
                      >
                        {user.display_name || "No name"}
                      </button>
                      <span className="block max-w-[220px] truncate text-xs text-text-muted">
                        {user.email || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-glass-hover px-2 py-0.5 text-xs text-text-secondary">
                        {user.provider === "google" ? "Google" : "Password"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          user.role === "admin"
                            ? "bg-accent/15 text-accent"
                            : "bg-glass-hover text-text-muted",
                        )}
                      >
                        {user.role}
                      </span>
                      {user.banned_until !== null || user.ban_id ? (
                        <span className="ml-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                          Banned
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          user.storage_tier === "premium"
                            ? "bg-success/15 text-success"
                            : "bg-glass-hover text-text-muted",
                        )}
                      >
                        {user.storage_tier === "premium" ? "Premium" : "Free"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                      {user.book_count}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                      {user.chat_count}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {relTime(user.last_active_at)}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="View details"
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                          className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
                        >
                          <ExternalLink size={15} />
                        </button>
                        {user.role === "user" ? (
                          <button
                            type="button"
                            title="Make admin"
                            disabled={acting === user.id}
                            onClick={() => handleRoleChange(user.id, "admin")}
                            className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-accent disabled:opacity-40"
                          >
                            <ShieldCheck size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Remove admin"
                            disabled={acting === user.id}
                            onClick={() => handleRoleChange(user.id, "user")}
                            className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
                          >
                            <ShieldOff size={15} />
                          </button>
                        )}
                        {user.ban_id ? (
                          <button
                            type="button"
                            title="Lift ban"
                            disabled={acting === user.id}
                            onClick={() => handleLiftBan(user.ban_id!, user.id)}
                            className="rounded-control p-1.5 text-success transition-colors hover:bg-glass-hover disabled:opacity-40"
                          >
                            <ShieldOff size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Ban user"
                            disabled={acting === user.id}
                            onClick={() => {
                              setBanTarget(user.id);
                              setBanReason("");
                              setBanDays("7");
                            }}
                            className="rounded-control p-1.5 text-danger transition-colors hover:bg-glass-hover disabled:opacity-40"
                          >
                            <ShieldBan size={15} />
                          </button>
                        )}
                        {acting === user.id && (
                          <Loader2 size={14} className="animate-spin text-accent" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {usersTotal.toLocaleString()} user{usersTotal === 1 ? "" : "s"}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-3">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-text-secondary">
              {page + 1} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Ban modal (styled, not a native prompt) */}
      <FormModal
        open={banTarget !== null}
        onClose={() => setBanTarget(null)}
        title="Ban user"
        icon={ShieldBan}
        size="sm"
        onSubmit={() => void handleBan()}
        submitLabel="Confirm ban"
        submitting={acting === banTarget}
        submitDisabled={!banReason.trim()}
      >
        <div className="space-y-1.5">
          <label htmlFor="ban-reason" className="block text-[13px] font-medium text-text-secondary">
            Reason
          </label>
          <input
            id="ban-reason"
            type="text"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Why is this user being banned?"
            autoComplete="off"
            className={cn(fieldClass, "w-full")}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ban-days" className="block text-[13px] font-medium text-text-secondary">
            Days (leave empty for permanent)
          </label>
          <input
            id="ban-days"
            type="number"
            min={1}
            value={banDays}
            onChange={(e) => setBanDays(e.target.value)}
            className={cn(fieldClass, "w-full")}
          />
        </div>
      </FormModal>
    </div>
  );
}
