import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ModelInfo } from "@/lib/ai/ai-models";
import { PNYXY_MODEL_OPTIONS, usageRatio, type PnyxyQuotaRow } from "./quota";
import { cn } from "@/lib/cn";

interface ModelInfoModalProps {
  open: boolean;
  onClose: () => void;
  /** Today's per-model usage; without it the bars are omitted (anon/BYOK). */
  rows?: ReadonlyArray<PnyxyQuotaRow>;
}

/**
 * Compact per-model overview behind the picker's "About the models"
 * row: name, one-line tagline, and today's quota as a slim bar +
 * questions-left count. The old long-form catalog cards live on in
 * Settings → AI (ModelCard below).
 */
export function ModelInfoModal({
  open,
  onClose,
  rows = [],
}: ModelInfoModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-page bg-bg-tertiary p-6 shadow-page">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("chat.modelHelp.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("common.close")}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="menu-scroll -mx-2 flex-1 overflow-y-auto px-2">
          <div className="flex flex-col gap-4">
            {PNYXY_MODEL_OPTIONS.map((m) => (
              <ModelQuotaRow
                key={m.id}
                label={m.label}
                tagline={m.tagline}
                row={rows.find((r) => r.model === m.id) ?? null}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModelQuotaRow({
  label,
  tagline,
  row,
}: {
  label: string;
  tagline: string;
  row: PnyxyQuotaRow | null;
}) {
  const { t } = useTranslation();
  const ratio = row ? Math.min(usageRatio(row), 1) : null;
  const barColor =
    ratio === null
      ? ""
      : ratio > 0.8
        ? "bg-danger"
        : ratio > 0.5
          ? "bg-warning"
          : "bg-accent";
  const questionsLeft = row
    ? Math.max(row.request_limit - row.request_count, 0)
    : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-text-primary">
          {label}
        </span>
        {questionsLeft !== null && (
          <span
            className={cn(
              "shrink-0 text-2xs tabular-nums",
              questionsLeft === 0 ? "text-danger" : "text-text-muted",
            )}
          >
            {t("chat.composer.quota.remaining", { count: questionsLeft })}
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-2xs text-text-muted">{tagline}</p>
      {ratio !== null && row && (
        <div
          className="mt-2"
          title={`${row.tokens_used.toLocaleString()} / ${row.tokens_limit.toLocaleString()} token`}
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn("h-full rounded-full transition-[width]", barColor)}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single-model card used in the Settings → AI tab's long-form catalog.
 * (The chat modal above no longer uses it; Settings still does.)
 */
export function ModelCard({ model }: { model: ModelInfo }) {
  const { t } = useTranslation();

  return (
    <article className="rounded-panel bg-bg-tertiary p-3 sm:p-4">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {model.displayName}
          </h3>
          <p className="font-mono text-2xs text-text-muted truncate">
            {model.modelId}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-bg-secondary px-2 py-0.5 text-2xs font-medium text-text-muted">
          {model.routingNote}
        </span>
      </header>

      <p className="mb-3 text-xs text-text-secondary leading-relaxed">
        {model.description}
      </p>

      <div className="grid grid-cols-1 gap-2 text-2xs sm:grid-cols-3">
        <span className="rounded-control bg-bg-secondary px-2 py-1.5 text-text-secondary">
          {t("chat.modelHelp.speed")}:{" "}
          {{ fast: "Gyors", medium: "Közepes", slow: "Lassú" }[model.speed]}
        </span>
        <span className="rounded-control bg-bg-secondary px-2 py-1.5 text-text-secondary">
          {t("chat.modelHelp.power")}:{" "}
          {
            { basic: "Alap", balanced: "Kiegyensúlyozott", powerful: "Erős" }[
              model.power
            ]
          }
        </span>
        <span className="rounded-control bg-bg-secondary px-2 py-1.5 text-text-secondary">
          {t("chat.modelHelp.context")}: {model.contextWindow}
        </span>
      </div>
    </article>
  );
}
