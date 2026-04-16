import { useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { UserCircle, LogIn, Upload, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { containsProfanity } from "@/lib/profanity-filter";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, signOut, updateProfile, uploadAvatar, removeAvatar } =
    useAuthStore();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayNameFlagged = containsProfanity(displayName);

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
            <UserCircle size={20} className="text-accent-purple" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
        </div>

        <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-center">
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
    setSaveError(null);
    try {
      await updateProfile({ display_name: displayName || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof Error) setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again still fires a change event.
    e.target.value = "";
    if (!file) return;

    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      if (err instanceof Error) {
        setAvatarError(err.message);
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await removeAvatar();
    } catch (err) {
      if (err instanceof Error) {
        setAvatarError(err.message);
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  const initial = (
    profile?.display_name?.[0] ??
    user.email?.[0] ??
    "?"
  ).toUpperCase();

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
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <div className="flex items-center gap-4">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-purple/15">
              <span className="text-2xl font-bold text-accent-purple">
                {initial}
              </span>
            </div>
          )}
          <div>
            <p className="text-lg font-semibold text-text-primary">
              {profile?.display_name || "No display name"}
            </p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="secondary"
            onClick={triggerFilePicker}
            disabled={avatarBusy}
          >
            {avatarBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            {profile?.avatar_url ? "Change avatar" : "Upload avatar"}
          </Button>
          {profile?.avatar_url && (
            <Button
              variant="ghost"
              onClick={handleRemoveAvatar}
              disabled={avatarBusy}
            >
              <Trash2 size={16} />
              Remove
            </Button>
          )}
        </div>

        {avatarError && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {avatarError}
          </p>
        )}
        <p className="text-xs text-text-muted">
          JPEG, PNG, WebP, or GIF &middot; max 5 MB
        </p>
      </section>

      {/* Edit section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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
          {displayNameFlagged && (
            <p className="mt-1 text-xs text-amber-400">
              That name contains disallowed language.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving || displayNameFlagged}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <span className="text-sm text-green-400">Saved!</span>
          )}
          {saveError && (
            <span className="text-sm text-red-400">{saveError}</span>
          )}
        </div>
      </section>

      {/* Account section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">Account</h2>
        <Button variant="secondary" onClick={handleSignOut}>
          Sign Out
        </Button>
      </section>
    </div>
  );
}
