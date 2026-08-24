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
  Building2,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { useFeatures } from "@/lib/use-features";
import type { FeatureKey } from "@/lib/features";

/** Logical grouping so related settings sit together instead of one
 *  long undifferentiated list. Order of the groups here is the order
 *  they render in. */
export type SettingsGroup = "account" | "workspace" | "help";

export interface TabDef {
  to: string;
  /** i18n key under the `settings` namespace. */
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: SettingsGroup;
  feature?: FeatureKey;
}

// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_TABS: TabDef[] = [
  // Account & membership
  { to: "general", labelKey: "general", icon: SettingsIcon, group: "account" },
  {
    to: "organizations",
    labelKey: "organizations",
    icon: Building2,
    group: "account",
  },
  // Workspace customisation
  { to: "appearance", labelKey: "appearance", icon: Palette, group: "workspace" },
  { to: "ai", labelKey: "ai", icon: BotMessageSquare, group: "workspace" },
  { to: "tags", labelKey: "tags", icon: Tag, group: "workspace" },
  { to: "plugins", labelKey: "plugins", icon: Puzzle, group: "workspace", feature: "plugins" },
  // Help & meta
  { to: "shortcuts", labelKey: "shortcuts", icon: Keyboard, group: "help" },
  {
    to: "feedback",
    labelKey: "feedback",
    icon: MessageSquarePlus,
    group: "help",
  },
  { to: "about", labelKey: "about", icon: Info, group: "help" },
];

// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = [
  "account",
  "workspace",
  "help",
];

// eslint-disable-next-line react-refresh/only-export-components
export function useVisibleSettingsTabs(): TabDef[] {
  const features = useFeatures();
  return SETTINGS_TABS.filter((tab) => !tab.feature || features[tab.feature]);
}

export function TabNav({ currentTo }: { currentTo: string }) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const tabs = useVisibleSettingsTabs();
  if (isMobile) return <TabDropdown currentTo={currentTo} />;
  return (
    <nav className="sticky top-0 flex flex-col gap-0.5 self-start">
      {SETTINGS_GROUP_ORDER.map((group) => (
        <div key={group} className="mb-1 flex flex-col gap-0.5">
          <span className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-text-muted first:pt-0">
            {t(`settings.groups.${group}`, {
              defaultValue: GROUP_FALLBACK[group],
            })}
          </span>
          {tabs.filter((tab) => tab.group === group).map((tab) => (
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
        </div>
      ))}
    </nav>
  );
}

const GROUP_FALLBACK: Record<SettingsGroup, string> = {
  account: "Account",
  workspace: "Workspace",
  help: "Help",
};

function TabDropdown({ currentTo }: { currentTo: string }) {
  const tabs = useVisibleSettingsTabs();
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
          {tabs.map((tab) => (
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
