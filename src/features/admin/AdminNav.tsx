import { NavLink } from "react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  BarChart3,
  Gauge,
  Users,
  Flag,
  BookMarked,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";

/** Left-sidebar submenu for the admin hub, modeled on the settings
 *  TabNav (grouped NavLinks on desktop, a dropdown on mobile). Labels
 *  are plain English to match the rest of the admin panel. */
type AdminGroup = "insights" | "moderation" | "system";

export interface AdminTabDef {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: AdminGroup;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ADMIN_TABS: AdminTabDef[] = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "insights" },
  { to: "analytics", label: "Analytics", icon: BarChart3, group: "insights" },
  { to: "quota", label: "AI Quota", icon: Gauge, group: "insights" },
  { to: "users", label: "Users", icon: Users, group: "moderation" },
  { to: "reports", label: "Reports", icon: Flag, group: "moderation" },
  { to: "catalog", label: "Catalog", icon: BookMarked, group: "moderation" },
  { to: "errors", label: "Errors", icon: TriangleAlert, group: "system" },
];

const GROUP_ORDER: AdminGroup[] = ["insights", "moderation", "system"];
const GROUP_LABEL: Record<AdminGroup, string> = {
  insights: "Insights",
  moderation: "Moderation",
  system: "System",
};

export function AdminNav({ currentTo }: { currentTo: string }) {
  const isMobile = useIsMobile();
  if (isMobile) return <AdminNavDropdown currentTo={currentTo} />;
  return (
    <nav className="sticky top-4 flex flex-col gap-1 self-start">
      {GROUP_ORDER.map((group) => (
        <div key={group} className="mb-2 flex flex-col gap-0.5">
          <span className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2">
            {GROUP_LABEL[group]}
          </span>
          {ADMIN_TABS.filter((tab) => tab.group === group).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
                )
              }
            >
              <tab.icon size={18} className="shrink-0" />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function AdminNavDropdown({ currentTo }: { currentTo: string }) {
  const [open, setOpen] = useState(false);
  const current = ADMIN_TABS.find((tab) => tab.to === currentTo) ?? ADMIN_TABS[0];
  const Icon = current.icon;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="field flex w-full cursor-pointer items-center justify-between gap-2 py-2.5 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} />
          {current.label}
        </span>
        <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-panel bg-bg-tertiary p-1 shadow-page">
          {ADMIN_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-control px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:bg-surface-3/60 hover:text-text-primary",
                )
              }
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
