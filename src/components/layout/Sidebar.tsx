import { NavLink } from "react-router";
import {
  Compass,
  Library,
  BookOpen,
  Flame,
  Settings,
  Shield,
  PanelLeftClose,
  PanelLeft,
  LogIn,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";

const baseNavItems = [
  { to: "/browse", icon: Compass, label: "Browse" },
  { to: "/library", icon: Library, label: "Library" },
  { to: "/reader", icon: BookOpen, label: "Reader" },
  { to: "/streaks", icon: Flame, label: "Streaks" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, profile } = useAuthStore();
  const isDesktop = useIsDesktop();

  const collapsed = isDesktop && sidebarCollapsed;

  const navItems = profile?.role === "admin"
    ? [...baseNavItems, { to: "/admin", icon: Shield, label: "Admin" }]
    : baseNavItems;

  const initial = (
    profile?.display_name?.[0] ?? user?.email?.[0] ?? "?"
  ).toUpperCase();

  return (
    <>
      <div
        className={cn(
          "flex h-14 items-center border-b border-glass-border px-4",
          collapsed && "justify-center px-0",
        )}
      >
        {!collapsed && (
          <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-lg font-bold text-transparent">
            Pnyxy
          </span>
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
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
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
        ))}
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
          {!collapsed && <span className="text-sm font-medium">Sign in</span>}
        </NavLink>
      )}

      {/* Toggle collapse (desktop only) */}
      {isDesktop && (
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center border-t border-glass-border p-3 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </button>
      )}
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

  // Desktop: fixed sidebar (current behavior)
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl",
        "transition-all duration-300",
        sidebarCollapsed ? "w-sidebar-collapsed" : "w-sidebar-expanded",
      )}
    >
      <SidebarContent />
    </aside>
  );
}
