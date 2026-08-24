import { useTranslation } from "react-i18next";
import {
  BookmarkPlus,
  BotMessageSquare,
  List,
  MessageSquare,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useFeatures } from "@/lib/use-features";

interface MobileReaderBottomBarProps {
  /** Slide off-screen when chrome is hidden (matches the top toolbar). */
  visible: boolean;
  activePanel: "none" | "toc" | "comments" | "aiChat";
  onOpenContents: () => void;
  onToggleSearch: () => void;
  onBookmark: () => void;
  onToggleComments: () => void;
  onToggleAiChat: () => void;
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
}: MobileReaderBottomBarProps) {
  const { t } = useTranslation();
  const features = useFeatures();

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
    ...(features.bookmarks
      ? [
          {
            key: "bookmark" as const,
            icon: BookmarkPlus,
            label: t("reader.bottomBar.bookmark"),
            onClick: onBookmark,
            active: false,
          },
        ]
      : []),
    ...(features.comments
      ? [
          {
            key: "comments" as const,
            icon: MessageSquare,
            label: t("reader.bottomBar.comments"),
            onClick: onToggleComments,
            active: activePanel === "comments",
          },
        ]
      : []),
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
      // Reader container is now full-viewport on every breakpoint
      // (the global BottomNav is hidden on this route), so this bar
      // owns the bottom edge of the screen and has to handle the
      // device's safe-area inset itself.
      className={cn(
        "absolute left-0 right-0 bottom-0 z-20 transition-transform duration-200 ease-out",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="border-t border-glass-border bg-bg-secondary/85 backdrop-blur-md pl-safe-left pr-safe-right pb-safe-bottom">
        <nav className="flex items-stretch justify-around">
          {items.map(({ key, icon: Icon, label, onClick, active }) => (
            <button
              key={key}
              onClick={onClick}
              aria-label={label}
              title={label}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium transition-colors touch-target",
                active
                  ? "text-accent"
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
