import { Outlet, useLocation } from "react-router";
import { Shield } from "lucide-react";
import { AdminGuard } from "./AdminGuard";
import { ADMIN_TABS, AdminNav } from "./AdminNav";

/**
 * Admin hub shell. A left-sidebar submenu (AdminNav) plus the active
 * sub-section rendered in <Outlet />; the child routes live in
 * src/app/router.tsx, so each section is URL-addressable
 * (/admin/analytics, /admin/users, ...) and survives a refresh.
 */
export function AdminPage() {
  const { pathname } = useLocation();
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
  const currentTab =
    ADMIN_TABS.find((tab) => tab.to === lastSegment) ?? ADMIN_TABS[0];

  return (
    <AdminGuard>
      <div className="w-full px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center gap-3">
            <Shield className="h-6 w-6 text-accent" />
            <h1 className="text-2xl font-bold text-text-primary">Admin</h1>
          </div>
          <div className="grid gap-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
            <AdminNav currentTo={currentTab.to} />
            <div className="min-w-0 space-y-6">
              <h2 className="text-lg font-semibold text-text-primary">
                {currentTab.label}
              </h2>
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
