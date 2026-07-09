import { useState } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  GraduationCap,
  LogIn,
  Menu,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useReaderStore } from "@/stores/reader-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { OrgSwitcher } from "./OrgSwitcher";
import { visibleSidebarItems, type NavItem } from "@/lib/navigation";

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, profile } = useAuthStore();
  const isDesktop = useIsDesktop();
  // Reader nav item only shows when there's an open book to return to
  const hasActiveBook = useReaderStore(
    (s) => s.activeDocumentId !== null && s.documents.has(s.activeDocumentId),
  );

  const collapsed = isDesktop && sidebarCollapsed;
  const isAdmin = profile?.role === "admin";

  const allItems = visibleSidebarItems({ hasActiveBook, isAdmin });
  const primaryItems = allItems.filter((i) => i.group === "primary");
  const studyItems = allItems.filter((i) => i.group === "study");
  const profileGroupItems = allItems.filter((i) => i.group === "profile");

  // study submenu, collapsed by default, session-only
  const [studyOpen, setStudyOpen] = useState(false);

  const initial = (
    profile?.display_name?.[0] ?? user?.email?.[0] ?? "?"
  ).toUpperCase();

  return (
    <>
      <div
        className={cn(
          "flex h-14 items-center border-b border-glass-border px-4",
          collapsed && "px-2",
        )}
      >
        {/* logo also acts as the home link */}
        <NavLink
          to="/"
          aria-label="Pnyxy home"
          className={cn(
            "flex min-w-0 items-center overflow-hidden",
            collapsed && "hidden",
          )}
          onClick={onNavigate}
        >
          <img src="/logo.svg" alt="Pnyxy" className="h-10 w-auto" />
        </NavLink>
        {/* collapse toggle, desktop only (tablet closes via the X below) */}
        {isDesktop && (
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
            className={cn(
              "rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
              collapsed ? "mx-auto" : "ml-auto",
            )}
          >
            <Menu size={20} />
          </button>
        )}
        {/* Close button for tablet overlay */}
        {!isDesktop && onNavigate && (
          <button
            onClick={onNavigate}
            className="ml-auto rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {primaryItems.map((item) => (
          <div key={item.to}>
            <SidebarNavItem
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
            {/* study submenu, anchored just below Chat */}
            {item.key === "chat" && studyItems.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setStudyOpen((v) => !v)}
                  title={t("sidebar.study")}
                  className="mt-1 flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                >
                  <GraduationCap size={20} className="shrink-0" />
                  <SidebarLabel collapsed={collapsed}>
                    {t("sidebar.study")}
                  </SidebarLabel>
                  {!collapsed && (
                    <ChevronDown
                      size={14}
                      className={cn(
                        "ml-auto shrink-0 transition-transform",
                        studyOpen && "rotate-180",
                      )}
                    />
                  )}
                </button>
                {/* collapsed rail: icon-only rows; expanded: indented list */}
                {studyOpen && (
                  <div
                    className={cn("mt-1 space-y-1", !collapsed && "pl-3")}
                  >
                    {studyItems.map((studyItem) => (
                      <SidebarNavItem
                        key={studyItem.to}
                        item={studyItem}
                        collapsed={collapsed}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </nav>

      {/* org switcher, signed-in only */}
      {user && (
        <OrgSwitcher collapsed={collapsed} onNavigate={onNavigate} />
      )}

      {/* admin link, sits above the profile block */}
      {profileGroupItems.map((item) => (
        <SidebarNavItem
          key={item.to}
          item={item}
          collapsed={collapsed}
          onNavigate={onNavigate}
          variant="profile-group"
        />
      ))}

      {/* profile row + settings gear are siblings so the gear stays
          clickable when the avatar NavLink is active. collapsed: stack. */}
      {user ? (
        <div
          className={cn(
            "flex gap-1 border-t border-glass-border px-2 py-2",
            collapsed ? "flex-col items-center" : "items-center",
          )}
        >
          <NavLink
            to="/profile"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-lg px-1.5 py-1.5 transition-colors",
                collapsed ? "w-full justify-center" : "min-w-0 flex-1",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
              <span className="text-sm font-bold text-accent">
                {initial}
              </span>
            </div>
            <SidebarLabel collapsed={collapsed}>
              <span className="block truncate text-sm font-medium">
                {profile?.display_name || t("sidebar.noName")}
              </span>
            </SidebarLabel>
          </NavLink>
          <NavLink
            to="/settings"
            onClick={onNavigate}
            title={t("sidebar.settings")}
            aria-label={t("sidebar.settings")}
            className={({ isActive }) =>
              cn(
                "shrink-0 rounded-md p-1.5 transition-colors",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <SettingsIcon size={16} />
          </NavLink>
        </div>
      ) : (
        <NavLink
          to="/auth"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center border-t border-glass-border py-3 transition-colors",
              collapsed ? "px-2 justify-center" : "px-3",
              isActive
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )
          }
        >
          <LogIn size={20} className="shrink-0" />
          <SidebarLabel collapsed={collapsed}>
            <span className="text-sm font-medium">{t("sidebar.signIn")}</span>
          </SidebarLabel>
        </NavLink>
      )}
    </>
  );
}

// icon stays at px-3, label collapses in place via max-width+opacity so
// nothing gets unmounted or re-justified (avoids the icon teleport jank).
function SidebarNavItem({
  item,
  collapsed,
  onNavigate,
  variant,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  variant?: "profile-group";
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(`sidebar.${item.key}`);
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={label}
      // exact match: without `end` NavLink prefix-matches and /quizzes
      // stays highlighted on /quizzes/review
      end
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          variant === "profile-group" && "mx-2",
          isActive
            ? "bg-accent/15 text-accent"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )
      }
    >
      <Icon size={20} className="shrink-0" />
      <SidebarLabel collapsed={collapsed}>{label}</SidebarLabel>
    </NavLink>
  );
}

// label animates its max-width+opacity to zero on collapse instead of
// unmounting. nowrap+overflow-hidden stop the text wrapping mid-clip.
function SidebarLabel({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out",
        collapsed
          ? "ml-0 max-w-0 opacity-0"
          : "ml-3 max-w-[12rem] opacity-100",
      )}
    >
      {children}
    </span>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const isDesktop = useIsDesktop();

  // mobile + tablet: overlay drawer toggled by the mobileSidebarOpen flag
  if (!isDesktop) {
    return (
      <>
        {/* Backdrop */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        {/* Sidebar overlay */}
        <aside
          style={{
            top: "var(--titlebar-h)",
            height: "calc(100dvh - var(--titlebar-h))",
          }}
          className={cn(
            "fixed left-0 top-0 z-50 flex w-sidebar-expanded max-w-[85vw] flex-col border-r border-glass-border bg-bg-secondary/95 backdrop-blur-xl",
            "transition-transform duration-300",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SidebarContent onNavigate={() => setMobileSidebarOpen(false)} />
        </aside>
      </>
    );
  }

  // desktop: fixed sidebar. transition-[width] (not -all) + overflow-hidden
  // so width animates while inner text clips instead of reflowing.
  return (
    <aside
      // top/height offset by the title bar (0 in the browser)
      style={{
        top: "var(--titlebar-h)",
        height: "calc(100vh - var(--titlebar-h))",
      }}
      className={cn(
        "fixed left-0 top-0 z-40 flex flex-col overflow-hidden border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl",
        "transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-sidebar-collapsed" : "w-sidebar-expanded",
      )}
    >
      <SidebarContent />
    </aside>
  );
}
