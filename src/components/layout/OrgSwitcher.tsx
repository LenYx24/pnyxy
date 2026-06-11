import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOrgStore } from "@/stores/org-store";
import { planColorClasses } from "@/lib/plan-colors";

interface OrgSwitcherProps {
  /** When true, the switcher renders as a single icon-sized chip
   *  with no label or chevron — matches the collapsed sidebar's
   *  visual rhythm. */
  collapsed?: boolean;
  /** Called whenever the dropdown closes via a navigation. The
   *  tablet sidebar uses this to hide the overlay after the user
   *  taps "Manage organizations". */
  onNavigate?: () => void;
}

/**
 * Workspace-style switcher pinned above the profile row in the
 * sidebar. Opens a small popover listing all of the user's orgs
 * plus a link to the management tab in Settings.
 *
 * Renders nothing while orgs are still loading or when the user
 * has none — the auth lifecycle ensures every signed-in user has
 * at least one (their auto-created "Personal" org).
 */
export function OrgSwitcher({ collapsed, onNavigate }: OrgSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const organizations = useOrgStore((s) => s.organizations);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const switchOrg = useOrgStore((s) => s.switchOrg);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Touch + pointer both fire `mousedown`
  // (synthesised on iOS), so a single listener covers both.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  if (organizations.length === 0) return null;

  const current =
    organizations.find((o) => o.id === currentOrgId) ?? organizations[0];
  const currentColor = planColorClasses(current.color);

  const handleManage = () => {
    setOpen(false);
    onNavigate?.();
    navigate("/settings/organizations");
  };

  return (
    <div ref={containerRef} className="relative border-t border-glass-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("sidebar.orgSwitcher.title")}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
          collapsed && "justify-center px-0",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 shrink-0 rounded-full",
            currentColor.swatch,
          )}
          aria-hidden="true"
        />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">
              {current.name}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-text-muted transition-transform",
                open && "rotate-180",
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("sidebar.orgSwitcher.title")}
          className={cn(
            "absolute z-50 overflow-hidden rounded-lg border border-glass-border bg-bg-secondary/95 shadow-xl backdrop-blur-xl",
            // Anchor: when collapsed the trigger is narrow, so float
            // the popover to the right of the sidebar; when expanded,
            // align it inside the sidebar above the trigger.
            collapsed
              ? "bottom-1 left-full ml-2 w-56"
              : "bottom-full left-2 right-2 mb-1",
          )}
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {organizations.map((org) => {
              const cc = planColorClasses(org.color);
              const isCurrent = org.id === current.id;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => {
                      switchOrg(org.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                      isCurrent
                        ? "bg-glass-bg text-text-primary"
                        : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-3 w-3 shrink-0 rounded-full",
                        cc.swatch,
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {isCurrent && (
                      <Check size={14} className="shrink-0 text-accent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-glass-border">
            <button
              type="button"
              onClick={handleManage}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <SettingsIcon size={12} />
              {t("sidebar.orgSwitcher.manage")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
