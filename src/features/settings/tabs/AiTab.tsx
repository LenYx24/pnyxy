import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BotMessageSquare,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  X,
  Plus,
} from "lucide-react";
import { ALL_AI_PROVIDERS, useSettingsStore } from "@/stores/settings-store";
import type { AiProvider } from "@/stores/settings-store";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { AI_MODEL_CATALOG } from "@/lib/ai/ai-models";
import { ModelCard } from "@/features/chat/ModelInfoModal";

interface AiUsageRow {
  model: string;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

// Display labels for the per-model bars. Falls back to the raw
// model id if we don't have a friendlier name yet (so newly added
// models still render usefully without a client redeploy).
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-3-flash-preview": "Gemini 3 Flash (preview)",
  "gpt-4o-mini": "GPT-4o mini",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

// Provider names themselves stay unlocalised (brand names).
const PROVIDER_LABELS: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local model",
};

// Compact comparison data. Kept inline (not from AI_MODEL_CATALOG)
// because the table view wants short labels and price strings, while
// the catalog stores rich Hungarian prose used by the chat
// ModelInfoModal. The catalog is still the source of truth for the
// "Learn more" details at the bottom of this tab.
type ModelRowStatus = "active" | "byok" | "local" | "soon";
interface ComparisonRow {
  model: string;
  provider: string;
  cost: string;
  bestFor: string;
  status: ModelRowStatus;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    model: "Gemini 2.5 Flash-Lite",
    provider: "Pnyxy free · primary",
    cost: "Free (daily quota)",
    bestFor: "Default chat, quick Q&A, summaries",
    status: "active",
  },
  {
    model: "Gemini 2.5 Flash",
    provider: "Pnyxy free · step-up",
    cost: "Free (daily quota)",
    bestFor: "Fuller model when Flash-Lite is exhausted",
    status: "active",
  },
  {
    model: "Gemini 3 Flash (preview)",
    provider: "Pnyxy free · pin to use",
    cost: "Free (daily quota · smaller bucket)",
    bestFor: "Newest Google chat model — matches gemini.google.com",
    status: "active",
  },
  {
    model: "GPT-4o mini",
    provider: "Pnyxy free · fallback / BYOK",
    cost: "Free or $0.15 / $0.60",
    bestFor: "General chat, OpenAI fallback",
    status: "active",
  },
  {
    model: "Claude Haiku 4.5",
    provider: "Pnyxy free · tool-use / BYOK",
    cost: "Free or $1 / $5",
    bestFor: "Quiz / roadmap generation (tool-use)",
    status: "active",
  },
  {
    model: "o3-mini (reasoning)",
    provider: "OpenAI BYOK",
    cost: "$1.10 / $4.40",
    bestFor: "Math, logic, step-by-step problems",
    status: "byok",
  },
  {
    model: "Claude Sonnet 4.5",
    provider: "Anthropic BYOK",
    cost: "$3 / $15",
    bestFor: "Hardest reasoning, long tasks",
    status: "byok",
  },
  {
    model: "Mistral Small",
    provider: "Mistral (EU)",
    cost: "$0.20 / $0.60",
    bestFor: "EU-sovereign default",
    status: "soon",
  },
  {
    model: "Local (Ollama / LM Studio)",
    provider: "Your machine",
    cost: "Free",
    bestFor: "Offline, private",
    status: "local",
  },
];

export function AiTab() {
  const { t } = useTranslation();
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const toggleProvider = useSettingsStore((s) => s.toggleProvider);
  const moveProvider = useSettingsStore((s) => s.moveProvider);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const openaiApiKey = useSettingsStore((s) => s.openaiApiKey);
  const localBaseUrl = useSettingsStore((s) => s.localBaseUrl);
  const localModel = useSettingsStore((s) => s.localModel);
  const localApiKey = useSettingsStore((s) => s.localApiKey);
  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const setOpenaiApiKey = useSettingsStore((s) => s.setOpenaiApiKey);
  const setLocalBaseUrl = useSettingsStore((s) => s.setLocalBaseUrl);
  const setLocalModel = useSettingsStore((s) => s.setLocalModel);
  const setLocalApiKey = useSettingsStore((s) => s.setLocalApiKey);

  const user = useAuthStore((s) => s.user);

  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showLocalKey, setShowLocalKey] = useState(false);

  const [usageState, setUsageState] = useState<{
    forUserId: string | null;
    data: AiUsageRow[];
  }>({ forUserId: null, data: [] });

  const pnyxyEnabled = enabledProviders.includes("pnyxy");
  const usageRows = usageState.data;
  const usageLoading =
    pnyxyEnabled && !!user && usageState.forUserId !== user.id;

  useEffect(() => {
    if (!pnyxyEnabled || !user) return;
    let cancelled = false;
    supabase.rpc("get_my_ai_usage_today").then(({ data, error }) => {
      if (cancelled) return;
      const rows =
        !error && Array.isArray(data) ? (data as AiUsageRow[]) : [];
      setUsageState({ forUserId: user.id, data: rows });
    });
    return () => {
      cancelled = true;
    };
  }, [pnyxyEnabled, user]);

  const disabled = ALL_AI_PROVIDERS.filter(
    (p) => !enabledProviders.includes(p),
  );

  // No outer card chrome here on purpose. SettingsPage already gives
  // us padding and a max-width; the previous nested
  // section→ProviderRow→ByokQuotaInfo stack created the "card inside
  // card inside card" stack the user pushed back on. Each major
  // group below is a labeled block separated by spacing only.
  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <BotMessageSquare size={18} className="text-accent-purple" />
          <h2 className="text-lg font-semibold text-text-primary">
            {t("settings.aiSection.heading")}
          </h2>
        </div>
        <p className="text-xs text-text-muted">
          {t("settings.aiSection.description")}
        </p>
      </header>

      <ModelComparisonTable />

      <section className="space-y-3">
        <SectionHeading
          title={t("settings.aiSection.providersHeading", {
            defaultValue: "Providers",
          })}
          subtitle={t("settings.aiSection.providersSubtitle", {
            defaultValue:
              "Order = priority. First enabled provider with a valid key handles each chat. Drag-free reorder via the arrow buttons.",
          })}
        />

        {enabledProviders.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t("settings.aiSection.empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {enabledProviders.map((provider, idx) => (
              <ProviderRow
                key={provider}
                provider={provider}
                position={idx + 1}
                isFirst={idx === 0}
                isLast={idx === enabledProviders.length - 1}
                onMoveUp={() => moveProvider(provider, -1)}
                onMoveDown={() => moveProvider(provider, 1)}
                onRemove={() => toggleProvider(provider)}
                user={user}
                usageRows={usageRows}
                usageLoading={usageLoading}
                anthropicApiKey={anthropicApiKey}
                openaiApiKey={openaiApiKey}
                localBaseUrl={localBaseUrl}
                localModel={localModel}
                localApiKey={localApiKey}
                setAnthropicApiKey={setAnthropicApiKey}
                setOpenaiApiKey={setOpenaiApiKey}
                setLocalBaseUrl={setLocalBaseUrl}
                setLocalModel={setLocalModel}
                setLocalApiKey={setLocalApiKey}
                showAnthropicKey={showAnthropicKey}
                showOpenaiKey={showOpenaiKey}
                showLocalKey={showLocalKey}
                setShowAnthropicKey={setShowAnthropicKey}
                setShowOpenaiKey={setShowOpenaiKey}
                setShowLocalKey={setShowLocalKey}
              />
            ))}
          </div>
        )}

        {disabled.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {disabled.map((p) => (
              <button
                key={p}
                onClick={() => toggleProvider(p)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-glass-border bg-transparent px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Plus size={11} />
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        )}
      </section>

      <AiContextSection />

      <details className="group rounded-md border border-glass-border bg-transparent">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary">
          <span>
            {t("settings.aiModels.heading", {
              defaultValue: "Detailed model info",
            })}
          </span>
          <ChevronDown
            size={14}
            className="transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-3 border-t border-glass-border px-3 py-3">
          {AI_MODEL_CATALOG.map((m) => (
            <ModelCard key={m.provider} model={m} />
          ))}
        </div>
      </details>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
    </div>
  );
}

/**
 * Compact at-a-glance comparison of every model the user could pick.
 * Replaces the long text-heavy ModelCatalogSection at the top of the
 * tab. Detailed prose lives in the collapsible at the bottom for
 * users who want to read more.
 *
 * Table on sm+, stacked rows on mobile — a true `<table>` at 375px
 * wraps awkwardly even with overflow-x-auto. The mobile stack keeps
 * the same column ordering and label/value pairing.
 */
function ModelComparisonTable() {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <SectionHeading
        title={t("settings.aiSection.modelsHeading", {
          defaultValue: "Available models",
        })}
        subtitle={t("settings.aiSection.modelsSubtitle", {
          defaultValue: "Prices are per 1M tokens (input / output).",
        })}
      />

      {/* Desktop: real table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
              <th className="py-1.5 pr-3 font-medium">
                {t("settings.aiSection.colModel", { defaultValue: "Model" })}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("settings.aiSection.colProvider", {
                  defaultValue: "Provider",
                })}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("settings.aiSection.colCost", {
                  defaultValue: "Cost / 1M tok",
                })}
              </th>
              <th className="py-1.5 pr-3 font-medium">
                {t("settings.aiSection.colBestFor", {
                  defaultValue: "Best for",
                })}
              </th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr
                key={row.model}
                className="border-t border-glass-border/60 align-top"
              >
                <td className="py-2 pr-3 font-medium text-text-primary">
                  {row.model}
                </td>
                <td className="py-2 pr-3 text-text-secondary">
                  {row.provider}
                </td>
                <td className="py-2 pr-3 font-mono text-[11px] text-text-secondary">
                  {row.cost}
                </td>
                <td className="py-2 pr-3 text-text-secondary">{row.bestFor}</td>
                <td className="py-2">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked rows. Same data, different presentation. */}
      <div className="space-y-1.5 sm:hidden">
        {COMPARISON_ROWS.map((row) => (
          <div
            key={row.model}
            className="rounded-md border border-glass-border bg-bg-primary/30 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">
                  {row.model}
                </p>
                <p className="truncate text-[11px] text-text-muted">
                  {row.provider}
                </p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
              <span className="text-text-muted">
                {t("settings.aiSection.colCost", {
                  defaultValue: "Cost",
                })}
              </span>
              <span className="font-mono text-text-secondary">{row.cost}</span>
              <span className="text-text-muted">
                {t("settings.aiSection.colBestFor", {
                  defaultValue: "Best for",
                })}
              </span>
              <span className="text-text-secondary">{row.bestFor}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ModelRowStatus }) {
  const { t } = useTranslation();
  const styles: Record<ModelRowStatus, string> = {
    active: "bg-emerald-500/15 text-emerald-300",
    byok: "bg-accent-purple/15 text-accent-purple",
    local: "bg-accent-blue/15 text-accent-blue",
    soon: "bg-amber-500/10 text-amber-400/85",
  };
  const labels: Record<ModelRowStatus, string> = {
    active: t("settings.aiSection.statusActive", { defaultValue: "Active" }),
    byok: t("settings.aiSection.statusByok", { defaultValue: "BYOK" }),
    local: t("settings.aiSection.statusLocal", { defaultValue: "Local" }),
    soon: t("settings.aiSection.statusSoon", { defaultValue: "Soon" }),
  };
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        styles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}

/** Settings for what context the AI receives by default in chat —
 *  free-form persona / preferences, an "always include the TOC" flag
 *  for book chats, and the page count for the TOC's "select around
 *  current ±N" button. Each control persists immediately; the chat
 *  store reads them at send time. */
function AiContextSection() {
  const { t } = useTranslation();
  const aiCustomDefaultContext = useSettingsStore(
    (s) => s.aiCustomDefaultContext,
  );
  const setAiCustomDefaultContext = useSettingsStore(
    (s) => s.setAiCustomDefaultContext,
  );
  const aiAttachToc = useSettingsStore((s) => s.aiAttachToc);
  const setAiAttachToc = useSettingsStore((s) => s.setAiAttachToc);
  const aiSurroundingPagesCount = useSettingsStore(
    (s) => s.aiSurroundingPagesCount,
  );
  const setAiSurroundingPagesCount = useSettingsStore(
    (s) => s.setAiSurroundingPagesCount,
  );

  return (
    <section className="space-y-3">
      <SectionHeading
        title={t("settings.aiContext.heading")}
        subtitle={t("settings.aiContext.description")}
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-secondary">
          {t("settings.aiContext.customLabel")}
        </span>
        <textarea
          value={aiCustomDefaultContext}
          onChange={(e) => setAiCustomDefaultContext(e.target.value)}
          rows={3}
          placeholder={t("settings.aiContext.customPlaceholder")}
          className="w-full resize-y rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
        />
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={aiAttachToc}
          onChange={(e) => setAiAttachToc(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-accent-purple"
        />
        <span className="text-xs font-medium text-text-secondary">
          {t("settings.aiContext.attachTocLabel")}
        </span>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-secondary">
          {t("settings.aiContext.surroundingLabel")}
        </span>
        <input
          type="number"
          min={0}
          max={50}
          value={aiSurroundingPagesCount}
          onChange={(e) => setAiSurroundingPagesCount(Number(e.target.value))}
          className="ml-auto w-16 rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
        />
      </label>
    </section>
  );
}

interface ProviderRowProps {
  provider: AiProvider;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  user: ReturnType<typeof useAuthStore.getState>["user"];
  usageRows: AiUsageRow[];
  usageLoading: boolean;
  anthropicApiKey: string;
  openaiApiKey: string;
  localBaseUrl: string;
  localModel: string;
  localApiKey: string;
  setAnthropicApiKey: (v: string) => void;
  setOpenaiApiKey: (v: string) => void;
  setLocalBaseUrl: (v: string) => void;
  setLocalModel: (v: string) => void;
  setLocalApiKey: (v: string) => void;
  showAnthropicKey: boolean;
  showOpenaiKey: boolean;
  showLocalKey: boolean;
  setShowAnthropicKey: (v: boolean) => void;
  setShowOpenaiKey: (v: boolean) => void;
  setShowLocalKey: (v: boolean) => void;
}

function ProviderRow({
  provider,
  position,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
  user,
  usageRows,
  usageLoading,
  anthropicApiKey,
  openaiApiKey,
  localBaseUrl,
  localModel,
  localApiKey,
  setAnthropicApiKey,
  setOpenaiApiKey,
  setLocalBaseUrl,
  setLocalModel,
  setLocalApiKey,
  showAnthropicKey,
  showOpenaiKey,
  showLocalKey,
  setShowAnthropicKey,
  setShowOpenaiKey,
  setShowLocalKey,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const needsKey =
    (provider === "anthropic" && !anthropicApiKey.trim()) ||
    (provider === "openai" && !openaiApiKey.trim()) ||
    (provider === "local" && (!localBaseUrl.trim() || !localModel.trim()));

  return (
    <div className="rounded-md border border-glass-border bg-bg-primary/30 p-2.5 space-y-2 sm:p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-purple/20 text-[10px] font-mono font-medium text-accent-purple">
            {position}
          </span>
          <p className="text-sm font-medium text-text-primary truncate">
            {PROVIDER_LABELS[provider]}
            {isFirst && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-accent-purple">
                {t("settings.aiSection.primary")}
              </span>
            )}
            {needsKey && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400">
                {t("settings.aiSection.needsKey")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            label={t("settings.aiSection.moveUp")}
            disabled={isFirst}
            onClick={onMoveUp}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            label={t("settings.aiSection.moveDown")}
            disabled={isLast}
            onClick={onMoveDown}
          >
            <ChevronDown size={14} />
          </IconButton>
          <IconButton label={t("settings.aiSection.remove")} onClick={onRemove}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {provider === "pnyxy" && (
        <div>
          {!user ? (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.pnyxyAnon")}
            </p>
          ) : usageLoading ? (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.usageLoading")}
            </p>
          ) : usageRows.length > 0 ? (
            <div className="divide-y divide-glass-border/50">
              {usageRows.map((row) => (
                <div key={row.model} className="space-y-1 py-2.5 first:pt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                    {MODEL_DISPLAY_NAMES[row.model] ?? row.model}
                  </p>
                  <UsageBar
                    label={t("settings.aiSection.tokensToday")}
                    used={row.tokens_used}
                    max={row.tokens_limit}
                  />
                  <UsageBar
                    label={t("settings.aiSection.requestsToday")}
                    used={row.request_count}
                    max={row.request_limit}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.usageUnavailable")}
            </p>
          )}
        </div>
      )}

      {provider === "anthropic" && (
        <ApiKeyInput
          value={anthropicApiKey}
          onChange={setAnthropicApiKey}
          show={showAnthropicKey}
          onToggleShow={() => setShowAnthropicKey(!showAnthropicKey)}
          placeholder="sk-ant-..."
          consoleHref="https://console.anthropic.com/settings/billing"
          consoleLabel={t("settings.aiSection.checkUsageAnthropic")}
        />
      )}

      {provider === "openai" && (
        <ApiKeyInput
          value={openaiApiKey}
          onChange={setOpenaiApiKey}
          show={showOpenaiKey}
          onToggleShow={() => setShowOpenaiKey(!showOpenaiKey)}
          placeholder="sk-..."
          consoleHref="https://platform.openai.com/usage"
          consoleLabel={t("settings.aiSection.checkUsageOpenAI")}
        />
      )}

      {provider === "local" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] font-medium text-text-secondary">
              {t("settings.aiSection.localBaseUrlLabel")}
            </span>
            <input
              type="text"
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="mt-0.5 w-full rounded-md border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-text-secondary">
              {t("settings.aiSection.localModelLabel")}
            </span>
            <input
              type="text"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              placeholder="llama3.2"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="mt-0.5 w-full rounded-md border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
            />
          </label>
          <ApiKeyInput
            value={localApiKey}
            onChange={setLocalApiKey}
            show={showLocalKey}
            onToggleShow={() => setShowLocalKey(!showLocalKey)}
            placeholder={t("settings.aiSection.localApiKeyPlaceholder")}
          />
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md p-1 transition-colors",
        disabled
          ? "text-text-muted/30 cursor-not-allowed"
          : "text-text-muted hover:text-text-primary hover:bg-glass-hover cursor-pointer",
      )}
    >
      {children}
    </button>
  );
}

function ApiKeyInput({
  value,
  onChange,
  show,
  onToggleShow,
  placeholder,
  consoleHref,
  consoleLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  /** Optional "check usage at provider" deep link. Renders as a
   *  small caption under the input — used to live inside its own
   *  nested card, but that was the third level of card nesting on
   *  the page. */
  consoleHref?: string;
  consoleLabel?: string;
}) {
  return (
    <div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-glass-border bg-glass-bg px-3 py-1.5 pr-9 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {consoleHref && consoleLabel && (
        <a
          href={consoleHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[10px] font-medium text-accent-blue underline-offset-2 hover:underline"
        >
          {consoleLabel} →
        </a>
      )}
    </div>
  );
}

function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const nearLimit = pct >= 80;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">
          {used.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-glass-bg">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            nearLimit ? "bg-red-500/70" : "bg-accent-purple/70",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
