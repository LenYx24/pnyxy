import { NavLink } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Settings as SettingsIcon,
  Palette,
  BotMessageSquare,
  Tag,
  Puzzle,
  Keyboard,
  Info,
  MessageSquarePlus,
  ChevronDown,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";

export interface TabDef {
  to: string;
  /** i18n key under the `settings` namespace. */
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_TABS: TabDef[] = [
  { to: "general", labelKey: "general", icon: SettingsIcon },
  { to: "appearance", labelKey: "appearance", icon: Palette },
  { to: "ai", labelKey: "ai", icon: BotMessageSquare },
  { to: "tags", labelKey: "tags", icon: Tag },
  { to: "plugins", labelKey: "plugins", icon: Puzzle },
  { to: "shortcuts", labelKey: "shortcuts", icon: Keyboard },
  { to: "feedback", labelKey: "feedback", icon: MessageSquarePlus },
  { to: "about", labelKey: "about", icon: Info },
];

export function TabNav({ currentTo }: { currentTo: string }) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  if (isMobile) return <TabDropdown currentTo={currentTo} />;
  return (
    <nav className="sticky top-0 flex flex-col gap-0.5 self-start">
      {SETTINGS_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-glass-bg text-text-primary"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )
          }
        >
          <tab.icon size={16} />
          <span>{t(`settings.${tab.labelKey}`)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function TabDropdown({ currentTo }: { currentTo: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const current =
    SETTINGS_TABS.find((tab) => tab.to === currentTo) ?? SETTINGS_TABS[0];
  const Icon = current.icon;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-bg/50 px-3 py-2.5 text-sm font-medium text-text-primary"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} />
          {t(`settings.${current.labelKey}`)}
        </span>
        <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-glass-border bg-bg-secondary shadow-xl">
          {SETTINGS_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
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
              <tab.icon size={16} />
              <span>{t(`settings.${tab.labelKey}`)}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
