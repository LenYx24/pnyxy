import { Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { SETTINGS_TABS, TabNav } from "./TabNav";

/**
 * Tabbed shell. The active tab component renders inside <Outlet />;
 * see `src/app/router.tsx` for the child routes.
 *
 * Desktop: 220 px grouped nav on the left, the content column fills
 * the rest up to 960 px. Mobile: dropdown above the content.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
  const currentTab =
    SETTINGS_TABS.find((tab) => tab.to === lastSegment) ?? SETTINGS_TABS[0];

  return (
    <div className="w-full px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,960px)] md:gap-8">
        <TabNav currentTo={currentTab.to} />
        <div className="min-w-0 space-y-6">
          <h1 className="font-display text-[22px] font-semibold leading-tight text-text-primary">
            {t(`settings.${currentTab.labelKey}`)}
          </h1>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
