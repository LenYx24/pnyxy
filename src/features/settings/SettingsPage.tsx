import { Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon } from "lucide-react";
import { SETTINGS_TABS, TabNav } from "./TabNav";

/**
 * Tabbed shell. The active tab component renders inside <Outlet />;
 * see `src/app/router.tsx` for the child routes.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
  const currentTab =
    SETTINGS_TABS.find((tab) => tab.to === lastSegment) ?? SETTINGS_TABS[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-3 py-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <SettingsIcon size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("settings.title")}
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <TabNav currentTo={currentTab.to} />
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
