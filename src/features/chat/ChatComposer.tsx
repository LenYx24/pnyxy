import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Bot,
  BookOpenCheck,
  Check,
  ChevronDown,
  HelpCircle,
  History,
  Image as ImageIcon,
  Mic,
  MicOff,
  Paperclip,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { FloatingMenu } from "@/components/ui";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useConfirm } from "@/hooks/use-confirm";
import { useIsMobile } from "@/hooks/use-media-query";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import type { RecommendationMode } from "@/lib/ai/recommendation-prompts";
import type { ChatMessageAttachment } from "@/types/chat";
import { ModelInfoModal } from "./ModelInfoModal";
import { cn } from "@/lib/cn";

// ── Constants ───────────────────────────────────────────────────
//
// Two attachment caps: Default mode (free Pnyxy quota) caps to 1
// image so per-message cost stays predictable on the budget side.
// Direct keys (Anthropic / OpenAI) — the user's own billing — go
// up to 4. 5 MB per image, image-only for v1.

const MAX_ATTACHMENTS_DIRECT = 4;
const MAX_ATTACHMENTS_DEFAULT = 1;
const MAX_ATTACHMENT_MB = 5;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * UI labels for each routing destination. Drives the model picker
 * dropdown's display text and routing-note subtitles. Hard-coded
 * here today and synced manually with the upstream calls in
 * ai-client.ts / ai-chat-proxy/index.ts.
 */
const PROVIDER_INFO: Record<
  AiProvider,
  { model: string; routing: string }
> = {
  pnyxy: { model: "Claude Haiku 4.5", routing: "Pnyxy free quota" },
  anthropic: { model: "Claude Sonnet 4.5", routing: "Your Anthropic key" },
  openai: { model: "GPT-4o mini", routing: "Your OpenAI key" },
  local: { model: "Local model", routing: "Ollama / LM Studio" },
};

// ── Internal helpers ────────────────────────────────────────────

/** Read a File as a base64 string (no `data:` prefix). FileReader
 *  is the safe path — naive Uint8Array→btoa breaks for files past
 *  the JS argument-count limit. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// ── ModelPicker ─────────────────────────────────────────────────

interface PnyxyQuotaRow {
  model: string;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

/**
 * Free-tier models the proxy can route to. Selecting one pins the
 * proxy to that single model instead of walking the auto-routing
 * chain — same shape `_ai_usage_limits_for_model` expects on the
 * SQL side. Kept inline here (not from AI_MODEL_CATALOG) because
 * the picker wants short labels + cost tiers, and the catalog is
 * Hungarian-prose-heavy.
 */
const PNYXY_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  costTier: "cheap" | "mid" | "premium";
  tagline: string;
}> = [
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    costTier: "cheap",
    tagline: "Cheapest · auto-route default",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    costTier: "cheap",
    tagline: "Fuller Flash · step-up from Lite",
  },
  {
    // Newest Google chat model — same family the gemini.google.com
    // webapp serves. Listed in the "mid" tier because the
    // per-token cost sits between the cheap default and the
    // premium Haiku 4.5 (≈$0.50 / $3.00 per MTok vs. Flash's
    // ≈$0.30 / $2.50). In auto-route mode the proxy still tries
    // 2.5 Flash first to keep the free quota cost predictable;
    // pin this option to use it explicitly.
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash (preview)",
    costTier: "mid",
    tagline: "Newest Google model · top casual chat",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    costTier: "mid",
    tagline: "General-purpose fallback",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    costTier: "premium",
    tagline: "Higher quality · used for quiz/roadmap",
  },
];

// ── QuotaBar ────────────────────────────────────────────────────

/** The model the auto-route chain bills first — shown as the quota
 *  reference when the user hasn't pinned a specific model. */
const QUOTA_AUTO_DEFAULT_MODEL = "gemini-2.5-flash-lite";

/**
 * Thin "how much of today's free-tier quota is left" meter, pinned
 * just above the textarea. Only meaningful on the Pnyxy proxy (BYOK
 * keys bill the user's own provider account, not our bucket) and only
 * for signed-in users — anon traffic uses an IP bucket the client
 * can't read. Tracks the *most-constrained* axis (tokens vs requests)
 * for the active model, and refetches whenever a stream finishes so
 * it reflects the turn that just completed.
 */
function QuotaBar({
  activeModel,
  isPinned,
  isStreaming,
}: {
  activeModel: string;
  /** Whether the user pinned this specific model (vs. auto-route). */
  isPinned: boolean;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<PnyxyQuotaRow[]>([]);

  const refresh = useCallback(() => {
    if (!user) return;
    void supabase.rpc("get_my_ai_usage_today").then(({ data, error }) => {
      if (!error && Array.isArray(data)) setRows(data as PnyxyQuotaRow[]);
    });
  }, [user]);

  // Fetch on mount / model change …
  useEffect(() => {
    refresh();
  }, [refresh]);
  // … and again each time a stream completes (true → false edge), so
  // the bar ticks up right after the response that consumed quota.
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) refresh();
    prevStreaming.current = isStreaming;
  }, [isStreaming, refresh]);

  if (!user) return null;
  const row = rows.find((r) => r.model === activeModel);
  if (!row) return null;

  const tokensRatio = row.tokens_limit ? row.tokens_used / row.tokens_limit : 0;
  const reqRatio = row.request_limit ? row.request_count / row.request_limit : 0;
  // The axis closer to its ceiling is the one the user will actually
  // hit first, so that's the one the bar reports.
  const onTokens = tokensRatio >= reqRatio;
  const used = onTokens ? row.tokens_used : row.request_count;
  const limit = onTokens ? row.tokens_limit : row.request_limit;
  const pct = Math.min(100, Math.round((onTokens ? tokensRatio : reqRatio) * 100));
  const nearLimit = pct >= 80;

  const unit = onTokens
    ? t("chat.composer.quota.tokens", { defaultValue: "tokens" })
    : t("chat.composer.quota.requests", { defaultValue: "requests" });

  return (
    <div
      className="mt-2 flex items-center gap-2 px-1"
      title={t("chat.composer.quota.tooltip", {
        defaultValue: isPinned
          ? "Today's free-tier {{unit}} used for {{model}}"
          : "Today's free-tier {{unit}} used — auto-route default ({{model}})",
        unit,
        model: activeModel,
      })}
    >
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-glass-bg">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            nearLimit ? "bg-danger/70" : "bg-accent/70",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 text-2xs tabular-nums",
          nearLimit ? "text-danger" : "text-text-muted",
        )}
      >
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  );
}

export function ModelPicker({
  value,
  options,
  onChange,
  label,
}: {
  /** null = "Default" (full fallback chain). A specific provider =
   *  strict pick — only that provider is tried, no fallback. */
  value: AiProvider | null;
  options: AiProvider[];
  onChange: (next: AiProvider | null) => void;
  /** Optional small-caps prefix ("MODEL: …"). Omitted in the
   *  composer panel-island so the dropdown stands on its own. */
  label?: string;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Free-tier model selection lives in the global settings store so
  // it survives reloads, but the picker reads/writes it directly —
  // it's UI state in a structural sense. When the user picks a
  // specific Pnyxy model the proxy pins that model instead of
  // walking its auto-routing chain.
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const setPnyxyModel = useSettingsStore((s) => s.setPnyxyModel);
  const pnyxyConfigured = useSettingsStore((s) =>
    s.enabledProviders.includes("pnyxy"),
  );

  // Per-model usage for the Default (Pnyxy free) option. Fetched
  // lazily on first dropdown open so we don't pay the RPC on every
  // composer mount. The user must be signed in — anon traffic uses
  // an IP-bucketed quota the client can't read.
  const user = useAuthStore((s) => s.user);
  const [quotaRows, setQuotaRows] = useState<PnyxyQuotaRow[]>([]);
  const [quotaLoaded, setQuotaLoaded] = useState(false);
  useEffect(() => {
    if (!open || quotaLoaded || !user) return;
    let cancelled = false;
    supabase.rpc("get_my_ai_usage_today").then(({ data, error }) => {
      if (cancelled) return;
      if (!error && Array.isArray(data)) {
        setQuotaRows(data as PnyxyQuotaRow[]);
      }
      setQuotaLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, quotaLoaded, user]);
  // Worst-case (most-constrained) model becomes the headline number
  // in the Default option's subtitle — that's the one the user is
  // about to hit if they keep chatting at the current rate. We
  // compute it from the higher of (tokens_used/tokens_limit) and
  // (request_count/request_limit) for each model.
  const quotaHeadline =
    quotaRows.length === 0
      ? null
      : quotaRows
          .map((r) => {
            const tokensRatio = r.tokens_limit
              ? r.tokens_used / r.tokens_limit
              : 0;
            const requestsRatio = r.request_limit
              ? r.request_count / r.request_limit
              : 0;
            return { row: r, ratio: Math.max(tokensRatio, requestsRatio) };
          })
          .reduce((a, b) => (a.ratio > b.ratio ? a : b));

  // Trigger label reflects whichever leaf the user is currently
  // pointing at: BYOK provider name → free-tier pinned model name →
  // generic "Default" if neither is in effect.
  const triggerLabel = value
    ? PROVIDER_INFO[value].model
    : pnyxyModel
      ? `Pnyxy: ${PNYXY_MODEL_OPTIONS.find((m) => m.id === pnyxyModel)?.label ?? pnyxyModel}`
      : t("chat.composer.modelDefault");

  return (
    <div className="flex min-w-0 items-center gap-1 text-2xs text-text-muted">
      {label && (
        <span className="font-medium uppercase tracking-wider">{label}</span>
      )}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/50 px-2 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <Bot size={12} className="shrink-0 text-accent/80" />
        <span className="truncate max-w-[100px] sm:max-w-none">
          {triggerLabel}
        </span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <button
        type="button"
        onClick={() => setInfoOpen(true)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        title={t("chat.composer.modelHelp", {
          defaultValue: "Modellek leírása",
        })}
        aria-label={t("chat.composer.modelHelp", {
          defaultValue: "Modellek leírása",
        })}
      >
        <HelpCircle size={14} />
      </button>
      <ModelInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
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
            <div className="my-0.5 h-px bg-glass-border" />
            {PNYXY_MODEL_OPTIONS.map((m) => {
              // Match the per-model row to its usage bucket from the
              // RPC we already fetch. Surfaces the same "tokens
              // used today" headline as Default, scoped to that
              // model so the user sees its specific quota.
              const row = quotaRows.find((q) => q.model === m.id);
              const headline = row
                ? {
                    row,
                    ratio: Math.max(
                      row.tokens_limit
                        ? row.tokens_used / row.tokens_limit
                        : 0,
                      row.request_limit
                        ? row.request_count / row.request_limit
                        : 0,
                    ),
                  }
                : null;
              return (
                <ModelOption
                  key={m.id}
                  active={value === null && pnyxyModel === m.id}
                  label={`Pnyxy: ${m.label}`}
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
          <div className="my-0.5 h-px bg-glass-border" />
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
      </FloatingMenu>
    </div>
  );
}

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
  /** Optional small "model X/Y today" line for the Pnyxy free
   *  option. Color escalates from default → amber (>50% used) →
   *  red (>80% used) so the user has a glanceable warning before
   *  they smack into the hard cap mid-sentence. */
  quotaHeadline?: {
    row: PnyxyQuotaRow;
    ratio: number;
  } | null;
  onClick: () => void;
}) {
  const quotaColor =
    quotaHeadline == null
      ? "text-text-muted"
      : quotaHeadline.ratio > 0.8
        ? "text-danger"
        : quotaHeadline.ratio > 0.5
          ? "text-warning"
          : "text-text-muted";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-glass-hover cursor-pointer",
        active
          ? "text-accent"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "text-2xs",
            active ? "text-accent/70" : "text-text-muted",
          )}
        >
          {subtitle}
        </span>
        {quotaHeadline && (
          <span className={cn("text-2xs font-mono", quotaColor)}>
            {quotaHeadline.row.tokens_used.toLocaleString()}/
            {quotaHeadline.row.tokens_limit.toLocaleString()} tok ·{" "}
            {quotaHeadline.row.request_count}/
            {quotaHeadline.row.request_limit} req
          </span>
        )}
      </span>
      {active && <Check size={12} className="mt-0.5 shrink-0" />}
    </button>
  );
}

// ── ModePicker (recommendation modes) ────────────────────────────

function ModePicker({
  value,
  onChange,
}: {
  value: RecommendationMode;
  onChange: (next: RecommendationMode) => void;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const labels: Record<RecommendationMode, string> = {
    default: t("chat.composer.modeDefault", { defaultValue: "Chat" }),
    books: t("chat.composer.modeBooks", { defaultValue: "Recommend books" }),
    videos: t("chat.composer.modeVideos", {
      defaultValue: "Recommend videos",
    }),
    image: t("chat.composer.modeImage", { defaultValue: "Generate image" }),
  };
  const subtitles: Record<RecommendationMode, string> = {
    default: t("chat.composer.modeDefaultSubtitle", {
      defaultValue: "Regular chat with the AI",
    }),
    books: t("chat.composer.modeBooksSubtitle", {
      defaultValue: "AI suggests books on a topic",
    }),
    videos: t("chat.composer.modeVideosSubtitle", {
      defaultValue: "AI suggests videos, courses, and guides on a topic",
    }),
    image: t("chat.composer.modeImageSubtitle", {
      defaultValue: "AI generates an image from your prompt (OpenAI key)",
    }),
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-2xs text-text-muted">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors cursor-pointer",
          value === "default"
            ? "border-glass-border bg-bg-primary/50 text-text-secondary hover:bg-glass-hover hover:text-text-primary"
            : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/20",
        )}
      >
        <Sparkles size={12} className="shrink-0" />
        <span className="truncate max-w-[80px] sm:max-w-none">
          {labels[value]}
        </span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="w-72"
      >
        {(["default", "books", "videos", "image"] as const).map((m) => (
          <ModelOption
            key={m}
            active={value === m}
            label={labels[m]}
            subtitle={subtitles[m]}
            onClick={() => {
              onChange(m);
              setOpen(false);
            }}
          />
        ))}
      </FloatingMenu>
    </div>
  );
}

// ── AttachmentCard ──────────────────────────────────────────────

function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: ChatMessageAttachment;
  onRemove: () => void;
}) {
  const dataUri = `data:${attachment.media_type};base64,${attachment.data}`;
  return (
    <div
      className="group relative flex h-12 items-center gap-2 rounded-md border border-glass-border bg-glass-bg/60 pl-1.5 pr-7"
      title={attachment.name ?? attachment.kind}
    >
      {attachment.kind === "image" ? (
        <img
          src={dataUri}
          alt={attachment.name ?? "attachment"}
          className="h-9 w-9 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-bg-primary text-text-muted">
          <ImageIcon size={14} />
        </div>
      )}
      {attachment.name && (
        <span className="max-w-[10rem] truncate text-2xs text-text-secondary">
          {attachment.name}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute right-1 top-1 rounded-full bg-bg-primary/80 p-0.5 text-text-muted transition-colors hover:bg-bg-primary hover:text-text-primary cursor-pointer"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── ChatComposer ────────────────────────────────────────────────

export interface ChatComposerSubmitPayload {
  text: string;
  provider: AiProvider | null;
  mode: RecommendationMode;
  attachments: ChatMessageAttachment[];
  /** Reasoning mode — when true the parent passes this to
   *  sendMessage's options.reasoning, which forwards to ai-client's
   *  StreamOptions. Today only the OpenAI BYOK path honors it
   *  (swaps gpt-4o-mini → o3-mini). Composer's toggle is hidden
   *  unless OpenAI is among the user's configured providers. */
  reasoning: boolean;
}

/**
 * Imperative handle exposed via `forwardRef` so external surfaces
 * (e.g. ReaderPage's rect-to-AI flow) can drop attachments into
 * the composer without lifting state. Use `useRef<ChatComposerHandle>`
 * on the parent + pass as `ref`.
 */
export interface ChatComposerHandle {
  addAttachments: (atts: ChatMessageAttachment[]) => void;
}

interface ChatComposerProps {
  /** Controlled input value. Parent owns it so it can pre-fill
   *  (reader→chat handoff) or clear externally. */
  value: string;
  onChange: (next: string) => void;
  /** Called when the user presses Send / Enter. Parent does the
   *  actual chat-store dispatch. Composer clears attachments and
   *  resets `mode` to "default" after this resolves. */
  onSubmit: (payload: ChatComposerSubmitPayload) => Promise<void>;
  /** Streaming state from the chat store. When true, the send
   *  button morphs into a stop button. */
  isStreaming: boolean;
  onStop: () => void;
  /** Optional reading-context loader. When provided, the History
   *  button + dropdown render and call this. Returns the formatted
   *  prompt text to prepend to the input. Omit on surfaces where
   *  reading context is implicit (e.g. the reader panel). */
  onLoadReadingContext?: (mode: "week" | "all") => Promise<string>;
  /** Override the textarea placeholder. Defaults to
   *  `chat.composerPlaceholder` i18n key. */
  placeholderKey?: string;
  /** When true, drops the side + bottom borders and the bottom
   *  rounded corners on mobile so the composer sits flush against
   *  the screen edges. The top corners stay rounded so it still
   *  reads as its own surface. Desktop falls back to the regular
   *  panel-island styling. Used by the standalone /chat page; the
   *  reader-side AI panel keeps the all-around card because it's
   *  already nested in a narrow side panel with its own chrome. */
  edgeToEdgeOnMobile?: boolean;
}

export const ChatComposer = forwardRef<
  ChatComposerHandle,
  ChatComposerProps
>(function ChatComposer(
  {
    value,
    onChange,
    onSubmit,
    isStreaming,
    onStop,
    onLoadReadingContext,
    placeholderKey = "chat.composerPlaceholder",
    edgeToEdgeOnMobile = false,
  },
  ref,
) {
  const { t } = useTranslation();
  const { confirm, ConfirmModalElement } = useConfirm();
  // Drives the textarea's Enter behavior. On desktop Enter sends and
  // Shift+Enter inserts a newline — the standard chat-app shortcut.
  // On mobile the soft-keyboard return key is the only quick way to
  // get a newline, so we flip it: Enter inserts a newline, the on-
  // screen send button (and Ctrl/Cmd+Enter for external keyboards)
  // sends. Without this, mobile users can't write multi-line prompts.
  const isMobile = useIsMobile();

  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    // configuration changes when settings change — re-evaluate.
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );

  // "Use whole book" shortcut. Only surfaces when a reader doc is
  // currently active — i.e. the composer is rendered from the reader
  // AI panel or from a chat conversation that already opened the
  // book. The standalone /chat page without an active doc never sees
  // the button. The flow is: click → confirm modal (warns about
  // token cost) → on accept, the doc's full page set goes into
  // aiSelectedPages so the next send picks them up via the existing
  // context-pack pipeline.
  const activeDoc = useActiveDocument();
  const selectAllAiPages = useReaderStore((s) => s.selectAllAiPages);
  const allPagesAlreadySelected =
    !!activeDoc &&
    activeDoc.totalPages > 0 &&
    activeDoc.aiSelectedPages.size === activeDoc.totalPages;
  const handleSelectWholeBook = useCallback(async () => {
    if (!activeDoc || activeDoc.totalPages <= 0) return;
    const ok = await confirm({
      title: t("chat.composer.wholeBook.confirmTitle", {
        defaultValue: "Send the whole book?",
      }),
      body: t("chat.composer.wholeBook.confirmBody", {
        defaultValue:
          "All {{count}} pages of this document will be attached to the next message. Large books eat through your daily AI quota fast — review the selection in the TOC if unsure.",
        count: activeDoc.totalPages,
      }),
      confirmLabel: t("chat.composer.wholeBook.confirmLabel", {
        defaultValue: "Select all pages",
      }),
    });
    if (!ok) return;
    selectAllAiPages();
  }, [activeDoc, confirm, selectAllAiPages, t]);

  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(
    null,
  );
  // If the picked provider gets disabled in Settings, fall back
  // to "Default" so the next send doesn't error.
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  const [mode, setMode] = useState<RecommendationMode>("default");

  // Quota bar: only relevant when the turn will be billed against our
  // Pnyxy free-tier bucket — i.e. the routing is "Default" (null →
  // full proxy chain) or the proxy is explicitly picked, AND the proxy
  // is configured. A specific BYOK provider bills the user's own
  // account, so the bar is hidden there. The reference model is the
  // pinned one, or the auto-route default the chain charges first.
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const usesPnyxyQuota =
    (selectedProvider === null || selectedProvider === "pnyxy") &&
    configuredProviders.includes("pnyxy");
  const activeQuotaModel = pnyxyModel ?? QUOTA_AUTO_DEFAULT_MODEL;

  // Reasoning toggle. Persistent within the composer's lifetime
  // (not auto-reset after send, unlike `mode`) so multi-turn
  // problem-solving stays in o3-mini mode without the user
  // re-clicking each turn. Only meaningful when OpenAI is one of
  // the configured providers — otherwise the toggle would have
  // nowhere to route. The toggle's visibility is gated on that
  // check below.
  const [reasoning, setReasoning] = useState(false);
  const openAiConfigured = configuredProviders.includes("openai");
  // If the user disables OpenAI in Settings while reasoning is on,
  // drop the flag silently — otherwise the next send would force
  // an unconfigured provider and bounce.
  useEffect(() => {
    if (!openAiConfigured && reasoning) setReasoning(false);
  }, [openAiConfigured, reasoning]);

  // Effective cap depends on routing. Default mode = Pnyxy free
  // quota = 1 image (cost predictability). Direct keys = 4.
  const effectiveAttachmentCap =
    selectedProvider === null
      ? MAX_ATTACHMENTS_DEFAULT
      : MAX_ATTACHMENTS_DIRECT;

  const [pendingAttachments, setPendingAttachments] = useState<
    ChatMessageAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Persistent hint when the user has more images staged than the
  // current routing supports — separate from the transient
  // `attachmentError` so it doesn't disappear on the next state
  // change.
  const attachmentsBlocked =
    selectedProvider === null &&
    pendingAttachments.length > MAX_ATTACHMENTS_DEFAULT;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readingContextBtnRef = useRef<HTMLButtonElement>(null);
  const [readingMenuOpen, setReadingMenuOpen] = useState(false);

  const handleAddFiles = useCallback(
    async (files: FileList | File[]) => {
      setAttachmentError(null);
      const incoming: ChatMessageAttachment[] = [];
      for (const file of Array.from(files)) {
        if (
          incoming.length + pendingAttachments.length >=
          effectiveAttachmentCap
        ) {
          setAttachmentError(
            t("chat.composer.attachments.tooMany", {
              max: effectiveAttachmentCap,
            }),
          );
          break;
        }
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
          setAttachmentError(t("chat.composer.attachments.unsupported"));
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setAttachmentError(
            t("chat.composer.attachments.tooLarge", { mb: MAX_ATTACHMENT_MB }),
          );
          continue;
        }
        try {
          const data = await fileToBase64(file);
          incoming.push({
            kind: "image",
            media_type: file.type,
            data,
            name: file.name,
          });
        } catch {
          setAttachmentError(t("chat.composer.attachments.readError"));
        }
      }
      if (incoming.length > 0) {
        setPendingAttachments((prev) => [...prev, ...incoming]);
      }
    },
    [pendingAttachments.length, effectiveAttachmentCap, t],
  );

  const removeAttachment = useCallback((idx: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
    setAttachmentError(null);
  }, []);

  // Imperative addAttachments — used by ReaderPage's rect-to-AI
  // flow to inject a captured page region into the chat composer.
  // Bypasses the size/type validation in `handleAddFiles` because
  // the caller has already produced a well-formed in-memory PNG;
  // no user file picked, no risk of an unsupported MIME.
  useImperativeHandle(
    ref,
    () => ({
      addAttachments: (atts) => {
        if (atts.length === 0) return;
        setPendingAttachments((prev) => [...prev, ...atts]);
        setAttachmentError(null);
      },
    }),
    [],
  );

  // Paste handler — pull image items from clipboard and route them
  // through the same validation/encoding path as the file picker.
  // Doesn't preventDefault when there are no images, so plain text
  // pastes still flow into the textarea normally.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f && f.type.startsWith("image/")) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void handleAddFiles(files);
      }
    },
    [handleAddFiles],
  );

  // Speech-to-text — appends finalized chunks to the textarea.
  const speech = useSpeechRecognition({
    onResult: (text) => {
      onChange(
        value
          ? value + (value.endsWith(" ") ? "" : " ") + text.trim()
          : text.trim(),
      );
    },
  });

  // Textarea auto-resize. Snap to scrollHeight (capped at 12rem)
  // before paint so the user never sees a height jitter.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const max = 12 * 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  const handleInsertReadingContext = useCallback(
    async (windowMode: "week" | "all") => {
      if (!onLoadReadingContext) return;
      setReadingMenuOpen(false);
      const prompt = await onLoadReadingContext(windowMode);
      if (!prompt) return;
      onChange(value ? `${value}\n\n${prompt}` : prompt);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      });
    },
    // We deliberately read `value` lazily from the closure each
    // call rather than as a dep — the latest closure always wins
    // because the handler is recreated on every render via the
    // useCallback's empty-ish dep list. We DO depend on value here
    // for correctness on the inner concat:
    [onChange, onLoadReadingContext, value],
  );

  const handleSendClick = useCallback(async () => {
    const text = value.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (attachmentsBlocked) return;
    // When reasoning is on, force-route through OpenAI BYOK — other
    // providers don't have a step-by-step reasoning model on tap and
    // would silently ignore the flag. Falling back to the user's
    // own preference when reasoning is off keeps the model picker's
    // normal behavior.
    const effectiveProvider = reasoning ? "openai" : selectedProvider;
    const payload: ChatComposerSubmitPayload = {
      text,
      provider: effectiveProvider,
      mode,
      attachments: pendingAttachments,
      reasoning,
    };
    // Clear staged attachments + reset per-turn mode before the
    // await so a slow send doesn't leave them visually stuck. The
    // input value is parent-controlled — parent clears on its own.
    setPendingAttachments([]);
    setAttachmentError(null);
    if (mode !== "default") setMode("default");
    await onSubmit(payload);
  }, [
    value,
    pendingAttachments,
    attachmentsBlocked,
    selectedProvider,
    mode,
    reasoning,
    onSubmit,
  ]);

  const canSend =
    !attachmentsBlocked &&
    (value.trim().length > 0 || pendingAttachments.length > 0);

  return (
    <div
      className={cn(
        "border bg-bg-tertiary p-2 shadow-md transition-colors sm:p-3",
        // Mobile-flush variant: negative horizontal margin breaks
        // out of the parent's px-3 so the composer extends to the
        // viewport edges, side + bottom borders are dropped, and
        // only the top corners stay rounded so it still reads as
        // its own surface above the thread. Desktop reverts to the
        // all-around panel-island with normal margins.
        edgeToEdgeOnMobile
          ? "-mx-3 rounded-t-2xl border-x-0 border-b-0 sm:mx-0 sm:rounded-2xl sm:border-x sm:border-b"
          : "rounded-2xl",
        speech.listening
          ? "border-accent ring-2 ring-accent/30"
          : "border-glass-border focus-within:border-accent/60",
      )}
    >
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((att, idx) => (
            <AttachmentCard
              key={idx}
              attachment={att}
              onRemove={() => removeAttachment(idx)}
            />
          ))}
        </div>
      )}
      {attachmentError && (
        <p role="alert" className="mb-2 text-2xs text-danger">
          {attachmentError}
        </p>
      )}
      {attachmentsBlocked && !attachmentError && (
        <p className="mb-2 text-2xs text-warning">
          {t("chat.composer.attachments.needVisionModel")}
        </p>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // IME composition guard. While the user is mid-composition
          // (CJK, Hungarian dead-key accents, etc.) the soft keyboard
          // fires an Enter with `isComposing: true` to commit the
          // composition — that's not a send intent. keyCode 229 is
          // the legacy webview equivalent some Android browsers still
          // emit instead of the modern flag.
          if (
            (e.nativeEvent as KeyboardEvent).isComposing ||
            e.keyCode === 229
          ) {
            return;
          }
          // Mobile: Enter inserts a newline (browser default); only
          // Ctrl/Cmd+Enter sends. Desktop: Enter sends, Shift+Enter
          // inserts a newline.
          const sendIntent = isMobile
            ? e.ctrlKey || e.metaKey
            : !e.shiftKey;
          // While a response is streaming the user can keep typing
          // their next message, but Enter must not send: the store
          // streams one turn at a time and the action button is in
          // "Stop" mode. The send fires once the stream finishes.
          if (sendIntent && !isStreaming) {
            e.preventDefault();
            void handleSendClick();
          }
        }}
        placeholder={
          speech.listening
            ? t("chat.composer.listeningPlaceholder")
            : t(placeholderKey)
        }
        rows={1}
        className="block min-h-[2.25rem] w-full resize-none bg-transparent px-1 text-sm text-text-primary placeholder:text-text-muted outline-none sm:min-h-[3rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleAddFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* Toolbar — single row when the composer is wide, two stacked
          rows when narrow (small reader chat panel, mobile). The
          @container query measures the composer's parent so the
          layout switches based on its actual rendered width, not the
          viewport — Dockview can give the panel any size independent
          of screen. Threshold sits at 30rem (480px): phone portrait
          (~360–420px) always falls below, tablet-portrait and up
          stay single-row. Inner divs use `@[30rem]/cm:contents` to
          flatten back into a single flex row above the threshold;
          below, they stay as nested flex containers stacked by
          `flex-col`. */}
      <div className="@container/cm mt-1.5 sm:mt-2">
      <div className="flex flex-col gap-1.5 @[30rem]/cm:flex-row @[30rem]/cm:items-center">
      <div className="flex min-w-0 items-center gap-1.5 @[30rem]/cm:contents">
        <ModelPicker
          value={selectedProvider}
          options={configuredProviders}
          onChange={setSelectedProvider}
        />
        <ModePicker value={mode} onChange={setMode} />
      </div>
      <div className="flex items-center gap-1.5 @[30rem]/cm:contents">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={
            isStreaming || pendingAttachments.length >= effectiveAttachmentCap
          }
          title={t("chat.composer.attachments.add")}
          aria-label={t("chat.composer.attachments.add")}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-glass-border bg-bg-primary/50 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip size={14} />
        </button>
        {activeDoc && activeDoc.totalPages > 0 && (
          <button
            type="button"
            onClick={() => void handleSelectWholeBook()}
            disabled={isStreaming}
            title={t("chat.composer.wholeBook.button", {
              defaultValue: "Use the whole book as context",
            })}
            aria-label={t("chat.composer.wholeBook.button", {
              defaultValue: "Use the whole book as context",
            })}
            aria-pressed={allPagesAlreadySelected}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
              allPagesAlreadySelected
                ? "border-text-muted/40 bg-glass-bg text-text-primary"
                : "border-glass-border bg-bg-primary/50 text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <BookOpenCheck size={14} />
          </button>
        )}
        {openAiConfigured && (
          <button
            type="button"
            onClick={() => setReasoning((r) => !r)}
            disabled={isStreaming}
            aria-pressed={reasoning}
            title={t("chat.composer.reasoning.button", {
              defaultValue:
                "Reasoning mode — routes through OpenAI o3-mini for step-by-step math and logic. Slower and ~7× the per-token cost of GPT-4o-mini.",
            })}
            aria-label={t("chat.composer.reasoning.button", {
              defaultValue: "Reasoning mode",
            })}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
              reasoning
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-glass-border bg-bg-primary/50 text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <Sparkles size={14} />
          </button>
        )}
        {onLoadReadingContext && (
          <>
            <button
              ref={readingContextBtnRef}
              onClick={() => setReadingMenuOpen((v) => !v)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-glass-border bg-bg-primary/50 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("chat.readingContext.title")}
              aria-label={t("chat.readingContext.button")}
            >
              <History size={14} />
            </button>
            <FloatingMenu
              open={readingMenuOpen}
              anchorRef={readingContextBtnRef}
              onClose={() => setReadingMenuOpen(false)}
              className="w-56"
            >
              <button
                onClick={() => void handleInsertReadingContext("week")}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <span className="font-medium">
                  {t("chat.readingContext.weekTitle")}
                </span>
                <span className="text-2xs text-text-muted">
                  {t("chat.readingContext.weekHint")}
                </span>
              </button>
              <button
                onClick={() => void handleInsertReadingContext("all")}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <span className="font-medium">
                  {t("chat.readingContext.recentTitle")}
                </span>
                <span className="text-2xs text-text-muted">
                  {t("chat.readingContext.recentHint")}
                </span>
              </button>
            </FloatingMenu>
          </>
        )}
        {speech.error && (
          <span className="ml-auto truncate text-2xs text-danger">
            {speech.error === "not-allowed"
              ? t("chat.composer.micDenied")
              : t("chat.composer.micError")}
          </span>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5",
            !speech.error && "ml-auto",
          )}
        >
          {speech.supported && (
            <button
              onClick={() =>
                speech.listening ? speech.stop() : speech.start()
              }
              disabled={isStreaming}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer",
                speech.listening
                  ? "border-danger/40 bg-danger/20 text-danger hover:bg-danger/30"
                  : "border-glass-border bg-bg-primary/50 text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              aria-label={
                speech.listening
                  ? t("chat.composer.stopListening")
                  : t("chat.composer.startListening")
              }
              title={
                speech.listening
                  ? t("chat.composer.stopListening")
                  : t("chat.composer.startListening")
              }
            >
              {speech.listening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
          )}
          <button
            onClick={() => {
              if (isStreaming) {
                onStop();
              } else {
                void handleSendClick();
              }
            }}
            disabled={!isStreaming && !canSend}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer",
              isStreaming || canSend
                ? "bg-accent text-white hover:bg-accent/80"
                : "bg-glass-bg text-text-muted disabled:cursor-not-allowed",
            )}
            aria-label={isStreaming ? t("chat.stop") : t("chat.send")}
            title={isStreaming ? t("chat.stop") : t("chat.send")}
          >
            {isStreaming ? (
              <Square size={12} fill="currentColor" />
            ) : (
              <ArrowUp size={16} strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>
      </div>
      </div>
      {usesPnyxyQuota && (
        <QuotaBar
          activeModel={activeQuotaModel}
          isPinned={pnyxyModel !== null}
          isStreaming={isStreaming}
        />
      )}
      {ConfirmModalElement}
    </div>
  );
});
