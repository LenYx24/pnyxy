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
import { AI_MODEL_CATALOG } from "@/lib/ai-models";
import { ModelCard } from "@/features/chat/ModelInfoModal";

interface AiUsage {
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

// Provider names themselves stay unlocalised (brand names).
const PROVIDER_LABELS: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function AiTab() {
  const { t } = useTranslation();
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const toggleProvider = useSettingsStore((s) => s.toggleProvider);
  const moveProvider = useSettingsStore((s) => s.moveProvider);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const openaiApiKey = useSettingsStore((s) => s.openaiApiKey);
  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const setOpenaiApiKey = useSettingsStore((s) => s.setOpenaiApiKey);

  const user = useAuthStore((s) => s.user);

  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  const [usageState, setUsageState] = useState<{
    forUserId: string | null;
    data: AiUsage | null;
  }>({ forUserId: null, data: null });

  const pnyxyEnabled = enabledProviders.includes("pnyxy");
  const usage = usageState.data;
  const usageLoading =
    pnyxyEnabled && !!user && usageState.forUserId !== user.id;

  useEffect(() => {
    if (!pnyxyEnabled || !user) return;
    let cancelled = false;
    supabase.rpc("get_my_ai_usage_today").then(({ data, error }) => {
      if (cancelled) return;
      const row =
        !error && Array.isArray(data) && data.length > 0
          ? (data[0] as AiUsage)
          : null;
      setUsageState({ forUserId: user.id, data: row });
    });
    return () => {
      cancelled = true;
    };
  }, [pnyxyEnabled, user]);

  const disabled = ALL_AI_PROVIDERS.filter(
    (p) => !enabledProviders.includes(p),
  );

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <BotMessageSquare size={18} className="text-accent-purple" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.aiSection.heading")}
        </h2>
      </div>
      <p className="text-xs text-text-muted">
        {t("settings.aiSection.description")}
      </p>

      {enabledProviders.length === 0 ? (
        <div className="rounded-lg border border-glass-border bg-bg-primary/40 p-4 text-center">
          <p className="text-sm text-text-secondary">
            {t("settings.aiSection.empty")}
          </p>
        </div>
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
              usage={usage}
              usageLoading={usageLoading}
              anthropicApiKey={anthropicApiKey}
              openaiApiKey={openaiApiKey}
              setAnthropicApiKey={setAnthropicApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              showAnthropicKey={showAnthropicKey}
              showOpenaiKey={showOpenaiKey}
              setShowAnthropicKey={setShowAnthropicKey}
              setShowOpenaiKey={setShowOpenaiKey}
            />
          ))}
        </div>
      )}

      {disabled.length > 0 && (
        <div>
          <p className="text-xs text-text-muted mb-2">
            {t("settings.aiSection.addPrompt")}
          </p>
          <div className="flex flex-wrap gap-2">
            {disabled.map((p) => (
              <button
                key={p}
                onClick={() => toggleProvider(p)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-bg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Plus size={12} />
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}

      <AiContextSection />
      <ModelCatalogSection />
    </section>
  );
}

/** "Modellek és felhasználásuk" inline reference list. Same content
 *  as the chat ModelInfoModal but rendered directly into Settings →
 *  AI for users who like to read about it before turning anything
 *  on. Reuses `ModelCard` so the two surfaces stay consistent.
 */
function ModelCatalogSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-lg border border-glass-border bg-bg-primary/30 p-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {t("settings.aiModels.heading", {
            defaultValue: "Modellek és felhasználásuk",
          })}
        </h3>
        <p className="mt-0.5 text-xs text-text-muted">
          {t("settings.aiModels.description", {
            defaultValue:
              "A három elérhető modell: mit ad, mire jó, és mennyi tokent fogyaszt egy átlagos chat-forduló.",
          })}
        </p>
      </div>
      <div className="space-y-3">
        {AI_MODEL_CATALOG.map((m) => (
          <ModelCard key={m.provider} model={m} />
        ))}
      </div>
    </div>
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
    <div className="space-y-3 rounded-lg border border-glass-border bg-bg-primary/30 p-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {t("settings.aiContext.heading")}
        </h3>
        <p className="text-xs text-text-muted mt-0.5">
          {t("settings.aiContext.description")}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-secondary">
          {t("settings.aiContext.customLabel")}
        </span>
        <textarea
          value={aiCustomDefaultContext}
          onChange={(e) => setAiCustomDefaultContext(e.target.value)}
          rows={4}
          placeholder={t("settings.aiContext.customPlaceholder")}
          className="w-full rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-purple/50 resize-y"
        />
        <span className="text-[10px] text-text-muted">
          {t("settings.aiContext.customHint")}
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={aiAttachToc}
          onChange={(e) => setAiAttachToc(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-accent-purple"
        />
        <span className="flex flex-col">
          <span className="text-xs font-medium text-text-secondary">
            {t("settings.aiContext.attachTocLabel")}
          </span>
          <span className="text-[10px] text-text-muted">
            {t("settings.aiContext.attachTocHint")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2">
        <span className="flex flex-col">
          <span className="text-xs font-medium text-text-secondary">
            {t("settings.aiContext.surroundingLabel")}
          </span>
          <span className="text-[10px] text-text-muted">
            {t("settings.aiContext.surroundingHint")}
          </span>
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
    </div>
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
  usage: AiUsage | null;
  usageLoading: boolean;
  anthropicApiKey: string;
  openaiApiKey: string;
  setAnthropicApiKey: (v: string) => void;
  setOpenaiApiKey: (v: string) => void;
  showAnthropicKey: boolean;
  showOpenaiKey: boolean;
  setShowAnthropicKey: (v: boolean) => void;
  setShowOpenaiKey: (v: boolean) => void;
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
  usage,
  usageLoading,
  anthropicApiKey,
  openaiApiKey,
  setAnthropicApiKey,
  setOpenaiApiKey,
  showAnthropicKey,
  showOpenaiKey,
  setShowAnthropicKey,
  setShowOpenaiKey,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const needsKey =
    (provider === "anthropic" && !anthropicApiKey.trim()) ||
    (provider === "openai" && !openaiApiKey.trim());

  const hint =
    provider === "pnyxy"
      ? t("settings.aiSection.pnyxyHint")
      : provider === "anthropic"
        ? t("settings.aiSection.anthropicHint")
        : t("settings.aiSection.openaiHint");

  return (
    <div className="rounded-lg border border-glass-border bg-bg-primary/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-purple/20 text-[10px] font-mono font-medium text-accent-purple">
            {position}
          </span>
          <div className="min-w-0">
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
            <p className="text-[11px] text-text-muted">{hint}</p>
          </div>
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
        <div className="pt-1">
          {!user ? (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.pnyxyAnon")}
            </p>
          ) : usageLoading ? (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.usageLoading")}
            </p>
          ) : usage ? (
            <>
              <UsageBar
                label={t("settings.aiSection.tokensToday")}
                used={usage.tokens_used}
                max={usage.tokens_limit}
              />
              <UsageBar
                label={t("settings.aiSection.requestsToday")}
                used={usage.request_count}
                max={usage.request_limit}
              />
              <p className="text-[10px] text-text-muted pt-1">
                {t("settings.aiSection.resetsDaily")}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-text-muted">
              {t("settings.aiSection.usageUnavailable")}
            </p>
          )}
        </div>
      )}

      {provider === "anthropic" && (
        <>
          <ApiKeyInput
            value={anthropicApiKey}
            onChange={setAnthropicApiKey}
            show={showAnthropicKey}
            onToggleShow={() => setShowAnthropicKey(!showAnthropicKey)}
            placeholder="sk-ant-..."
            helpText={t("settings.aiSection.anthropicKeyHint")}
          />
          <ByokQuotaInfo
            consoleHref="https://console.anthropic.com/settings/billing"
            consoleLabel={t("settings.aiSection.checkUsageAnthropic")}
          />
        </>
      )}

      {provider === "openai" && (
        <>
          <ApiKeyInput
            value={openaiApiKey}
            onChange={setOpenaiApiKey}
            show={showOpenaiKey}
            onToggleShow={() => setShowOpenaiKey(!showOpenaiKey)}
            placeholder="sk-..."
            helpText={t("settings.aiSection.openaiKeyHint")}
          />
          <ByokQuotaInfo
            consoleHref="https://platform.openai.com/usage"
            consoleLabel={t("settings.aiSection.checkUsageOpenAI")}
          />
        </>
      )}
    </div>
  );
}

function ByokQuotaInfo({
  consoleHref,
  consoleLabel,
}: {
  consoleHref: string;
  consoleLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 rounded-md border border-glass-border bg-bg-primary/30 p-2.5">
      <p className="text-[11px] leading-snug text-text-muted">
        {t("settings.aiSection.byokQuotaNote")}
      </p>
      <a
        href={consoleHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex text-[11px] font-medium text-accent-blue underline-offset-2 hover:underline"
      >
        {consoleLabel}
      </a>
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
  helpText,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  helpText: string;
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
      <p className="text-[10px] text-text-muted mt-1">{helpText}</p>
    </div>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
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
