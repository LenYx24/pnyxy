import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button, FormModal } from "@/components/ui";
import { fieldClass } from "@/components/ui/classes";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { ACCOUNT_DELETED_KEY, useAuthStore } from "@/stores/auth-store";
import { SettingsSection, SettingRow, StatusLine } from "../ui";

/**
 * Self-service, permanent account deletion (GDPR / thesis-pilot
 * consent requirement). Gated behind a typed confirmation (the word
 * DELETE, or the account's own email) rather than a plain OK/Cancel,
 * since this cannot be undone. On success: stash a sessionStorage flag
 * for the post-reload farewell toast (see AuthPage), sign out, and
 * hard-navigate to /auth. `useAuthStore.signOut()` already does the
 * `window.location.replace("/auth")` itself.
 */
export function DeleteAccountSection() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? "";
  const trimmed = confirmText.trim();
  const canConfirm =
    trimmed.length > 0 &&
    (trimmed.toUpperCase() === "DELETE" ||
      (email.length > 0 && trimmed.toLowerCase() === email.toLowerCase()));

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setConfirmText("");
    setError(null);
  };

  const handleDelete = async () => {
    if (!canConfirm || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("delete-account");
      if (fnError) {
        throw fnError;
      }
      try {
        sessionStorage.setItem(ACCOUNT_DELETED_KEY, "1");
      } catch {
        // sessionStorage unavailable: the redirect still happens, just
        // without the farewell toast on the other end
      }
      try {
        await useAuthStore.getState().signOut();
      } catch {
        // The account (and its session) is already gone server-side;
        // signOut()'s own auth.signOut() call can legitimately error
        // here. Force the redirect regardless.
        if (typeof window !== "undefined") {
          window.location.replace("/auth");
        }
      }
    } catch (err) {
      logError("DeleteAccountSection:delete", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setDeleting(false);
    }
  };

  return (
    <SettingsSection
      title={t("settings.dangerZone.heading")}
      description={t("settings.dangerZone.description")}
    >
      <SettingRow
        label={t("settings.dangerZone.deleteLabel")}
        hint={t("settings.dangerZone.deleteHint")}
        control={
          <Button variant="danger" onClick={() => setOpen(true)}>
            <Trash2 size={16} />
            {t("settings.dangerZone.deleteButton")}
          </Button>
        }
      />

      <FormModal
        open={open}
        onClose={close}
        title={t("settings.dangerZone.modalTitle")}
        icon={Trash2}
        size="sm"
        onSubmit={() => void handleDelete()}
        submitLabel={t("settings.dangerZone.confirmButton")}
        submitting={deleting}
        submitDisabled={!canConfirm}
      >
        <p className="text-[13px] text-text-secondary">
          {t("settings.dangerZone.modalIntro")}
        </p>
        <ul className="list-inside list-disc space-y-0.5 text-[13px] text-text-secondary">
          <li>{t("settings.dangerZone.itemLibrary")}</li>
          <li>{t("settings.dangerZone.itemNotes")}</li>
          <li>{t("settings.dangerZone.itemChats")}</li>
          <li>{t("settings.dangerZone.itemCourses")}</li>
          <li>{t("settings.dangerZone.itemEverything")}</li>
        </ul>
        <p className="text-[13px] font-medium text-danger">
          {t("settings.dangerZone.irreversible")}
        </p>
        <div className="space-y-1.5">
          <label
            htmlFor="delete-account-confirm"
            className="block text-[13px] font-medium text-text-secondary"
          >
            {t("settings.dangerZone.confirmLabel", { email: email || "DELETE" })}
          </label>
          <input
            id="delete-account-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t("settings.dangerZone.confirmPlaceholder")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={deleting}
            className={`${fieldClass} w-full`}
          />
        </div>
        {error && <StatusLine tone="danger">{error}</StatusLine>}
      </FormModal>
    </SettingsSection>
  );
}
