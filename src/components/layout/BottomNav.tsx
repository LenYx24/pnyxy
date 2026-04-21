import { NavLink } from "react-router";
import {
  Compass,
  Library,
  BookOpen,
  User,
  LogIn,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";

const baseNavItems = [
  { to: "/browse", icon: Compass, label: "Browse" },
  { to: "/library", icon: Library, label: "Library" },
  { to: "/reader", icon: BookOpen, label: "Reader" },
  { to: "/forum", icon: Users, label: "Forum" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function BottomNav() {
  const { user } = useAuthStore();

  // Profile gets its own slot so mobile users can reach account + sign
  // out. Falls back to /auth for signed-out visitors. Streaks (formerly
  // here) is still reachable from the profile page and desktop sidebar.
  const navItems = [
    ...baseNavItems,
    user
      ? { to: "/profile", icon: User, label: "Profile" }
      : { to: "/auth", icon: LogIn, label: "Sign in" },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-glass-border bg-bg-secondary/90 backdrop-blur-xl pb-safe-bottom md:hidden"
      style={{ height: "calc(3.5rem + var(--spacing-safe-bottom, 0px))" }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors touch-target",
              isActive ? "text-accent-purple" : "text-text-muted",
            )
          }
        >
          <Icon size={18} />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
