/** Model picker: trigger chip in the composer + the model dropdown and
 *  the per-model quota plumbing shared with the footer/quota modal. */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, HelpCircle } from "lucide-react";
import { FloatingMenu } from "@/components/ui";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { ModelInfoModal } from "../ModelInfoModal";
import { modelDisplayLabel, PROVIDER_INFO } from "./model-meta";
import { PNYXY_MODEL_OPTIONS, usageRatio, type PnyxyQuotaRow } from "../quota";
import { cn } from "@/lib/cn";

export function ModelPicker({
  value,
  options,
  onChange,
  autoModel,
  quotaRows = [],
}: {
  /** null = Default (full fallback chain). A provider = strict pick, no fallback. */
  value: AiProvider | null;
  options: AiProvider[];
  onChange: (next: AiProvider | null) => void;
  /** Model id the auto-route bills when nothing is pinned (footer label). */
  autoModel: string;
  /** Today's per-model usage (shared with the footer so it never goes stale). */
  quotaRows?: ReadonlyArray<PnyxyQuotaRow>;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // persisted in settings store
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const setPnyxyModel = useSettingsStore((s) => s.setPnyxyModel);
  const pnyxyConfigured = useSettingsStore((s) =>
    s.enabledProviders.includes("pnyxy"),
  );

  // Most-constrained model (higher of the tokens/requests ratios) headlines the Default subtitle.
  const quotaHeadline =
    quotaRows.length === 0
      ? null
      : quotaRows
          .map((r) => ({ row: r, ratio: usageRatio(r) }))
          .reduce((a, b) => (a.ratio > b.ratio ? a : b));

  const triggerLabel = modelDisplayLabel(value, pnyxyModel, autoModel);
  const pickerTitle = t("chat.composer.modelLabel");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1 rounded-chip px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
        title={pickerTitle}
        aria-label={`${pickerTitle}: ${triggerLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="max-w-[11rem] truncate">{triggerLabel}</span>
        <ChevronDown size={12} strokeWidth={1.5} className="shrink-0" />
      </button>
      <ModelInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        rows={quotaRows}
      />
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="w-64"
      >
        <ModelOption
          active={value === null && pnyxyModel === null}
          label={t("chat.composer.modelDefault")}
          subtitle={t("chat.composer.modelDefaultSubtitle")}
          quotaHeadline={quotaHeadline}
          onClick={() => {
            setPnyxyModel(null);
            onChange(null);
            setOpen(false);
          }}
        />
        {pnyxyConfigured && (
          <>
            <div className="my-0.5 h-px bg-surface-3" />
            <div className={cn("px-3 pb-0.5 pt-1.5", pickerCaptionClass)}>
              Pnyxy
            </div>
            {PNYXY_MODEL_OPTIONS.map((m) => {
              const row = quotaRows.find((q) => q.model === m.id);
              const headline = row ? { row, ratio: usageRatio(row) } : null;
              return (
                <ModelOption
                  key={m.id}
                  active={value === null && pnyxyModel === m.id}
                  label={m.label}
                  subtitle={m.tagline}
                  quotaHeadline={headline}
                  onClick={() => {
                    setPnyxyModel(m.id);
                    onChange(null);
                    setOpen(false);
                  }}
                />
              );
            })}
          </>
        )}
        {options.length > 0 && (
          <>
            <div className="my-0.5 h-px bg-surface-3" />
            <div className={cn("px-3 pb-0.5 pt-1.5", pickerCaptionClass)}>
              {t("chat.composer.pickerDirect")}
            </div>
          </>
        )}
        {options.map((p) => (
          <ModelOption
            key={p}
            active={value === p}
            label={PROVIDER_INFO[p].model}
            subtitle={PROVIDER_INFO[p].routing}
            onClick={() => {
              onChange(p);
              setOpen(false);
            }}
          />
        ))}
        <div className="my-0.5 h-px bg-surface-3" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setInfoOpen(true);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <HelpCircle size={14} strokeWidth={1.5} />
          {t("chat.composer.modelHelp")}
        </button>
      </FloatingMenu>
    </>
  );
}

/** Section caption inside the picker (11 px, muted-2, like sidebar captions). */
const pickerCaptionClass =
  "text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2";

function ModelOption({
  active,
  label,
  subtitle,
  quotaHeadline,
  onClick,
}: {
  active: boolean;
  label: string;
  subtitle: string;
  /** Today's usage for this model. Numbers live in the QuotaModal; here
   *  it only drives a warning dot (amber >50%, red >80%) + hover title. */
  quotaHeadline?: {
    row: PnyxyQuotaRow;
    ratio: number;
  } | null;
  onClick: () => void;
}) {
  const quotaTitle = quotaHeadline
    ? `${quotaHeadline.row.tokens_used.toLocaleString()}/${quotaHeadline.row.tokens_limit.toLocaleString()} tok · ${quotaHeadline.row.request_count}/${quotaHeadline.row.request_limit} req`
    : undefined;
  const warnDot =
    quotaHeadline && quotaHeadline.ratio > 0.5
      ? quotaHeadline.ratio > 0.8
        ? "bg-danger"
        : "bg-warning"
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={quotaTitle}
      className={cn(
        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-glass-hover cursor-pointer",
        active
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{label}</span>
          {warnDot && (
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", warnDot)}
              aria-hidden="true"
            />
          )}
        </span>
        <span className="truncate text-2xs text-text-muted">{subtitle}</span>
      </span>
      {active && <Check size={14} strokeWidth={1.5} className="shrink-0" />}
    </button>
  );
}
