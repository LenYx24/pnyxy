import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  BotMessageSquare,
  Compass,
  Library,
} from "lucide-react";
import { cn } from "@/lib/cn";

// Mobile bottom nav: the four core surfaces a user moves between
// during normal use. Auth / profile / settings live in the mobile
// top bar (avatar menu) so the bottom rail stays focused on
// "where am I going next?" instead of identity / config.
const navItems = [
  { to: "/library", icon: Library, key: "library" as const },
  { to: "/chat", icon: BotMessageSquare, key: "chat" as const },
  { to: "/reader", icon: BookOpen, key: "reader" as const },
  { to: "/browse", icon: Compass, key: "browse" as const },
];

export function BottomNav() {
  const { t } = useTranslation();

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
