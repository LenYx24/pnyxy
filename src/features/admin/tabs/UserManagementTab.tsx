import { useEffect, useState } from "react";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ShieldBan,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { useAdminStore } from "@/stores/admin-store";
import type { UserRole } from "@/types/database";

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [banForm, setBanForm] = useState<{
    userId: string;
    reason: string;
    days: string;
  } | null>(null);

  useEffect(() => {
    fetchUsers(page);
  }, [fetchUsers, page]);

  const totalPages = Math.ceil(usersTotal / PAGE_SIZE);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setActing(userId);
    try {
      await updateUserRole(userId, role);
    } finally {
      setActing(null);
    }
  };

  const handleBan = async () => {
    if (!banForm) return;
    setActing(banForm.userId);
    try {
      const days = banForm.days.trim() === "" ? null : Number(banForm.days);
      await banUser(banForm.userId, banForm.reason, days);
      setBanForm(null);
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

  if (usersLoading && users.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {users.map((user) => (
        <div
          key={user.id}
          className="rounded-xl border border-glass-border bg-glass-bg p-4 backdrop-blur-md"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-text-primary">
                  {user.display_name || "No name"}
                </p>
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
                {user.activeBan && (
                  <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                    Banned
                    {user.activeBan.banned_until
                      ? ` until ${new Date(user.activeBan.banned_until).toLocaleDateString()}`
                      : " permanently"}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">
                Joined {new Date(user.created_at).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {user.role === "user" ? (
                <Button
                  variant="ghost"
                  disabled={acting === user.id}
                  onClick={() => handleRoleChange(user.id, "admin")}
                >
                  <ShieldCheck size={14} />
                  Make Admin
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={acting === user.id}
                  onClick={() => handleRoleChange(user.id, "user")}
                >
                  <ShieldOff size={14} />
                  Remove Admin
                </Button>
              )}

              {user.activeBan ? (
                <Button
                  variant="ghost"
                  disabled={acting === user.id}
                  onClick={() =>
                    handleLiftBan(user.activeBan!.id, user.id)
                  }
                >
                  <ShieldOff size={14} className="text-success" />
                  Lift Ban
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={acting === user.id}
                  onClick={() =>
                    setBanForm({
                      userId: user.id,
                      reason: "",
                      days: "7",
                    })
                  }
                >
                  <ShieldBan size={14} className="text-danger" />
                  Ban
                </Button>
              )}

              {acting === user.id && (
                <Loader2 size={16} className="animate-spin text-accent" />
              )}
            </div>
          </div>

          {/* Inline ban form */}
          {banForm?.userId === user.id && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-glass-border pt-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-text-muted">
                  Reason
                </label>
                <input
                  type="text"
                  value={banForm.reason}
                  onChange={(e) =>
                    setBanForm((f) => f && { ...f, reason: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  placeholder="Ban reason"
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs text-text-muted">
                  Days (empty = perma)
                </label>
                <input
                  type="number"
                  min={1}
                  value={banForm.days}
                  onChange={(e) =>
                    setBanForm((f) => f && { ...f, days: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-center text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <Button
                variant="primary"
                disabled={!banForm.reason.trim()}
                onClick={handleBan}
              >
                Confirm Ban
              </Button>
              <Button variant="ghost" onClick={() => setBanForm(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-text-secondary">
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
