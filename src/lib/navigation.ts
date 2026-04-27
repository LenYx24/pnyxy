import {
  BookMarked,
  BookOpen,
  Bot,
  BrainCircuit,
  Compass,
  FileQuestion,
  Flame,
  Home,
  Library as LibraryIcon,
  Map as MapIcon,
  MessagesSquare,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for app navigation. The Sidebar and the
 * Cmd+K command palette both read from this. When you add a route
 * that should appear in either surface, add it here.
 *
 * `group` controls placement in the sidebar:
 *   - "primary"  → top-level item, always visible
 *   - "study"    → inside the collapsible "Study" submenu
 *   - "profile"  → bottom area near the avatar (admin only today)
 *   - "hidden"   → not in the sidebar, but still in the palette
 *                  (useful for routes you can navigate to but don't
 *                  want eating sidebar real estate, e.g. /home)
 */
export type NavGroup = "primary" | "study" | "profile" | "hidden";

export interface NavItem {
  to: string;
  icon: LucideIcon;
  /** Translation key under `sidebar.*`. */
  key: string;
  group: NavGroup;
  /** When true, only show this item if the predicate returns true.
   *  Currently used for the Reader item (only meaningful when a
   *  book is open) and the Admin item (admin role only). */
  visibleWhen?: "hasActiveBook" | "isAdmin";
}

export const NAV_ITEMS: NavItem[] = [
  // Hidden from the sidebar (logo handles it) but reachable via the
  // command palette so power users can jump there with Cmd+K.
  { to: "/", icon: Home, key: "home", group: "hidden" },

  // Primary destinations — the everyday surfaces.
  { to: "/library", icon: LibraryIcon, key: "library", group: "primary" },
  { to: "/chat", icon: Bot, key: "chat", group: "primary" },
  { to: "/browse", icon: Compass, key: "browse", group: "primary" },
  { to: "/forum", icon: MessagesSquare, key: "forum", group: "primary" },
  { to: "/streaks", icon: Flame, key: "streaks", group: "primary" },

  // Conditional: only when a book is loaded into the reader.
  {
    to: "/reader",
    icon: BookOpen,
    key: "reader",
    group: "primary",
    visibleWhen: "hasActiveBook",
  },

  // Study submenu — collapsed by default in the sidebar; flat in the
  // command palette.
  { to: "/quizzes", icon: FileQuestion, key: "quizzes", group: "study" },
  { to: "/quizzes/review", icon: BrainCircuit, key: "review", group: "study" },
  { to: "/vocabulary", icon: BookMarked, key: "vocabulary", group: "study" },
  { to: "/roadmaps", icon: MapIcon, key: "roadmaps", group: "study" },

  // Settings is reached via the gear icon next to the profile name.
  // Kept here so it's still searchable in the palette.
  { to: "/settings", icon: Settings, key: "settings", group: "hidden" },

  // Admin-only.
  {
    to: "/admin",
    icon: Shield,
    key: "admin",
    group: "profile",
    visibleWhen: "isAdmin",
  },
];

export function visibleSidebarItems(opts: {
  hasActiveBook: boolean;
  isAdmin: boolean;
}): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.group === "hidden") return false;
    if (item.visibleWhen === "hasActiveBook" && !opts.hasActiveBook) {
      return false;
    }
    if (item.visibleWhen === "isAdmin" && !opts.isAdmin) return false;
    return true;
  });
}
