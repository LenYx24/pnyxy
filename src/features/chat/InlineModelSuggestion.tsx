/**
 * Cross-model suggestion card. On the free auto-routed tier a cheap
 * model answers by default; when it judges the task would be served
 * better by a stronger model it appends a `pnyxy-suggest-model` block
 * (parsed by extract-model-suggestion.ts), and this renders the offer:
 * a one-line reason plus a "switch & retry" button that re-runs the
 * same user turn pinned to the stronger Pnyxy model.
 *
 * The suggested id is validated here against the real pin list
 * (PNYXY_MODEL_OPTIONS); an unknown id renders nothing, so a stray or
 * hallucinated model never produces a dead button.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";
import type { ModelSuggestion } from "@/lib/ai/extract-model-suggestion";
import { PNYXY_MODEL_OPTIONS } from "./quota";
import { cn } from "@/lib/cn";

export function InlineModelSuggestion({
  suggestion,
  onSwitch,
  disabled = false,
}: {
  suggestion: ModelSuggestion;
  /** Re-run the parent user turn pinned to this Pnyxy model. Absent
   *  when the message can't be regenerated (no user parent). */
  onSwitch?: (pnyxyModel: string) => void;
  /** True while any turn is streaming; the retry is held off. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  const target = PNYXY_MODEL_OPTIONS.find((m) => m.id === suggestion.model);
  // Unknown/hallucinated id, or nothing to re-run onto: render nothing.
  if (!target || !onSwitch || dismissed) return null;

  return (
    <div className="mt-2 flex items-start gap-2.5 rounded-panel border border-accent/25 bg-accent/5 px-3 py-2.5">
      <Sparkles size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        {suggestion.reason && (
          <p className="text-sm text-text-secondary">{suggestion.reason}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSwitch(target.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-chip bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-accent/25",
            )}
          >
            <Sparkles size={13} strokeWidth={1.5} />
            {t("chat.modelSuggestion.cta", { model: target.label })}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex items-center gap-1 rounded-chip px-2 py-1 text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-secondary cursor-pointer"
          >
            <X size={13} strokeWidth={1.5} />
            {t("chat.modelSuggestion.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
