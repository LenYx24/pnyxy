import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { UserCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, signOut, updateProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
            <UserCircle size={20} className="text-accent-purple" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
        </div>

        <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6 text-center">
          <p className="text-text-secondary">
            Sign in to manage your profile.
          </p>
          <Link to="/auth">
            <Button>
              <LogIn size={16} />
              Sign In
            </Button>
          </Link>
        </section>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateProfile({ display_name: displayName || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <UserCircle size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
      </div>

      {/* Avatar & info section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-purple/15">
            <span className="text-2xl font-bold text-accent-purple">
              {(profile?.display_name?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-lg font-semibold text-text-primary">
              {profile?.display_name || "No display name"}
            </p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
        </div>
      </section>

      {/* Edit section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6">
        <h2 className="text-lg font-semibold text-text-primary">
          Edit Profile
        </h2>

        <div>
          <label
            htmlFor="display-name"
            className="mb-1 block text-sm font-medium text-text-secondary"
          >
            Display Name
          </label>
          <input
            id="display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted backdrop-blur-md outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25"
            placeholder="Your display name"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <span className="text-sm text-green-400">Saved!</span>
          )}
        </div>
      </section>

      {/* Account section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6">
        <h2 className="text-lg font-semibold text-text-primary">Account</h2>
        <Button variant="secondary" onClick={handleSignOut}>
          Sign Out
        </Button>
      </section>
    </div>
  );
}
