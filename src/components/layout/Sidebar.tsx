import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Home,
  Compass,
  Library,
  BookOpen,
  BookMarked,
  Flame,
  Map,
  MessagesSquare,
  FileQuestion,
  BrainCircuit,
  Settings,
  Shield,
  LogIn,
  Menu,
  X,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";

const baseNavItems = [
  { to: "/", icon: Home, key: "home" as const },
  { to: "/browse", icon: Compass, key: "browse" as const },
  { to: "/library", icon: Library, key: "library" as const },
  { to: "/reader", icon: BookOpen, key: "reader" as const },
  { to: "/chat", icon: Bot, key: "chat" as const },
  { to: "/quizzes", icon: FileQuestion, key: "quizzes" as const },
  { to: "/quizzes/review", icon: BrainCircuit, key: "review" as const },
  { to: "/vocabulary", icon: BookMarked, key: "vocabulary" as const },
  { to: "/streaks", icon: Flame, key: "streaks" as const },
  { to: "/roadmaps", icon: Map, key: "roadmaps" as const },
  { to: "/forum", icon: MessagesSquare, key: "forum" as const },
  { to: "/settings", icon: Settings, key: "settings" as const },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, profile } = useAuthStore();
  const isDesktop = useIsDesktop();

  const collapsed = isDesktop && sidebarCollapsed;

  const navItems = profile?.role === "admin"
    ? [...baseNavItems, { to: "/admin", icon: Shield, key: "admin" as const }]
    : baseNavItems;

  const initial = (
    profile?.display_name?.[0] ?? user?.email?.[0] ?? "?"
  ).toUpperCase();

  return (
    <>
      <div
        className={cn(
          "flex h-14 items-center border-b border-glass-border px-4",
          collapsed && "justify-center px-2",
        )}
      >
        {!collapsed && (
          <NavLink to="/" aria-label="Pnyxy home" className="flex items-center">
            <img src="/logo.svg" alt="Pnyxy" className="h-10 w-auto" />
          </NavLink>
        )}
        {/* Hamburger collapse toggle — desktop only (on tablet the
            sidebar is an overlay closed via the X below). */}
        {isDesktop && (
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
            className="ml-auto rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
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

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, icon: Icon, key }) => {
          const label = t(`sidebar.${key}`);
          return (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              title={label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-accent-purple/15 text-accent-purple"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )
              }
            >
              <Icon size={20} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Profile / Sign in section */}
      {user ? (
        <NavLink
          to="/profile"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 border-t border-glass-border px-3 py-3 transition-colors",
              collapsed && "justify-center px-0",
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
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {profile?.display_name || "No name"}
              </p>
              <p className="truncate text-xs text-text-muted">
                {user.email}
              </p>
            </div>
          )}
        </NavLink>
      ) : (
        <NavLink
          to="/auth"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 border-t border-glass-border px-3 py-3 transition-colors",
              collapsed && "justify-center px-0",
              isActive
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )
          }
        >
          <LogIn size={20} />
          {!collapsed && (
            <span className="text-sm font-medium">{t("sidebar.signIn")}</span>
          )}
        </NavLink>
      )}

      {/* Collapse-toggle button removed in favor of the top-of-page
          breadcrumb bar (AppLayout → Breadcrumbs). Ctrl+B still toggles
          the collapse for keyboard users. */}
    </>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  // Mobile: sidebar hidden entirely (BottomNav handles navigation)
  if (isMobile) return null;

  // Tablet: overlay sidebar with backdrop
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
            "fixed left-0 top-0 z-50 flex h-screen w-sidebar-expanded flex-col border-r border-glass-border bg-bg-secondary/95 backdrop-blur-xl",
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
