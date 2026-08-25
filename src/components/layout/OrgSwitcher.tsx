import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOrgStore } from "@/stores/org-store";
import { assignRef } from "@/components/ui/assign-ref";
import { orgMonogram } from "./org-utils";

// Library agent: mount it in the breadcrumb as
//   <OrgSwitcherPopover trigger={<button type="button">{currentOrg.name}</button>} />
// (the trigger gets ref / onClick / aria props injected; read the current
// org via useCurrentOrg() from ./org-utils; OrgMonogramTile is exported
// here for the trigger).

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onClick?: (e: React.MouseEvent) => void;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "listbox";
}

interface OrgSwitcherPopoverProps {
  /** The element that toggles the popover. Must accept a ref and
   *  onClick (a plain button, or a component forwarding them). */
  trigger: ReactElement<TriggerProps>;
  /** Called after a navigation-triggered close ("Manage organizations"). */
  onNavigate?: () => void;
  /** Where the popover opens relative to the trigger. */
  placement?: "bottom-start" | "right-end";
}

/** Small neutral tile with the org's initials, the only marker an org
 *  gets (no colour coding anywhere in the switcher). */
export function OrgMonogramTile({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-surface-3 text-2xs font-semibold text-text-primary",
        className,
      )}
    >
      {orgMonogram(name)}
    </span>
  );
}

/**
 * Workspace switcher popover. Lists every org of the user as a row with
 * a monogram tile ("Personal" first, check mark on the active one) and a
 * quiet "Manage organizations" row at the bottom. Portaled to <body> and
 * anchored to the trigger; opens with a 120 ms fade + 4 px slide.
 *
 * Renders only the trigger while orgs are still loading or when the
 * user has none.
 */
export function OrgSwitcherPopover({
  trigger,
  onNavigate,
  placement = "bottom-start",
}: OrgSwitcherPopoverProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const organizations = useOrgStore((s) => s.organizations);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const switchOrg = useOrgStore((s) => s.switchOrg);

  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // measure, then flip `shown` on the next frame so the enter
  // transition runs from the initial (hidden) state
  useLayoutEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const el = triggerRef.current;
    const pop = popoverRef.current;
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    let left: number;
    let top: number;
    if (placement === "right-end") {
      left = r.right + 8;
      top = r.bottom - p.height;
    } else {
      left = r.left;
      top = r.bottom + 6;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - p.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - p.height - 4));
    setPos({ left, top });
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open, placement]);

  const current =
    organizations.find((o) => o.id === currentOrgId) ?? organizations[0];

  // "Personal" (the auto-created org) always leads the list
  const sorted = [...organizations].sort((a, b) => {
    const ap = /^personal$/i.test(a.name) ? 0 : 1;
    const bp = /^personal$/i.test(b.name) ? 0 : 1;
    return ap - bp;
  });

  const handleManage = () => {
    setOpen(false);
    onNavigate?.();
    navigate("/settings/organizations");
  };

  const triggerProps = trigger.props;
  // the child's own ref is only touched inside the ref callback, not in render
  // eslint-disable-next-line react-hooks/refs
  const triggerEl = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(triggerProps.ref, node);
    },
    onClick: (e: React.MouseEvent) => {
      triggerProps.onClick?.(e);
      if (organizations.length > 0) setOpen((o) => !o);
    },
    "aria-expanded": open,
    // only advertise the popup once the orgs (and the active id) are
    // resolved; consumers use this attribute as the "org ready" signal
    "aria-haspopup": organizations.length > 0 ? "listbox" : undefined,
  });

  if (organizations.length === 0 || !current) return triggerEl;

  return (
    <>
      {triggerEl}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label={t("sidebar.orgSwitcher.title")}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
            className={cn(
              "fixed z-[100] w-60 overflow-hidden rounded-panel bg-bg-tertiary py-1 shadow-page",
              "transition-[opacity,transform] duration-[120ms] ease-out motion-reduce:transition-none motion-reduce:transform-none",
              shown ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
            )}
          >
            <ul className="max-h-64 overflow-y-auto">
              {sorted.map((org) => {
                const isCurrent = org.id === current.id;
                return (
                  <li key={org.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      onClick={() => {
                        switchOrg(org.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors cursor-pointer",
                        isCurrent
                          ? "text-text-primary"
                          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                      )}
                    >
                      <OrgMonogramTile name={org.name} />
                      <span className="min-w-0 flex-1 truncate">
                        {org.name}
                      </span>
                      {isCurrent && (
                        <Check
                          size={14}
                          strokeWidth={2}
                          className="shrink-0 text-text-primary"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-surface-3/60 pt-1">
              <button
                type="button"
                onClick={handleManage}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <SettingsIcon
                  size={14}
                  strokeWidth={1.5}
                  className="shrink-0"
                />
                {t("sidebar.orgSwitcher.manage")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
