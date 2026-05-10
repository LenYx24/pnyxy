import { useTranslation } from "react-i18next";
import {
  BookmarkPlus,
  BotMessageSquare,
  Hash,
  List,
  MessageSquare,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface MobileReaderBottomBarProps {
  /** Slide off-screen when chrome is hidden (matches the top toolbar). */
  visible: boolean;
  activePanel: "none" | "toc" | "comments" | "aiChat";
  onOpenContents: () => void;
  onToggleSearch: () => void;
  onBookmark: () => void;
  onToggleComments: () => void;
  onToggleAiChat: () => void;
  /** Page-jump affordance — when set, the bar gets a sixth item that
   *  shows "current / total" and opens the parent's page-jump prompt
   *  on tap. Mobile users otherwise have to tap to reveal the top
   *  toolbar to access the page input there. */
  pageCurrent?: number;
  pageTotal?: number;
  onJumpToPage?: () => void;
}

/**
 * Permanent bottom action bar shown on mobile in the reader. Surfaces
 * the 5 highest-leverage actions so users don't have to dig into the
 * 3-dot overflow menu for the things they reach for the most.
 */
export function MobileReaderBottomBar({
  visible,
  activePanel,
  onOpenContents,
  onToggleSearch,
  onBookmark,
  onToggleComments,
  onToggleAiChat,
  pageCurrent,
  pageTotal,
  onJumpToPage,
}: MobileReaderBottomBarProps) {
  const { t } = useTranslation();

  const items = [
    {
      key: "contents" as const,
      icon: List,
      label: t("reader.bottomBar.contents"),
      onClick: onOpenContents,
      active: activePanel === "toc",
    },
    {
      key: "search" as const,
      icon: Search,
      label: t("reader.bottomBar.search"),
      onClick: onToggleSearch,
      active: false,
    },
    ...(onJumpToPage && pageCurrent && pageTotal
      ? [
          {
            key: "page" as const,
            icon: Hash,
            // Label doubles as the page indicator — keeps the row at
            // 6 items without duplicating "page" + "X / Y" in two
            // separate slots. Truncates cleanly on narrow phones.
            label: `${pageCurrent} / ${pageTotal}`,
            onClick: onJumpToPage,
            active: false,
          },
        ]
      : []),
    {
      key: "bookmark" as const,
      icon: BookmarkPlus,
      label: t("reader.bottomBar.bookmark"),
      onClick: onBookmark,
      active: false,
    },
    {
      key: "comments" as const,
      icon: MessageSquare,
      label: t("reader.bottomBar.comments"),
      onClick: onToggleComments,
      active: activePanel === "comments",
    },
    {
      key: "ai" as const,
      icon: BotMessageSquare,
      label: t("reader.bottomBar.ai"),
      onClick: onToggleAiChat,
      active: activePanel === "aiChat",
    },
  ];

  return (
    <div
      // The reader container is shrunk on mobile to leave room for the
      // global BottomNav, so this bar can sit at `bottom-0` of the
      // reader and naturally end up just above the global nav.
      className={cn(
        "absolute left-0 right-0 bottom-0 z-20 transition-transform duration-200 ease-out",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="border-t border-glass-border bg-bg-secondary/85 backdrop-blur-md pl-safe-left pr-safe-right">
        <nav className="flex items-stretch justify-around">
          {items.map(({ key, icon: Icon, label, onClick, active }) => (
            <button
              key={key}
              onClick={onClick}
              aria-label={label}
              title={label}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors touch-target",
                active
                  ? "text-accent-purple"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              <Icon size={20} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
