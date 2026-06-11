import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  BotMessageSquare,
  Compass,
  Library,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

// Mobile bottom nav: four core surfaces + a "More" entry that opens
// the sidebar drawer for every other destination (workspace, forum,
// streaks, study tools, settings, profile). The bottom rail stays
// focused on the everyday surfaces; everything else lives behind one
// extra tap so the rail doesn't grow into a six-icon scrum that
// outranks the content it sits beneath.
const navItems = [
  { to: "/library", icon: Library, key: "library" as const },
  { to: "/chat", icon: BotMessageSquare, key: "chat" as const },
  { to: "/reader", icon: BookOpen, key: "reader" as const },
  { to: "/browse", icon: Compass, key: "browse" as const },
];

export function BottomNav() {
  const { t } = useTranslation();
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

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
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium transition-colors touch-target",
                isActive ? "text-accent" : "text-text-muted",
              )
            }
          >
            <Icon size={18} />
            <span className="truncate">{label}</span>
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(true)}
        className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium text-text-muted transition-colors touch-target hover:text-text-primary cursor-pointer"
        aria-label={t("sidebar.more", { defaultValue: "More" })}
      >
        <Menu size={18} />
        <span className="truncate">
          {t("sidebar.more", { defaultValue: "More" })}
        </span>
      </button>
    </nav>
  );
}
