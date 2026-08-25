import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { LogIn, Upload, Loader2, Trash2, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui";
import { SettingRow, SettingsSection, StatusLine } from "@/features/settings/ui";
import { useAuthStore } from "@/stores/auth-store";
import { containsProfanity } from "@/lib/profanity-filter";
import { PlanSection } from "./PlanSection";

export function ProfilePage() {
  const { t } = useTranslation();
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
  // Single source of truth for the "an upload is in flight" gate. The
  // global paste listener fires from a closure that may have a stale
  // `avatarBusy` state value, so we read this ref instead.
  const busyRef = useRef(false);

  const displayNameFlagged = containsProfanity(displayName);

  async function uploadFile(file: File) {
    if (busyRef.current) return;
    busyRef.current = true;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      if (err instanceof Error) setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
      busyRef.current = false;
    }
  }

  // Listen for paste anywhere on the profile page. If the clipboard
  // contains an image (e.g. a screenshot or a copied image from
  // another tab), upload it as the avatar. Text pastes have no image
  // items, so they fall through and the input below still receives
  // them normally.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!useAuthStore.getState().user) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void uploadFile(file);
            return;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // uploadFile is stable enough, it only reads from refs/setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-4 sm:px-6 sm:py-6">
        <h1 className="font-display text-[22px] font-semibold leading-tight text-text-primary">
          {t("profile.title")}
        </h1>

        <div className="space-y-4 rounded-panel bg-bg-tertiary p-6 text-center">
          <p className="text-[15px] text-text-secondary">{t("profile.signInPrompt")}</p>
          <Link to="/auth">
            <Button>
              <LogIn size={16} />
              {t("auth.signIn")}
            </Button>
          </Link>
        </div>
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
    await uploadFile(file);
  }

  // Mobile-friendly fallback for keyboards without Ctrl+V. Reads the
  // OS clipboard via the async Clipboard API; the click counts as the
  // user gesture browsers require for clipboard reads.
  async function pasteFromClipboard() {
    if (busyRef.current) return;
    setAvatarError(null);
    if (!navigator.clipboard?.read) {
      setAvatarError(t("profile.pasteUnsupported"));
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) =>
          type.startsWith("image/"),
        );
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = imageType.split("/")[1] ?? "png";
        const file = new File([blob], `pasted.${ext}`, { type: imageType });
        await uploadFile(file);
        return;
      }
      setAvatarError(t("profile.pasteNoImage"));
    } catch (err) {
      if (err instanceof Error) setAvatarError(err.message);
      else setAvatarError(t("profile.pasteFailed"));
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
    <div className="mx-auto w-full max-w-3xl space-y-8 px-3 py-4 sm:px-6 sm:py-6">
      <h1 className="font-display text-[22px] font-semibold leading-tight text-text-primary">
        {t("profile.title")}
      </h1>

      <SettingsSection title={t("profile.editSection")}>
        <div className="flex flex-col gap-4 py-3 sm:flex-row sm:items-center">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-panel object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-panel bg-surface-3">
              <span className="font-display text-3xl font-semibold text-text-primary">
                {initial}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-text-primary">
              {profile?.display_name || t("profile.noDisplayName")}
            </p>
            <p className="truncate text-[13px] text-text-muted">{user.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerFilePicker}
                disabled={avatarBusy}
              >
                {avatarBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {profile?.avatar_url
                  ? t("profile.changeAvatar")
                  : t("profile.uploadAvatar")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={pasteFromClipboard}
                disabled={avatarBusy}
                title={t("profile.pasteAvatarTitle")}
              >
                <ClipboardPaste size={14} />
                {t("profile.pasteAvatar")}
              </Button>
              {profile?.avatar_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveAvatar}
                  disabled={avatarBusy}
                >
                  <Trash2 size={14} />
                  {t("profile.removeAvatar")}
                </Button>
              )}
            </div>
            {avatarError && (
              <p className="mt-2 text-[13px] text-danger">{avatarError}</p>
            )}
            <p className="mt-2 text-[13px] text-text-muted">
              {t("profile.avatarHint")}
            </p>
          </div>
        </div>

        <SettingRow
          label={t("profile.displayName")}
          htmlFor="display-name"
          stacked
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="field bg-bg-secondary sm:max-w-sm"
              placeholder={t("profile.displayNamePlaceholder")}
            />
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving || displayNameFlagged}>
                {saving ? t("profile.saving") : t("profile.save")}
              </Button>
              {saved && (
                <StatusLine tone="success">{t("profile.savedToast")}</StatusLine>
              )}
              {saveError && <StatusLine tone="danger">{saveError}</StatusLine>}
            </div>
          </div>
          {displayNameFlagged && (
            <p className="mt-2 text-[13px] text-warning">
              {t("profile.displayNameFlagged")}
            </p>
          )}
        </SettingRow>
      </SettingsSection>

      <PlanSection />

      <SettingsSection title={t("profile.accountSection")}>
        <SettingRow
          label={t("profile.accountSection")}
          hint={user.email}
          control={
            <Button variant="secondary" onClick={handleSignOut}>
              {t("profile.signOut")}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
