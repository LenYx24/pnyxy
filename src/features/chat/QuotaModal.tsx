import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import {
  chipClass,
  modalBackdropClass,
  modalSurfaceClass,
} from "@/components/ui/classes";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";
import {
  PNYXY_MODEL_OPTIONS,
  nextUtcMidnight,
  questionsLeft,
  usageRatio,
  type PnyxyQuotaRow,
} from "./quota";

type Tier = "free" | "premium";

interface QuotaModalProps {
  open: boolean;
  onClose: () => void;
  /** Today's rows from `get_my_ai_usage_today` (shared with the footer). */
  rows: ReadonlyArray<PnyxyQuotaRow>;
  /** Model id the next turn bills (predicted or pinned). */
  activeModel: string;
  /** Explicit pin from the model picker, null on the auto route. */
  pinnedModel: string | null;
  /** True when the predicted bucket ran dry and the auto-route moved on. */
  fellThrough: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Daily quota sheet opened from the composer's "N questions left today"
 * line. One row per Pnyxy model with a neutral usage track (accent only
 * on the model the next turn bills), the raw tokens / requests numbers,
 * the reset time and the plan tier. Replaces the old jump to
 * /settings/ai, which is still linked at the bottom for the long form.
 */
export function QuotaModal({
  open,
  onClose,
  rows,
  activeModel,
  pinnedModel,
  fellThrough,
}: QuotaModalProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // plan tier, one small read per open (the RPC rows carry the limits
  // but not the tier name)
  const [tier, setTier] = useState<Tier | null>(null);
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("storage_tier")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setTier(data?.storage_tier === "premium" ? "premium" : "free");
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  // Esc closes, Tab cycles inside the sheet, focus returns to the opener.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !dialogRef.current.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const reset = nextUtcMidnight();
  const resetLocal = reset.toLocaleTimeString(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const numberFmt = new Intl.NumberFormat(i18n.language);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn("absolute inset-0", modalBackdropClass)}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-modal-title"
        className={cn(
          modalSurfaceClass,
          "relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h2
              id="quota-modal-title"
              className="font-display text-lg font-semibold text-text-primary"
            >
              {t("chat.quotaModal.title")}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              {t("chat.quotaModal.resetsAt", { time: resetLocal })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tier && (
              <span
                className={cn(
                  chipClass,
                  "px-2 py-0.5 text-2xs",
                  tier === "premium" && "text-accent",
                )}
              >
                {tier === "premium"
                  ? t("chat.quotaModal.tierPremium")
                  : t("chat.quotaModal.tierFree")}
              </span>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="rounded-control p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              aria-label={t("common.close")}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <ul className="flex flex-col gap-3 overflow-y-auto px-6 py-5">
          {PNYXY_MODEL_OPTIONS.map((m) => {
            const row = rows.find((r) => r.model === m.id) ?? null;
            const active = m.id === activeModel;
            const ratio = usageRatio(row);
            const left = questionsLeft(row);
            return (
              <li key={m.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        active ? "text-text-primary" : "text-text-secondary",
                      )}
                    >
                      {m.label}
                    </span>
                    <span className="truncate text-2xs text-text-muted-2">
                      {m.tagline}
                    </span>
                  </div>
                  {active && (
                    <span className="shrink-0 text-2xs text-accent">
                      {pinnedModel
                        ? t("chat.quotaModal.pinned")
                        : fellThrough
                          ? t("chat.quotaModal.fallback")
                          : t("chat.quotaModal.next")}
                    </span>
                  )}
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-chip bg-surface-3"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                  aria-label={m.label}
                >
                  <div
                    className={cn(
                      "h-full rounded-chip transition-[width]",
                      active ? "bg-accent" : "bg-text-muted-2",
                    )}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 font-mono text-2xs text-text-muted">
                  {row ? (
                    <>
                      <span>
                        {t("chat.quotaModal.tokens", {
                          used: numberFmt.format(row.tokens_used),
                          limit: numberFmt.format(row.tokens_limit),
                        })}
                      </span>
                      <span>
                        {t("chat.quotaModal.requests", {
                          used: numberFmt.format(row.request_count),
                          limit: numberFmt.format(row.request_limit),
                        })}
                      </span>
                      <span className={cn(left === 0 && "text-danger")}>
                        {t("chat.composer.quota.remaining", { count: left })}
                      </span>
                    </>
                  ) : (
                    <span>{t("chat.quotaModal.noData")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate("/settings/ai");
            }}
            className="rounded-control px-1 py-0.5 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {t("chat.quotaModal.details")}
          </button>
          {tier === "free" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onClose();
                navigate("/profile");
              }}
            >
              {t("chat.quotaModal.upgrade")}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
