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
    <nav className="sticky top-4 flex flex-col gap-1 self-start">
      <span className="mb-1 px-3 text-[13px] font-semibold text-text-muted">
        {t("settings.title")}
      </span>
      {SETTINGS_GROUP_ORDER.map((group) => (
        <div key={group} className="mb-2 flex flex-col gap-0.5">
          <span className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2">
            {t(`settings.groups.${group}`)}
          </span>
          {tabs.filter((tab) => tab.group === group).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
                )
              }
            >
              <tab.icon size={18} className="shrink-0" />
              <span>{t(`settings.${tab.labelKey}`)}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

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
        className="field flex w-full cursor-pointer items-center justify-between gap-2 py-2.5 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} />
          {t(`settings.${current.labelKey}`)}
        </span>
        <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-panel bg-bg-tertiary p-1 shadow-page">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-control px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:bg-surface-3/60 hover:text-text-primary",
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
