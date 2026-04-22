import { ShieldX, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";

export function BannedScreen() {
  const { t } = useTranslation();
  const { banInfo, signOut } = useAuthStore();

  const expiry = banInfo?.banned_until
    ? t("admin.banned.until", {
        date: new Date(banInfo.banned_until).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : t("admin.banned.permanently");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-6">
      <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-bg-secondary/95 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15">
          <ShieldX className="h-8 w-8 text-red-400" />
        </div>

        <h1 className="mb-2 text-2xl font-bold text-text-primary">
          {t("admin.banned.title")}
        </h1>

        <p className="mb-4 text-text-secondary">
          {t("admin.banned.bodyTemplate", { expiry })}
        </p>

        {banInfo?.reason && (
          <div className="mb-6 rounded-lg border border-glass-border bg-glass-bg p-4 text-left">
            <p className="mb-1 text-xs font-medium uppercase text-text-muted">
              {t("admin.banned.reason")}
            </p>
            <p className="text-sm text-text-secondary">{banInfo.reason}</p>
          </div>
        )}

        <Button variant="secondary" onClick={() => signOut()}>
          <LogOut size={16} />
          {t("admin.banned.signOut")}
        </Button>
      </div>
    </div>
  );
}
