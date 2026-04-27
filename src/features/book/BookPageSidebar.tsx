import { NavLink, useLocation } from "react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Info,
  GraduationCap,
  MessageSquare,
  StickyNote,
  Link as LinkIcon,
  ChevronDown,
  Bookmark as BookmarkIcon,
  Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { LEARN_METHODS } from "./LEARN_METHODS";

interface NavItem {
  to: string;
  /** i18n key under `book.nav`. */
  labelKey:
    | "overview"
    | "learn"
    | "discuss"
    | "notes"
    | "bookmarks"
    | "whiteboards"
    | "resources";
  icon: LucideIcon;
  end?: boolean;
}

function useNavItems(bookId: string): NavItem[] {
  return useMemo<NavItem[]>(
    () => [
      { to: `/books/${bookId}`, labelKey: "overview", icon: Info, end: true },
      { to: `/books/${bookId}/learn`, labelKey: "learn", icon: GraduationCap },
      { to: `/books/${bookId}/discuss`, labelKey: "discuss", icon: MessageSquare },
      { to: `/books/${bookId}/notes`, labelKey: "notes", icon: StickyNote },
      {
        to: `/books/${bookId}/bookmarks`,
        labelKey: "bookmarks",
        icon: BookmarkIcon,
      },
      {
        to: `/books/${bookId}/whiteboards`,
        labelKey: "whiteboards",
        icon: Pencil,
      },
      { to: `/books/${bookId}/resources`, labelKey: "resources", icon: LinkIcon },
    ],
    [bookId],
  );
}

function resolveActive(items: NavItem[], pathname: string): NavItem {
  return (
    items.find((i) =>
      i.end ? pathname === i.to : pathname.startsWith(i.to),
    ) ?? items[0]
  );
}

export function BookPageSidebar({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const items = useNavItems(bookId);
  const { pathname } = useLocation();

  if (isMobile) {
    return <MobileNav items={items} pathname={pathname} />;
  }

  const learnExpanded = pathname.startsWith(`/books/${bookId}/learn`);

  return (
    <nav className="sticky top-4 flex flex-col gap-0.5 self-start">
      {items.map((item) => (
        <div key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-glass-bg text-text-primary"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )
            }
          >
            <item.icon size={16} />
            <span>{t(`book.nav.${item.labelKey}`)}</span>
          </NavLink>
          {item.labelKey === "learn" && learnExpanded && (
            <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-glass-border pl-2">
              {LEARN_METHODS.map((m) => (
                <NavLink
                  key={m.slug}
                  to={`/books/${bookId}/learn/${m.slug}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-glass-bg text-text-primary"
                        : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
                    )
                  }
                >
                  <m.icon size={12} />
                  <span>{m.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function MobileNav({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = resolveActive(items, pathname);
  const Icon = active.icon;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-bg/50 px-3 py-2.5 text-sm font-medium text-text-primary"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} />
          {t(`book.nav.${active.labelKey}`)}
        </span>
        <ChevronDown
          size={16}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-glass-border bg-bg-secondary shadow-xl">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-glass-bg text-text-primary"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )
              }
            >
              <item.icon size={16} />
              <span>{t(`book.nav.${item.labelKey}`)}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
