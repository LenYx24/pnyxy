import { NavLink } from "react-router";
import { useState } from "react";
import {
  Settings as SettingsIcon,
  Palette,
  BotMessageSquare,
  Tag,
  Puzzle,
  Keyboard,
  Info,
  ChevronDown,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";

export interface TabDef {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

// Shared constant lives next to the only component that uses it; HMR
// for this nav file is fine, the rule's warning isn't actionable here.
// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_TABS: TabDef[] = [
  { to: "general", label: "General", icon: SettingsIcon },
  { to: "appearance", label: "Appearance", icon: Palette },
  { to: "ai", label: "AI", icon: BotMessageSquare },
  { to: "tags", label: "Tags", icon: Tag },
  { to: "plugins", label: "Plugins", icon: Puzzle },
  { to: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { to: "about", label: "About", icon: Info },
];

export function TabNav({ currentLabel }: { currentLabel: string }) {
  const isMobile = useIsMobile();
  if (isMobile) return <TabDropdown currentLabel={currentLabel} />;
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
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function TabDropdown({ currentLabel }: { currentLabel: string }) {
  const [open, setOpen] = useState(false);
  const current = SETTINGS_TABS.find((t) => t.label === currentLabel) ?? SETTINGS_TABS[0];
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
          {currentLabel}
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
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
