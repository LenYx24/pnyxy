import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bot, X, Zap, Brain, Coins } from "lucide-react";
import { AI_MODEL_CATALOG, type ModelInfo } from "@/lib/ai/ai-models";
import { cn } from "@/lib/cn";

interface ModelInfoModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Help modal anchored to the ModelPicker's "?" button. Lists every
 * model the user can choose, with what it's good for, average token
 * cost per turn, and routing notes (free Pnyxy quota vs. own key).
 *
 * Portaled to document.body so the fixed positioning is truly
 * viewport-relative — an earlier inline render was being scoped by
 * a transformed ancestor of the composer, which on mobile pushed
 * the bottom of the modal off-screen.
 */
export function ModelInfoModal({ open, onClose }: ModelInfoModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl sm:max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-purple/15">
              <Bot size={16} className="text-accent-purple" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("chat.modelHelp.title", {
                defaultValue: "Modellek és felhasználásuk",
              })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-text-muted">
            {t("chat.modelHelp.intro", {
              defaultValue:
                "Az alábbi modellek közül választhatsz a chat-ben. A „Default” opció az engedélyezett providereket sorrendben próbálja, és átesik a következőre, ha valamelyik elérhetetlen vagy elfogyott a kvóta. Ha kifejezett modellt választasz, csak az fut — fallback nélkül.",
            })}
          </p>

          {AI_MODEL_CATALOG.map((m) => (
            <ModelCard key={m.provider} model={m} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Single-model card used inside the modal AND in the Settings → AI
 * tab. Exported so the Settings inline-list and the chat modal share
 * identical styling.
 */
export function ModelCard({ model }: { model: ModelInfo }) {
  const { t } = useTranslation();

  return (
    <article className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 sm:p-4">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {model.displayName}
          </h3>
          <p className="font-mono text-[10px] text-text-muted truncate">
            {model.modelId}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-glass-border bg-bg-primary/40 px-2 py-0.5 text-[10px] font-medium text-text-muted">
          {model.routingNote}
        </span>
      </header>

      <p className="mb-3 text-xs text-text-secondary leading-relaxed">
        {model.description}
      </p>

      <div className="mb-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {t("chat.modelHelp.bestFor", { defaultValue: "Mire jó" })}
        </p>
        <ul className="space-y-0.5 text-xs text-text-secondary">
          {model.bestFor.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent-purple">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
        <Pill
          icon={Zap}
          label={t("chat.modelHelp.speed", { defaultValue: "Sebesség" })}
          value={
            { fast: "Gyors", medium: "Közepes", slow: "Lassú" }[model.speed]
          }
        />
        <Pill
          icon={Brain}
          label={t("chat.modelHelp.power", { defaultValue: "Erő" })}
          value={
            { basic: "Alap", balanced: "Kiegyensúlyozott", powerful: "Erős" }[
              model.power
            ]
          }
        />
        <Pill
          icon={Coins}
          label={t("chat.modelHelp.context", { defaultValue: "Kontextus" })}
          value={model.contextWindow}
        />
      </div>

      <div className="mt-3 rounded-md bg-bg-primary/40 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {t("chat.modelHelp.tokens", {
            defaultValue: "Átlagos token-költség egy fordulóra",
          })}
        </p>
        <p className="text-xs text-text-secondary">
          ≈ <strong>{model.estimatedTokensPerTurn.input.toLocaleString()}</strong>{" "}
          input + ≈{" "}
          <strong>{model.estimatedTokensPerTurn.output.toLocaleString()}</strong>{" "}
          output ={" "}
          <strong className="text-text-primary">
            ≈ {model.estimatedTokensPerTurn.total.toLocaleString()} token
          </strong>{" "}
          / forduló
        </p>
        <p className="mt-2 text-[11px] text-text-muted">{model.costNotes}</p>
      </div>
    </article>
  );
}

function Pill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1.5",
      )}
    >
      <Icon size={12} className="text-accent-purple/80 shrink-0" />
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-wider text-text-muted">
          {label}
        </p>
        <p className="truncate text-text-primary">{value}</p>
      </div>
    </div>
  );
}
