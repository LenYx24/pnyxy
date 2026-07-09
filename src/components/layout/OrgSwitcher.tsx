import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOrgStore } from "@/stores/org-store";
import { planColorClasses } from "@/lib/plan-colors";

interface OrgSwitcherProps {
  /** When true, the switcher renders as a single icon-sized chip
   *  with no label or chevron, matches the collapsed sidebar's
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
 * has none, the auth lifecycle ensures every signed-in user has
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // viewport-fixed coords for the collapsed fly-out (see measure effect below)
  const [fixedPos, setFixedPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  // Close on outside click. Touch + pointer both fire `mousedown`
  // (synthesised on iOS), so a single listener covers both. The collapsed
  // popover is portaled to <body>, so check it explicitly too.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Collapsed: the sidebar clips its overflow and its backdrop-filter makes it
  // a containing block, so an in-flow fly-out gets clipped. Portal it to <body>
  // with fixed coords measured from the trigger instead.
  useEffect(() => {
    if (!open || !collapsed) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setFixedPos({ left: r.right + 8, bottom: window.innerHeight - r.bottom });
  }, [open, collapsed]);

  if (organizations.length === 0) return null;

  const current =
    organizations.find((o) => o.id === currentOrgId) ?? organizations[0];
  const currentColor = planColorClasses(current.color);

  const handleManage = () => {
    setOpen(false);
    onNavigate?.();
    navigate("/settings/organizations");
  };

  // shared popover body, rendered in both the expanded and collapsed variants
  const listContent = (
    <>
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
    </>
  );

  return (
    <div ref={containerRef} className="relative border-t border-glass-border">
      <button
        ref={triggerRef}
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

      {/* expanded: in-flow popover anchored above the trigger, inside the sidebar */}
      {open && !collapsed && (
        <div
          ref={popoverRef}
          role="listbox"
          aria-label={t("sidebar.orgSwitcher.title")}
          className="absolute bottom-full left-2 right-2 z-50 mb-1 overflow-hidden rounded-lg border border-glass-border bg-bg-secondary/95 shadow-xl backdrop-blur-xl"
        >
          {listContent}
        </div>
      )}
      {/* collapsed: portaled fly-out so the clipped, backdrop-filtered sidebar
          can't hide it */}
      {open &&
        collapsed &&
        fixedPos &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label={t("sidebar.orgSwitcher.title")}
            style={{
              position: "fixed",
              left: fixedPos.left,
              bottom: fixedPos.bottom,
            }}
            className="z-[60] w-56 overflow-hidden rounded-lg border border-glass-border bg-bg-secondary/95 shadow-xl backdrop-blur-xl"
          >
            {listContent}
          </div>,
          document.body,
        )}
    </div>
  );
}
