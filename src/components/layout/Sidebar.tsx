import { NavLink } from "react-router";
import {
  Library,
  BookOpen,
  Flame,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

const navItems = [
  { to: "/app/library", icon: Library, label: "Library" },
  { to: "/app/reader", icon: BookOpen, label: "Reader" },
  { to: "/app/streaks", icon: Flame, label: "Streaks" },
  { to: "/app/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

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

      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center border-t border-glass-border p-3 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        {sidebarCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
      </button>
    </aside>
  );
}
