import { useEffect, useState } from "react";
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

interface AiUsage {
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const PROVIDER_DESCRIPTIONS: Record<AiProvider, string> = {
  pnyxy: "Hosted by Pnyxy. Daily token limits apply.",
  anthropic: "Direct Anthropic API. Uses your own key.",
  openai: "Direct OpenAI API. Uses your own key.",
};

export function AiTab() {
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

  // Single state object so we can derive `loading` from a tag
  // rather than calling setState synchronously in the effect.
  const [usageState, setUsageState] = useState<{
    forUserId: string | null;
    data: AiUsage | null;
  }>({ forUserId: null, data: null });

  const pnyxyEnabled = enabledProviders.includes("pnyxy");
  const usage = usageState.data;
  const usageLoading =
    pnyxyEnabled && !!user && usageState.forUserId !== user.id;

  // Fetch today's quota usage when Pnyxy is in the chain.
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
        <h2 className="text-lg font-semibold text-text-primary">AI Assistant</h2>
      </div>
      <p className="text-xs text-text-muted">
        Configure providers in fallback priority order. The first one is tried;
        if it runs out of tokens or fails, the next is automatically used.
      </p>

      {/* Enabled providers — ordered fallback chain */}
      {enabledProviders.length === 0 ? (
        <div className="rounded-lg border border-glass-border bg-bg-primary/40 p-4 text-center">
          <p className="text-sm text-text-secondary">
            No providers enabled. Add one below.
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
          <p className="text-xs text-text-muted mb-2">Add a provider:</p>
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
  const needsKey =
    (provider === "anthropic" && !anthropicApiKey.trim()) ||
    (provider === "openai" && !openaiApiKey.trim());

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
                  Primary
                </span>
              )}
              {needsKey && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400">
                  Needs key
                </span>
              )}
            </p>
            <p className="text-[11px] text-text-muted">
              {PROVIDER_DESCRIPTIONS[provider]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            label="Move up"
            disabled={isFirst}
            onClick={onMoveUp}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            label="Move down"
            disabled={isLast}
            onClick={onMoveDown}
          >
            <ChevronDown size={14} />
          </IconButton>
          <IconButton label="Remove" onClick={onRemove}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {provider === "pnyxy" && (
        <div className="pt-1">
          {!user ? (
            <p className="text-[11px] text-text-muted">
              Sign in for the standard daily quota. Anonymous users get a small
              per-IP quota of 5 requests / 5,000 tokens per day.
            </p>
          ) : usageLoading ? (
            <p className="text-[11px] text-text-muted">Loading usage…</p>
          ) : usage ? (
            <>
              <UsageBar
                label="Tokens today"
                used={usage.tokens_used}
                max={usage.tokens_limit}
              />
              <UsageBar
                label="Requests today"
                used={usage.request_count}
                max={usage.request_limit}
              />
              <p className="text-[10px] text-text-muted pt-1">
                Resets daily at 00:00 UTC.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-text-muted">
              Usage data unavailable.
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
          helpText="Stored locally in your browser. Calls go directly to Anthropic."
        />
      )}

      {provider === "openai" && (
        <ApiKeyInput
          value={openaiApiKey}
          onChange={setOpenaiApiKey}
          show={showOpenaiKey}
          onToggleShow={() => setShowOpenaiKey(!showOpenaiKey)}
          placeholder="sk-..."
          helpText="Stored locally in your browser. Calls go directly to OpenAI."
        />
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
