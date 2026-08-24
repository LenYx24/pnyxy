import {
  BookMarked,
  BookOpen,
  Bot,
  Boxes,
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
import type { FeatureKey, FeatureSet } from "@/lib/features";

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
  /** When true, the item is hidden from the sidebar for signed-out
   *  users (its destination is a personal / account-bound surface that
   *  a logged-out visitor can't meaningfully use). */
  requiresAuth?: boolean;
  /** Feature flag that must be enabled for the item to show (see lib/features). */
  feature?: FeatureKey;
}

export const NAV_ITEMS: NavItem[] = [
  // Hidden from the sidebar (logo handles it) but reachable via the
  // command palette so power users can jump there with Cmd+K.
  { to: "/", icon: Home, key: "home", group: "hidden" },

  // Primary destinations, the everyday surfaces.
  { to: "/library", icon: LibraryIcon, key: "library", group: "primary" },
  { to: "/chat", icon: Bot, key: "chat", group: "primary" },
  { to: "/browse", icon: Compass, key: "browse", group: "primary" },
  { to: "/forum", icon: MessagesSquare, key: "forum", group: "primary", feature: "forum" },
  {
    to: "/spaces",
    icon: Boxes,
    key: "spaces",
    group: "primary",
    requiresAuth: true,
    feature: "spaces",
  },
  {
    to: "/streaks",
    icon: Flame,
    key: "streaks",
    group: "primary",
    requiresAuth: true,
  },

  // Conditional: only when a book is loaded into the reader.
  {
    to: "/reader",
    icon: BookOpen,
    key: "reader",
    group: "primary",
    visibleWhen: "hasActiveBook",
  },

  // Study submenu, collapsed by default in the sidebar; flat in the
  // command palette. All personal learning surfaces → signed-in only.
  {
    to: "/quizzes",
    icon: FileQuestion,
    key: "quizzes",
    group: "study",
    requiresAuth: true,
    feature: "quizzes",
  },
  {
    to: "/quizzes/review",
    icon: BrainCircuit,
    key: "review",
    group: "study",
    requiresAuth: true,
    feature: "quizzes",
  },
  {
    to: "/vocabulary",
    icon: BookMarked,
    key: "vocabulary",
    group: "study",
    requiresAuth: true,
    feature: "vocabulary",
  },
  {
    to: "/roadmaps",
    icon: MapIcon,
    key: "roadmaps",
    group: "study",
    requiresAuth: true,
    feature: "roadmaps",
  },

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
  /** Whether a user is signed in; gates `requiresAuth` items. */
  isAuthed: boolean;
  /** Resolved feature set; items with a `feature` need it enabled. */
  features: FeatureSet;
}): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.group === "hidden") return false;
    if (item.feature && !opts.features[item.feature]) return false;
    if (item.requiresAuth && !opts.isAuthed) return false;
    if (item.visibleWhen === "hasActiveBook" && !opts.hasActiveBook) {
      return false;
    }
    if (item.visibleWhen === "isAdmin" && !opts.isAdmin) return false;
    return true;
  });
}
