import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
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
  { to: "/browse", icon: Compass, key: "browse" as const },
  { to: "/library", icon: Library, key: "library" as const },
  { to: "/reader", icon: BookOpen, key: "reader" as const },
  { to: "/forum", icon: Users, key: "forum" as const },
  { to: "/settings", icon: Settings, key: "settings" as const },
];

export function BottomNav() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  const navItems = [
    ...baseNavItems,
    user
      ? { to: "/profile", icon: User, key: "profile" as const }
      : { to: "/auth", icon: LogIn, key: "signIn" as const },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-glass-border bg-bg-secondary/90 backdrop-blur-xl pb-safe-bottom md:hidden"
      style={{ height: "calc(3.5rem + var(--spacing-safe-bottom, 0px))" }}
    >
      {navItems.map(({ to, icon: Icon, key }) => {
        const label = t(`sidebar.${key}`, { defaultValue: key });
        return (
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
        );
      })}
    </nav>
  );
}
