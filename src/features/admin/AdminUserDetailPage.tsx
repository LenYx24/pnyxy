import { useEffect } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Loader2,
  ShieldCheck,
  ShieldBan,
  Mail,
  BookOpen,
  StickyNote,
  ClipboardList,
  MessagesSquare,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAdminStore, type AdminUserDetail } from "@/stores/admin-store";
import { AdminGuard } from "./AdminGuard";
import { serverUnlockedFeatures, FEATURE_META } from "@/lib/features";

/** Read-only admin drill-in: everything known about one user, reached
 *  from the Users tab row and from a catalog book's "Submitted by"
 *  link. Email and usage stats come from the admin_user_detail RPC
 *  (migration 00075); until that migration is deployed, this still
 *  renders the profile fields already available and shows a note
 *  instead of crashing. */
export function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { userDetail, userDetailLoading, userDetailError, fetchUserDetail, clearUserDetail } =
    useAdminStore();

  useEffect(() => {
    if (userId) fetchUserDetail(userId);
    return () => clearUserDetail();
  }, [userId, fetchUserDetail, clearUserDetail]);

  return (
    <AdminGuard>
      <div className="mx-auto max-w-3xl space-y-6 pt-14">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={16} />
          Back to admin
        </Link>

        {userDetailLoading && !userDetail && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        )}

        {userDetailError && !userDetail && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            {userDetailError}
          </p>
        )}

        {userDetail && <UserDetailContent detail={userDetail} />}
      </div>
    </AdminGuard>
  );
}

function UserDetailContent({ detail }: { detail: AdminUserDetail }) {
  const { profile, activeBan, stats, statsError } = detail;
  const unlocked = serverUnlockedFeatures(profile.preferences);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="flex items-center gap-4 rounded-xl border border-glass-border bg-glass-bg p-5 backdrop-blur-md">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-glass-hover text-2xl font-semibold text-text-primary">
            {(profile.display_name?.[0] ?? "?").toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-lg font-semibold text-text-primary">
              {profile.display_name || "No name"}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                profile.role === "admin"
                  ? "bg-accent/15 text-accent"
                  : "bg-glass-hover text-text-muted",
              )}
            >
              {profile.role === "admin" && <ShieldCheck size={12} />}
              {profile.role}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                profile.storage_tier === "premium"
                  ? "bg-success/15 text-success"
                  : "bg-glass-hover text-text-muted",
              )}
            >
              {profile.storage_tier === "premium" ? "Premium" : "Free"}
            </span>
            {activeBan && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                <ShieldBan size={12} />
                Banned
                {activeBan.banned_until
                  ? ` until ${new Date(activeBan.banned_until).toLocaleDateString()}`
                  : " permanently"}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-text-muted">{profile.id}</p>
          {stats?.email && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
              <Mail size={13} />
              {stats.email}
            </p>
          )}
        </div>
      </div>

      {/* Profile fields */}
      <div className="rounded-xl border border-glass-border bg-glass-bg p-5 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Profile</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Joined" value={new Date(profile.created_at).toLocaleString()} />
          <Field label="Onboarded" value={profile.onboarded ? "Yes" : "No"} />
          <Field
            label="Subscription status"
            value={profile.subscription_status ?? "None"}
          />
          <Field
            label="Current period end"
            value={
              profile.current_period_end
                ? new Date(profile.current_period_end).toLocaleDateString()
                : "N/A"
            }
          />
          <Field
            label="Research consent"
            value={
              typeof profile.preferences?.consent_research_at === "string"
                ? new Date(profile.preferences.consent_research_at as string).toLocaleDateString()
                : "Not given"
            }
          />
          <Field
            label="Unlocked features"
            value={
              unlocked.length > 0
                ? unlocked.map((k) => FEATURE_META[k]?.label ?? k).join(", ")
                : "None (defaults)"
            }
          />
        </dl>
      </div>

      {/* Usage stats */}
      <div className="rounded-xl border border-glass-border bg-glass-bg p-5 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Usage stats</h2>
        {stats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile icon={BookOpen} label="Books" value={stats.books_count} />
            <StatTile icon={StickyNote} label="Notes" value={stats.notes_count} />
            <StatTile icon={ClipboardList} label="Quizzes" value={stats.quizzes_count} />
            <StatTile icon={MessagesSquare} label="Chats" value={stats.conversations_count} />
            <StatTile icon={Zap} label="Tokens (30d)" value={stats.tokens_30d} />
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Stats need deploy: the admin_user_detail RPC (migration 00075) has not been
            applied to this database yet.
            {statsError && (
              <span className="mt-1 block font-mono text-xs text-text-muted/80">
                {statsError}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-sm text-text-primary">{value}</dd>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg bg-glass-hover p-3 text-center">
      <Icon size={16} className="mx-auto mb-1 text-accent" />
      <p className="text-lg font-semibold text-text-primary">{value.toLocaleString()}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
