import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ALL_AI_PROVIDERS, useSettingsStore } from "@/stores/settings-store";
import type { AiProvider } from "@/stores/settings-store";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { AI_MODEL_CATALOG } from "@/lib/ai/ai-models";
import { ModelCard } from "@/features/chat/ModelInfoModal";
import {
  Button,
  FloatingMenu,
  IconButton,
  NumberInput,
  Toggle,
  chipClass,
} from "@/components/ui";
import { Disclosure, SettingRow, SettingsSection, StatusLine } from "../ui";
import { AiContextPresetsPanel } from "../ai-context/AiContextPresetsPanel";

interface AiUsageRow {
  model: string;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

// Display labels for the quota table, falls back to raw model id.
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-3-flash-preview": "Gemini 3 Flash (preview)",
  "gpt-4o-mini": "GPT-4o mini",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

// brand names, not localised
const PROVIDER_LABELS: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Local model",
};

// Monogram for the 32 px logo-less tile.
const PROVIDER_MONOGRAM: Record<AiProvider, string> = {
  pnyxy: "P",
  openai: "O",
  anthropic: "A",
  local: "L",
};

// Display order of the provider rows: built-in first, then BYOK, then local.
const PROVIDER_ORDER: AiProvider[] = ["pnyxy", "openai", "anthropic", "local"];

// Free-tier models the proxy can be pinned to. ids must match
// `_ai_usage_limits_for_model` on the SQL side and the chat composer's list.
type ModelNote = "cheap" | "fast" | "smart" | "balanced";
const PNYXY_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  provider: string;
  note: ModelNote;
}> = [
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "Google", note: "cheap" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google", note: "fast" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", provider: "Google", note: "smart" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", note: "balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic", note: "smart" },
];

// short table labels, kept inline since AI_MODEL_CATALOG stores long prose
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
    bestFor: "Newest Google chat model, matches gemini.google.com",
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

/** Cheap connectivity probe: list models with the given credentials. */
async function testProvider(
  provider: AiProvider,
  creds: { key: string; baseUrl: string },
): Promise<{ ok: boolean; detail?: string }> {
  try {
    let res: Response;
    if (provider === "openai") {
      res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${creds.key.trim()}` },
      });
    } else if (provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": creds.key.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
    } else if (provider === "local") {
      const base = creds.baseUrl.trim().replace(/\/+$/, "");
      const headers: Record<string, string> = {};
      if (creds.key.trim()) headers.Authorization = `Bearer ${creds.key.trim()}`;
      res = await fetch(`${base}/models`, { headers });
    } else {
      return { ok: true };
    }
    return res.ok
      ? { ok: true }
      : { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function AiTab() {
  const { t } = useTranslation();
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const toggleProvider = useSettingsStore((s) => s.toggleProvider);
  const setEnabledProviders = useSettingsStore((s) => s.setEnabledProviders);
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const setPnyxyModel = useSettingsStore((s) => s.setPnyxyModel);

  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // Show a back affordance when we arrived here with in-app history
  // (e.g. from a chat's "view quota" link), where the settings shell's
  // tab list isn't an obvious way back, especially on mobile.
  const canGoBack =
    typeof window !== "undefined" &&
    typeof (window.history.state as { idx?: number } | null)?.idx === "number" &&
    (window.history.state as { idx: number }).idx > 0;

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

  const providers = PROVIDER_ORDER.filter((p) => ALL_AI_PROVIDERS.includes(p));

  return (
    <div className="space-y-8">
      {canGoBack && (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t("common.back", { defaultValue: "Back" })}
        </Button>
      )}

      <SettingsSection
        title={t("settings.aiSection.providersHeading", {
          defaultValue: "Providers",
        })}
        description={t("settings.aiSection.providersShort", {
          defaultValue:
            "Pnyxy is built in. Add your own key to talk to OpenAI or Anthropic directly, or point at a local model.",
        })}
        plain
      >
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              enabled={enabledProviders.includes(provider)}
              onToggle={() => toggleProvider(provider)}
              user={user}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings.aiSection.orderHeading", { defaultValue: "Order" })}
        description={t("settings.aiSection.orderHint", {
          defaultValue: "The provider at the top is tried first.",
        })}
        plain
      >
        <ProviderOrderList
          order={enabledProviders}
          onReorder={setEnabledProviders}
        />
      </SettingsSection>

      <SettingsSection
        title={t("settings.aiSection.defaultModelHeading", {
          defaultValue: "Default model",
        })}
        description={t("settings.aiSection.defaultModelHint", {
          defaultValue:
            "Used by the built-in Pnyxy route. Auto picks the cheapest working model and steps up when a quota runs out.",
        })}
      >
        <SettingRow
          label={t("settings.aiSection.defaultModelLabel", {
            defaultValue: "Model",
          })}
          hint={t("settings.aiSection.routingNote", {
            defaultValue:
              "Quiz and roadmap generation always use Claude Haiku 4.5 (tool-use).",
          })}
          control={
            <DefaultModelPicker value={pnyxyModel} onChange={setPnyxyModel} />
          }
        />
      </SettingsSection>

      {pnyxyEnabled && (
        <SettingsSection
          title={t("settings.aiSection.quotasHeading", { defaultValue: "Quotas" })}
          description={
            user
              ? t("settings.aiSection.resetsDaily")
              : t("settings.aiSection.pnyxyAnon")
          }
          plain={!user}
        >
          {!user ? null : usageLoading ? (
            <p className="py-3 text-[13px] text-text-muted">
              {t("settings.aiSection.usageLoading")}
            </p>
          ) : usageRows.length > 0 ? (
            <QuotaTable rows={usageRows} />
          ) : (
            <p className="py-3 text-[13px] text-text-muted">
              {t("settings.aiSection.usageUnavailable")}
            </p>
          )}
        </SettingsSection>
      )}

      <AiContextSection />

      <Disclosure
        title={t("settings.aiSection.howItWorks", { defaultValue: "How it works" })}
      >
        <div className="space-y-5 pt-1">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            {t("settings.aiSection.description")}
          </p>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            {t("settings.aiSection.byokQuotaNote")}
          </p>
          <ModelComparisonTable />
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-text-primary">
              {t("settings.aiModels.heading", {
                defaultValue: "Detailed model info",
              })}
            </p>
            {AI_MODEL_CATALOG.map((m) => (
              <ModelCard key={m.provider} model={m} />
            ))}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

function Monogram({ provider, className }: { provider: AiProvider; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-surface-3 font-display text-sm font-semibold text-text-primary",
        className,
      )}
    >
      {PROVIDER_MONOGRAM[provider]}
    </span>
  );
}

function ProviderCard({
  provider,
  enabled,
  onToggle,
  user,
}: {
  provider: AiProvider;
  enabled: boolean;
  onToggle: () => void;
  user: ReturnType<typeof useAuthStore.getState>["user"];
}) {
  const { t } = useTranslation();
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

  const [expanded, setExpanded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok" }
    | { kind: "fail"; detail?: string }
  >({ kind: "idle" });

  const key =
    provider === "anthropic"
      ? anthropicApiKey
      : provider === "openai"
        ? openaiApiKey
        : provider === "local"
          ? localApiKey
          : "";
  const setKey =
    provider === "anthropic"
      ? setAnthropicApiKey
      : provider === "openai"
        ? setOpenaiApiKey
        : setLocalApiKey;

  const configured =
    provider === "pnyxy"
      ? true
      : provider === "local"
        ? !!localBaseUrl.trim() && !!localModel.trim()
        : !!key.trim();

  const status =
    provider === "pnyxy"
      ? t("settings.aiSection.statusBuiltin", { defaultValue: "Built in" })
      : configured
        ? t("settings.aiSection.statusKeySet", { defaultValue: "Key set" })
        : t("settings.aiSection.statusNoKey", { defaultValue: "No key" });

  const hint = t(`settings.aiSection.${provider}Hint`);

  const consoleHref =
    provider === "anthropic"
      ? "https://console.anthropic.com/settings/billing"
      : provider === "openai"
        ? "https://platform.openai.com/usage"
        : null;
  const consoleLabel =
    provider === "anthropic"
      ? t("settings.aiSection.checkUsageAnthropic")
      : provider === "openai"
        ? t("settings.aiSection.checkUsageOpenAI")
        : null;

  const runTest = async () => {
    setTest({ kind: "running" });
    const result = await testProvider(provider, { key, baseUrl: localBaseUrl });
    setTest(result.ok ? { kind: "ok" } : { kind: "fail", detail: result.detail });
  };

  const remove = () => {
    if (provider === "local") {
      setLocalModel("");
      setLocalApiKey("");
    } else {
      setKey("");
    }
    if (enabled) onToggle();
    setTest({ kind: "idle" });
    setExpanded(false);
  };

  const keyField = (
    <div className="relative">
      <input
        type={showKey ? "text" : "password"}
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setTest({ kind: "idle" });
        }}
        placeholder={
          provider === "anthropic"
            ? "sk-ant-..."
            : provider === "openai"
              ? "sk-..."
              : t("settings.aiSection.localApiKeyPlaceholder")
        }
        spellCheck={false}
        autoComplete="off"
        className="field bg-bg-secondary pr-10"
      />
      <IconButton
        size="sm"
        onClick={() => setShowKey((v) => !v)}
        aria-label={showKey ? "Hide key" : "Show key"}
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
      >
        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconButton>
    </div>
  );

  return (
    <div className="rounded-panel bg-bg-tertiary">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <Monogram provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[15px] font-medium text-text-primary">
              {PROVIDER_LABELS[provider]}
            </p>
            <span
              className={cn(
                chipClass,
                "px-2 py-0.5 text-2xs",
                !configured && "text-text-muted-2",
              )}
            >
              {status}
            </span>
          </div>
          <p className="hidden truncate text-[13px] text-text-muted sm:block">
            {hint}
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={onToggle}
          label={t("settings.aiSection.enableProvider", {
            defaultValue: "Enable {{name}}",
            name: PROVIDER_LABELS[provider],
          })}
        />
        <IconButton
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronDown
            size={16}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </IconButton>
      </div>

      {expanded && (
        <div className="space-y-3 px-4 pb-4 sm:px-5">
          <p className="text-[13px] text-text-muted sm:hidden">{hint}</p>

          {provider === "pnyxy" && (
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {user
                ? t("settings.aiSection.pnyxyHint")
                : t("settings.aiSection.pnyxyAnon")}
            </p>
          )}

          {provider === "local" && (
            <>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-text-secondary">
                  {t("settings.aiSection.localBaseUrlLabel")}
                </span>
                <input
                  type="text"
                  value={localBaseUrl}
                  onChange={(e) => {
                    setLocalBaseUrl(e.target.value);
                    setTest({ kind: "idle" });
                  }}
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  className="field bg-bg-secondary"
                />
                <span className="block text-2xs text-text-muted-2">
                  {t("settings.aiSection.localBaseUrlHint")}
                </span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-text-secondary">
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
                  className="field bg-bg-secondary"
                />
                <span className="block text-2xs text-text-muted-2">
                  {t("settings.aiSection.localModelHint")}
                </span>
              </label>
            </>
          )}

          {provider !== "pnyxy" && (
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-text-secondary">
                {t("settings.aiSection.apiKeyLabel", { defaultValue: "API key" })}
              </span>
              {keyField}
              <span className="block text-2xs text-text-muted-2">
                {provider === "local"
                  ? t("settings.aiSection.localApiKeyHint")
                  : t(`settings.aiSection.${provider}KeyHint`)}
              </span>
            </div>
          )}

          {provider !== "pnyxy" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={runTest}
                disabled={!configured || test.kind === "running"}
              >
                {test.kind === "running" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                {test.kind === "running"
                  ? t("settings.aiSection.testing", { defaultValue: "Testing…" })
                  : t("settings.aiSection.testKey", { defaultValue: "Test" })}
              </Button>
              <Button variant="ghost" size="sm" onClick={remove}>
                {t("settings.aiSection.remove")}
              </Button>
              {consoleHref && consoleLabel && (
                <a
                  href={consoleHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-2xs font-medium text-text-muted underline-offset-2 hover:text-text-primary hover:underline"
                >
                  {consoleLabel}
                </a>
              )}
            </div>
          )}

          {test.kind === "ok" && (
            <StatusLine tone="success">
              {t("settings.aiSection.testOk", { defaultValue: "Connection works." })}
            </StatusLine>
          )}
          {test.kind === "fail" && (
            <StatusLine tone="danger">
              {t("settings.aiSection.testFail", {
                defaultValue: "Connection failed.",
              })}
              {test.detail ? ` (${test.detail})` : ""}
            </StatusLine>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Order (drag to reorder)                                             */
/* ------------------------------------------------------------------ */

function ProviderOrderList({
  order,
  onReorder,
}: {
  order: AiProvider[];
  onReorder: (next: AiProvider[]) => void;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as AiProvider);
    const to = order.indexOf(over.id as AiProvider);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(order, from, to));
  };

  if (order.length === 0) {
    return (
      <p className="px-1 text-[13px] text-text-muted">
        {t("settings.aiSection.empty")}
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="space-y-1.5">
          {order.map((provider, idx) => (
            <SortableProviderRow
              key={provider}
              provider={provider}
              position={idx + 1}
              draggable={order.length > 1}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableProviderRow({
  provider,
  position,
  draggable,
}: {
  provider: AiProvider;
  position: number;
  draggable: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider, disabled: !draggable });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-panel bg-bg-tertiary px-3 py-2.5",
        isDragging && "z-10 bg-surface-3 shadow-page",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={!draggable}
        aria-label={t("settings.aiSection.dragHandle", {
          defaultValue: "Drag to reorder",
        })}
        className={cn(
          "flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-text-muted-2",
          draggable
            ? "cursor-grab hover:text-text-primary active:cursor-grabbing"
            : "cursor-default opacity-40",
        )}
      >
        <GripVertical size={16} />
      </button>
      <Monogram provider={provider} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">
        {PROVIDER_LABELS[provider]}
      </span>
      {position === 1 && (
        <span className={cn(chipClass, "px-2 py-0.5 text-2xs")}>
          {t("settings.aiSection.primary")}
        </span>
      )}
      <span className="w-5 text-right font-mono text-xs text-text-muted-2">
        {position}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Default model                                                       */
/* ------------------------------------------------------------------ */

function DefaultModelPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const noteLabel: Record<ModelNote, string> = {
    cheap: t("settings.aiSection.noteCheap", { defaultValue: "cheap" }),
    fast: t("settings.aiSection.noteFast", { defaultValue: "fast" }),
    smart: t("settings.aiSection.noteSmart", { defaultValue: "smart" }),
    balanced: t("settings.aiSection.noteBalanced", { defaultValue: "balanced" }),
  };
  const autoLabel = t("settings.aiSection.autoModel", { defaultValue: "Auto" });
  const autoNote = t("settings.aiSection.autoModelNote", {
    defaultValue: "cheapest working model, steps up on quota",
  });

  const selected = value
    ? PNYXY_MODEL_OPTIONS.find((m) => m.id === value)
    : null;
  const triggerLabel = selected ? selected.label : autoLabel;
  const triggerSub = selected
    ? `${selected.provider} · ${noteLabel[selected.note]}`
    : autoNote;

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="field flex w-full min-w-[220px] cursor-pointer items-center justify-between gap-3 bg-bg-secondary text-left sm:w-auto sm:max-w-xs"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text-primary">
            {triggerLabel}
          </span>
          <span className="block truncate text-2xs text-text-muted">
            {triggerSub}
          </span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-text-muted" />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <div role="listbox" className="p-1">
          <ModelOption
            active={value === null}
            label={autoLabel}
            sub={autoNote}
            onClick={() => pick(null)}
          />
          {PNYXY_MODEL_OPTIONS.map((m) => (
            <ModelOption
              key={m.id}
              active={value === m.id}
              label={m.label}
              sub={m.provider}
              note={noteLabel[m.note]}
              onClick={() => pick(m.id)}
            />
          ))}
        </div>
      </FloatingMenu>
    </>
  );
}

function ModelOption({
  active,
  label,
  sub,
  note,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-left transition-colors",
        active ? "bg-surface-3" : "hover:bg-surface-3/60",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {label}
        </span>
        <span className="block truncate text-2xs text-text-muted">{sub}</span>
      </span>
      {note && (
        <span className={cn(chipClass, "px-2 py-0.5 text-2xs")}>{note}</span>
      )}
      {active && <Check size={14} className="shrink-0 text-text-primary" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Quotas                                                              */
/* ------------------------------------------------------------------ */

function QuotaTable({ rows }: { rows: AiUsageRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto py-2">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2">
            <th className="py-2 pr-4 font-semibold">
              {t("settings.aiSection.colModel", { defaultValue: "Model" })}
            </th>
            <th className="py-2 pr-4 font-semibold">
              {t("settings.aiSection.tokensToday")}
            </th>
            <th className="py-2 pr-4 font-semibold">
              {t("settings.aiSection.requestsToday")}
            </th>
            <th className="py-2 font-semibold">
              {t("settings.aiSection.colReset", { defaultValue: "Reset" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.model} className="align-middle">
              <td className="py-2 pr-4 font-medium text-text-primary">
                {MODEL_DISPLAY_NAMES[row.model] ?? row.model}
              </td>
              <td className="py-2 pr-4">
                <QuotaCell used={row.tokens_used} max={row.tokens_limit} />
              </td>
              <td className="py-2 pr-4">
                <QuotaCell used={row.request_count} max={row.request_limit} />
              </td>
              <td className="py-2 whitespace-nowrap text-text-muted">00:00 UTC</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuotaCell({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const nearLimit = pct >= 80;
  return (
    <div className="min-w-[8rem] space-y-1">
      <span className="block whitespace-nowrap font-mono text-xs text-text-secondary">
        {used.toLocaleString()} / {max.toLocaleString()}
      </span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            nearLimit ? "bg-danger/70" : "bg-text-muted",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Context defaults                                                    */
/* ------------------------------------------------------------------ */

// Chat context settings: named context presets (with their book / folder /
// org bindings), the attach-TOC flag, and the ±N page count for the TOC
// selector. Each control persists immediately.
function AiContextSection() {
  const { t } = useTranslation();
  const aiAttachToc = useSettingsStore((s) => s.aiAttachToc);
  const setAiAttachToc = useSettingsStore((s) => s.setAiAttachToc);
  const aiSurroundingPagesCount = useSettingsStore(
    (s) => s.aiSurroundingPagesCount,
  );
  const setAiSurroundingPagesCount = useSettingsStore(
    (s) => s.setAiSurroundingPagesCount,
  );

  return (
    <SettingsSection
      title={t("settings.aiContext.heading")}
      description={t("settings.aiContext.description")}
    >
      <SettingRow
        label={t("settings.aiContext.customLabel")}
        hint={t("settings.aiContext.customHint")}
        stacked
      >
        <AiContextPresetsPanel />
      </SettingRow>
      <SettingRow
        label={t("settings.aiContext.attachTocLabel")}
        hint={t("settings.aiContext.attachTocHint")}
        control={<Toggle checked={aiAttachToc} onChange={setAiAttachToc} />}
      />
      <SettingRow
        label={t("settings.aiContext.surroundingLabel")}
        hint={t("settings.aiContext.surroundingHint")}
        control={
          <NumberInput
            value={aiSurroundingPagesCount}
            onChange={(v) => setAiSurroundingPagesCount(Math.max(0, Math.min(50, v)))}
            min={0}
            max={50}
            className="w-32"
          />
        }
      />
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Reference table (inside the disclosure)                             */
/* ------------------------------------------------------------------ */

// Model comparison. Real table on sm+, stacked rows on mobile since a
// <table> wraps awkwardly at 375px even with overflow-x-auto.
function ModelComparisonTable() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[13px] font-medium text-text-primary">
          {t("settings.aiSection.modelsHeading", {
            defaultValue: "Available models",
          })}
        </p>
        <p className="text-2xs text-text-muted">
          {t("settings.aiSection.modelsSubtitle", {
            defaultValue: "Prices are per 1M tokens (input / output).",
          })}
        </p>
      </div>

      {/* desktop */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2">
              <th className="py-1.5 pr-3 font-semibold">
                {t("settings.aiSection.colModel", { defaultValue: "Model" })}
              </th>
              <th className="py-1.5 pr-3 font-semibold">
                {t("settings.aiSection.colProvider", {
                  defaultValue: "Provider",
                })}
              </th>
              <th className="py-1.5 pr-3 font-semibold">
                {t("settings.aiSection.colCost", {
                  defaultValue: "Cost / 1M tok",
                })}
              </th>
              <th className="py-1.5 pr-3 font-semibold">
                {t("settings.aiSection.colBestFor", {
                  defaultValue: "Best for",
                })}
              </th>
              <th className="py-1.5 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.model} className="align-top">
                <td className="py-2 pr-3 font-medium text-text-primary">
                  {row.model}
                </td>
                <td className="py-2 pr-3 text-text-secondary">
                  {row.provider}
                </td>
                <td className="py-2 pr-3 font-mono text-2xs text-text-secondary">
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

      {/* mobile */}
      <div className="space-y-1.5 sm:hidden">
        {COMPARISON_ROWS.map((row) => (
          <div
            key={row.model}
            className="rounded-control bg-bg-secondary/60 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">
                  {row.model}
                </p>
                <p className="truncate text-2xs text-text-muted">
                  {row.provider}
                </p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 text-2xs">
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
    </div>
  );
}

function StatusBadge({ status }: { status: ModelRowStatus }) {
  const { t } = useTranslation();
  const labels: Record<ModelRowStatus, string> = {
    active: t("settings.aiSection.statusActive", { defaultValue: "Active" }),
    byok: t("settings.aiSection.statusByok", { defaultValue: "BYOK" }),
    local: t("settings.aiSection.statusLocal", { defaultValue: "Local" }),
    soon: t("settings.aiSection.statusSoon", { defaultValue: "Soon" }),
  };
  return (
    <span
      className={cn(
        chipClass,
        "px-2 py-0.5 text-2xs uppercase tracking-wide",
        status === "soon" && "text-text-muted-2",
      )}
    >
      {labels[status]}
    </span>
  );
}
