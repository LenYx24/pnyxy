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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";

const baseNavItems = [
  { to: "/app/browse", icon: Compass, label: "Browse" },
  { to: "/app/library", icon: Library, label: "Library" },
  { to: "/app/reader", icon: BookOpen, label: "Reader" },
  { to: "/app/streaks", icon: Flame, label: "Streaks" },
  { to: "/app/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, profile } = useAuthStore();

  const navItems = profile?.role === "admin"
    ? [...baseNavItems, { to: "/app/admin", icon: Shield, label: "Admin" }]
    : baseNavItems;

  const initial = (
    profile?.display_name?.[0] ?? user?.email?.[0] ?? "?"
  ).toUpperCase();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl",
        "transition-all duration-300",
        sidebarCollapsed ? "w-sidebar-collapsed" : "w-sidebar-expanded",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-glass-border px-4",
          sidebarCollapsed && "justify-center px-0",
        )}
      >
        {!sidebarCollapsed && (
          <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-lg font-bold text-transparent">
            Pnyxy
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                sidebarCollapsed && "justify-center px-0",
                isActive
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <Icon size={20} />
            {!sidebarCollapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Profile / Sign in section */}
      {user ? (
        <NavLink
          to="/app/profile"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 border-t border-glass-border px-3 py-3 transition-colors",
              sidebarCollapsed && "justify-center px-0",
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
          {!sidebarCollapsed && (
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
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 border-t border-glass-border px-3 py-3 transition-colors",
              sidebarCollapsed && "justify-center px-0",
              isActive
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )
          }
        >
          <LogIn size={20} />
          {!sidebarCollapsed && <span className="text-sm font-medium">Sign in</span>}
        </NavLink>
      )}

      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center border-t border-glass-border p-3 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        {sidebarCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
      </button>
    </aside>
  );
}
