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
  // Reader item is conditional on there being a book to return to —
  // this matches the user's mental model: "Reader" only makes sense
  // as a destination if you have something open.
  const hasActiveBook = useReaderStore(
    (s) => s.activeDocumentId !== null && s.documents.has(s.activeDocumentId),
  );

  const collapsed = isDesktop && sidebarCollapsed;
  const isAdmin = profile?.role === "admin";

  const allItems = visibleSidebarItems({ hasActiveBook, isAdmin });
  const primaryItems = allItems.filter((i) => i.group === "primary");
  const studyItems = allItems.filter((i) => i.group === "study");
  const profileGroupItems = allItems.filter((i) => i.group === "profile");

  // Study submenu — collapsed by default, session-only state. The
  // user said the goal is reduced clutter, so revealing 4 extra
  // study links should be an explicit click each session.
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
        {/* Logo doubles as the home link — replacing the standalone
            "Home" nav item we used to render separately. */}
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
        {/* Hamburger collapse toggle — desktop only (on tablet the
            sidebar is an overlay closed via the X below). */}
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
            {/* Study submenu — collapsible group containing the
                lower-traffic study tools (quizzes, review,
                vocabulary, roadmaps). Anchored just below Chat so
                related "thinking-mode" tools sit together. */}
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
                {studyOpen && !collapsed && (
                  <div className="mt-1 space-y-1 pl-3">
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

      {/* Org switcher — pinned above the profile row, Notion-style.
          Only shown when there are orgs to pick from (i.e. when
          signed in). */}
      {user && (
        <OrgSwitcher collapsed={collapsed} onNavigate={onNavigate} />
      )}

      {/* Admin link, when present, sits above the profile block. */}
      {profileGroupItems.map((item) => (
        <SidebarNavItem
          key={item.to}
          item={item}
          collapsed={collapsed}
          onNavigate={onNavigate}
          variant="profile-group"
        />
      ))}

      {/* Profile row + settings gear. The two are siblings so the gear
          stays visible (and clickable) even when the avatar row's
          NavLink is the active route. When the rail is collapsed they
          stack vertically — avatar on top, gear below — so the gear
          stays reachable as an icon instead of disappearing. */}
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
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/15">
              <span className="text-sm font-bold text-accent-purple">
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
                  ? "bg-accent-purple/15 text-accent-purple"
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
              "flex items-center border-t border-glass-border px-3 py-3 transition-colors",
              isActive
                ? "bg-accent-purple/15 text-accent-purple"
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

/**
 * One nav row. Layout stays identical between expanded and collapsed
 * — the icon is always at `px-3` and the label collapses *in place*
 * via max-width + opacity. This is what fixes the old "icons teleport
 * to centre" jank: nothing is unmounted, nothing toggles
 * `justify-center`, the row just narrows alongside the container.
 */
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
      // Exact match for every sidebar item — without `end`,
      // NavLink does a prefix match, so `/quizzes` ended up
      // co-highlighted whenever the user was on
      // `/quizzes/review`. The sub-route already has its own
      // entry in the Study submenu; the prefix-match was just
      // double-painting the active state.
      end
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          variant === "profile-group" && "mx-2",
          isActive
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )
      }
    >
      <Icon size={20} className="shrink-0" />
      <SidebarLabel collapsed={collapsed}>{label}</SidebarLabel>
    </NavLink>
  );
}

/**
 * Wraps a label so it animates *in place* when the sidebar collapses
 * — the span keeps occupying its slot in the layout but its
 * max-width + opacity transition to zero, so the icon never jumps.
 * `whitespace-nowrap` + `overflow-hidden` keep mid-animation text
 * from wrapping into a second line as it clips.
 */
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

  // Mobile + tablet: overlay sidebar with backdrop. Same drawer
  // behaviour at both breakpoints — the BottomNav's "More" entry
  // and the reader/chat toolbar buttons all toggle the same store
  // flag (`mobileSidebarOpen`), so the drawer is the single
  // "everything else" surface on smaller screens.
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
          className={cn(
            "fixed left-0 top-0 z-50 flex h-[100dvh] w-sidebar-expanded max-w-[85vw] flex-col border-r border-glass-border bg-bg-secondary/95 backdrop-blur-xl",
            "transition-transform duration-300",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SidebarContent onNavigate={() => setMobileSidebarOpen(false)} />
        </aside>
      </>
    );
  }

  // Desktop: fixed sidebar (current behavior).
  // transition-[width] (not transition-all) + overflow-hidden: width
  // animates smoothly while inner text clips instead of reflowing.
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col overflow-hidden border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl",
        "transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-sidebar-collapsed" : "w-sidebar-expanded",
      )}
    >
      <SidebarContent />
    </aside>
  );
}
