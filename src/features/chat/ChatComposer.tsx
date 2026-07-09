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
  Plus,
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
import { useChatStore } from "@/stores/chat-store";
import { supabase } from "@/lib/supabase";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import type { RecommendationMode } from "@/lib/ai/recommendation-prompts";
import type { ChatMessageAttachment } from "@/types/chat";
import { ModelInfoModal } from "./ModelInfoModal";
import { cn } from "@/lib/cn";

// Default (free quota) caps to 1 image for predictable cost; BYOK keys allow 4.
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

// keep in sync with ai-client.ts / ai-chat-proxy
const PROVIDER_INFO: Record<
  AiProvider,
  { model: string; routing: string }
> = {
  pnyxy: { model: "Claude Haiku 4.5", routing: "Pnyxy free quota" },
  anthropic: { model: "Claude Sonnet 4.5", routing: "Your Anthropic key" },
  openai: { model: "GPT-4o mini", routing: "Your OpenAI key" },
  local: { model: "Local model", routing: "Ollama / LM Studio" },
};

// Read a File as base64 (no `data:` prefix). Uint8Array→btoa breaks past the arg-count limit.
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

interface PnyxyQuotaRow {
  model: string;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

// Free-tier models. Picking one pins the proxy to it instead of auto-routing.
// ids must match `_ai_usage_limits_for_model` on the SQL side.
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
    // mid tier: auto-route still prefers 2.5 Flash, pin this to force it
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

// Quota reference model when nothing is pinned (the model the auto-route bills
// first). Reader Q&A (a doc is open → grounding off) bills flash-lite; standalone
// chat (no doc → web grounding on) bills gemini-3-flash-preview. The bar has to
// read whichever row the proxy actually records or it sits permanently at 0 —
// which is exactly why it looked "broken" on the standalone chat page.
const QUOTA_AUTO_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const QUOTA_AUTO_GROUNDED_MODEL = "gemini-3-flash-preview";

// Free-tier quota meter. Signed-in only (anon uses an IP bucket we can't read).
// Reports the most-constrained axis, tokens vs requests.
function QuotaBar({
  activeModel,
  isPinned,
  isStreaming,
}: {
  activeModel: string;
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

  useEffect(() => {
    refresh();
  }, [refresh]);
  // refetch when streaming ends so the bar reflects the last turn
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
  // Report whichever axis is closer to its ceiling.
  const onTokens = tokensRatio >= reqRatio;
  const used = onTokens ? row.tokens_used : row.request_count;
  const limit = onTokens ? row.tokens_limit : row.request_limit;
  const pct = Math.min(100, Math.round((onTokens ? tokensRatio : reqRatio) * 100));
  const nearLimit = pct >= 80;
  // With large free-tier ceilings the true fill can round to <1% and vanish;
  // give any non-zero usage a visible sliver so the bar never looks broken.
  const barWidth = used > 0 ? Math.max(pct, 4) : 0;

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
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-text-muted/15">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            nearLimit ? "bg-danger" : "bg-accent",
          )}
          style={{ width: `${barWidth}%` }}
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
  compact = false,
}: {
  /** null = Default (full fallback chain). A provider = strict pick, no fallback. */
  value: AiProvider | null;
  options: AiProvider[];
  onChange: (next: AiProvider | null) => void;
  label?: string;
  /** Icon-only square trigger (mobile), no label / chevron / help button. */
  compact?: boolean;
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

  // Per-model usage, fetched lazily on first dropdown open. Signed-in only.
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
  // Most-constrained model (higher of the tokens/requests ratios) headlines the Default subtitle.
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

  // BYOK provider name → pinned free-tier model → "Default".
  const triggerLabel = value
    ? PROVIDER_INFO[value].model
    : pnyxyModel
      ? `Pnyxy: ${PNYXY_MODEL_OPTIONS.find((m) => m.id === pnyxyModel)?.label ?? pnyxyModel}`
      : t("chat.composer.modelDefault");

  return (
    <div className="flex min-w-0 items-center gap-1 text-2xs text-text-muted">
      {label && !compact && (
        <span className="font-medium uppercase tracking-wider">{label}</span>
      )}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-glass-border bg-bg-primary/50 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            : "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/50 px-2 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        }
        title={compact ? triggerLabel : undefined}
        aria-label={compact ? triggerLabel : undefined}
      >
        <Bot size={compact ? 18 : 12} className="shrink-0 text-accent/80" />
        {!compact && (
          <>
            <span className="truncate max-w-[100px] sm:max-w-none">
              {triggerLabel}
            </span>
            <ChevronDown size={11} className="shrink-0" />
          </>
        )}
      </button>
      {!compact && (
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
      )}
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
  /** Optional "X/Y today" usage line; color escalates amber >50%, red >80%. */
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

function ModePicker({
  value,
  onChange,
  allowImage,
}: {
  value: RecommendationMode;
  onChange: (next: RecommendationMode) => void;
  /** Hide the "Generate image" option when no OpenAI key is configured. */
  allowImage: boolean;
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
        {(allowImage
          ? (["default", "books", "videos", "image"] as const)
          : (["default", "books", "videos"] as const)
        ).map((m) => (
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

export interface ChatComposerSubmitPayload {
  text: string;
  provider: AiProvider | null;
  mode: RecommendationMode;
  attachments: ChatMessageAttachment[];
  /** Only the OpenAI BYOK path honors this (swaps gpt-4o-mini → o3-mini). */
  reasoning: boolean;
}

/** forwardRef handle letting external surfaces (e.g. reader rect-to-AI) drop in attachments. */
export interface ChatComposerHandle {
  addAttachments: (atts: ChatMessageAttachment[]) => void;
}

interface ChatComposerProps {
  /** Controlled input value, owned by the parent for pre-fill/clear. */
  value: string;
  onChange: (next: string) => void;
  /** Send/Enter handler. Composer clears attachments and resets mode to "default" after. */
  onSubmit: (payload: ChatComposerSubmitPayload) => Promise<void>;
  /** When true the send button becomes a stop button. */
  isStreaming: boolean;
  onStop: () => void;
  /** When set, renders the History button; returns prompt text to prepend to the input. */
  onLoadReadingContext?: (mode: "week" | "all") => Promise<string>;
  /** Override the textarea placeholder i18n key. */
  placeholderKey?: string;
  /** Mobile-flush variant: drops side/bottom borders so the composer meets the screen edges. */
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
  // On mobile, Enter inserts a newline and the send button sends; desktop is the inverse.
  const isMobile = useIsMobile();

  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    // re-evaluate when provider settings change.
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );

  // "Use whole book": only shown with an active reader doc. Confirm modal → selectAllAiPages.
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
  // Fall back to Default if the picked provider gets disabled in Settings.
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  const [mode, setMode] = useState<RecommendationMode>("default");
  // mobile "+" secondary-actions menu (attach / whole-book / reasoning / mode / usage)
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  // Quota bar only applies when the turn bills the Pnyxy bucket (Default or proxy picked).
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const usesPnyxyQuota =
    (selectedProvider === null || selectedProvider === "pnyxy") &&
    configuredProviders.includes("pnyxy");
  // Predict the billed model the SAME way the proxy routes it. Grounding
  // (web search → gemini-3) is on only when the turn carries NO document
  // context — and the proxy keys that off the active conversation's
  // source_doc_title, NOT the reader's open doc. Mirror that signal so
  // the bar tracks the bucket the proxy actually records; fall back to
  // the reader doc only when there's no conversation yet (a fresh
  // reader-panel chat will attach the doc).
  const convHasDoc = useChatStore((s) => {
    if (!s.activeConversationId) return undefined;
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    return conv ? !!conv.source_doc_title : undefined;
  });
  const turnHasDoc = convHasDoc ?? !!activeDoc;
  const activeQuotaModel =
    pnyxyModel ??
    (turnHasDoc ? QUOTA_AUTO_DEFAULT_MODEL : QUOTA_AUTO_GROUNDED_MODEL);

  // Reasoning toggle persists across sends (unlike `mode`). Only routes when OpenAI is configured.
  const [reasoning, setReasoning] = useState(false);
  const openAiConfigured = configuredProviders.includes("openai");
  // Drop the flag if OpenAI gets disabled while reasoning is on.
  useEffect(() => {
    if (!openAiConfigured && reasoning) setReasoning(false);
  }, [openAiConfigured, reasoning]);
  // Image generation needs an OpenAI key; fall back to Chat if it disappears.
  useEffect(() => {
    if (!openAiConfigured && mode === "image") setMode("default");
  }, [openAiConfigured, mode]);

  // Default routing caps at 1 image; BYOK keys allow 4.
  const effectiveAttachmentCap =
    selectedProvider === null
      ? MAX_ATTACHMENTS_DEFAULT
      : MAX_ATTACHMENTS_DIRECT;

  const [pendingAttachments, setPendingAttachments] = useState<
    ChatMessageAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // persistent hint (separate from the transient attachmentError) when over the cap
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

  // Skips handleAddFiles validation: caller supplies an already well-formed PNG.
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

  // Route pasted image items through handleAddFiles; leave plain-text pastes alone.
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

  // Speech-to-text: append finalized chunks to the textarea.
  const speech = useSpeechRecognition({
    onResult: (text) => {
      onChange(
        value
          ? value + (value.endsWith(" ") ? "" : " ") + text.trim()
          : text.trim(),
      );
    },
  });

  // Auto-resize to scrollHeight (capped 12rem) before paint to avoid jitter.
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
    // value is a dep so the concat below uses the latest input.
    [onChange, onLoadReadingContext, value],
  );

  const handleSendClick = useCallback(async () => {
    const text = value.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (attachmentsBlocked) return;
    // Reasoning must force OpenAI BYOK; other providers ignore the flag.
    const effectiveProvider = reasoning ? "openai" : selectedProvider;
    const payload: ChatComposerSubmitPayload = {
      text,
      provider: effectiveProvider,
      mode,
      attachments: pendingAttachments,
      reasoning,
    };
    // Clear attachments + reset mode before the await so a slow send doesn't leave them stuck.
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

  // shared row style for the mobile "+" actions menu
  const mobileMenuRow =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const modeLabels: Record<RecommendationMode, string> = {
    default: t("chat.composer.modeDefault", { defaultValue: "Chat" }),
    books: t("chat.composer.modeBooks", { defaultValue: "Recommend books" }),
    videos: t("chat.composer.modeVideos", { defaultValue: "Recommend videos" }),
    image: t("chat.composer.modeImage", { defaultValue: "Generate image" }),
  };

  return (
    <div
      className={cn(
        "border bg-bg-tertiary p-2 shadow-md transition-colors sm:p-3",
        // Mobile-flush: negative margin breaks out of the parent's px-3 to reach the viewport edge.
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
          // IME composition guard: mid-composition Enter commits, it's not a send.
          // keyCode 229 is the legacy equivalent some Android webviews still emit.
          if (
            (e.nativeEvent as KeyboardEvent).isComposing ||
            e.keyCode === 229
          ) {
            return;
          }
          // Mobile: Ctrl/Cmd+Enter sends. Desktop: Enter sends, Shift+Enter newline.
          const sendIntent = isMobile
            ? e.ctrlKey || e.metaKey
            : !e.shiftKey;
          // Enter must not send while streaming (one turn at a time).
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
        className="block min-h-[2.25rem] w-full resize-none bg-transparent px-1 text-base text-text-primary placeholder:text-text-muted outline-none sm:min-h-[3rem] sm:text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      {isMobile ? (
        /* Mobile: Gemini-style single row — "+" menu (attach + secondary
           actions) on the left, a compact model square + mic/send on the
           right. Everything else lives behind the "+" so the common case is
           just type-and-send. */
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            ref={plusBtnRef}
            type="button"
            onClick={() => setPlusMenuOpen((v) => !v)}
            disabled={isStreaming}
            aria-label={t("chat.composer.moreActions", { defaultValue: "More" })}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-glass-border bg-bg-primary/50 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={20} />
          </button>
          <FloatingMenu
            open={plusMenuOpen}
            anchorRef={plusBtnRef}
            onClose={() => setPlusMenuOpen(false)}
            className="w-64"
          >
            <button
              type="button"
              disabled={
                isStreaming ||
                pendingAttachments.length >= effectiveAttachmentCap
              }
              onClick={() => {
                setPlusMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className={mobileMenuRow}
            >
              <Paperclip size={16} />
              {t("chat.composer.attachments.add")}
            </button>
            {activeDoc && activeDoc.totalPages > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPlusMenuOpen(false);
                  void handleSelectWholeBook();
                }}
                className={mobileMenuRow}
              >
                <BookOpenCheck size={16} />
                {t("chat.composer.wholeBook.button", {
                  defaultValue: "Use the whole book as context",
                })}
                {allPagesAlreadySelected && (
                  <Check size={14} className="ml-auto shrink-0 text-accent" />
                )}
              </button>
            )}
            {openAiConfigured && (
              <button
                type="button"
                onClick={() => setReasoning((r) => !r)}
                className={mobileMenuRow}
              >
                <Sparkles
                  size={16}
                  className={reasoning ? "text-accent" : undefined}
                />
                {t("chat.composer.reasoning.label", {
                  defaultValue: "Reasoning mode",
                })}
                {reasoning && (
                  <Check size={14} className="ml-auto shrink-0 text-accent" />
                )}
              </button>
            )}
            {onLoadReadingContext && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    void handleInsertReadingContext("week");
                  }}
                  className={mobileMenuRow}
                >
                  <History size={16} />
                  {t("chat.readingContext.weekTitle")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    void handleInsertReadingContext("all");
                  }}
                  className={mobileMenuRow}
                >
                  <History size={16} />
                  {t("chat.readingContext.recentTitle")}
                </button>
              </>
            )}
            <div className="my-1 border-t border-glass-border" />
            <p className="px-3 pb-1 text-2xs font-medium uppercase tracking-wider text-text-muted">
              {t("chat.composer.modeLabel", { defaultValue: "Mode" })}
            </p>
            {(openAiConfigured
              ? (["default", "books", "videos", "image"] as const)
              : (["default", "books", "videos"] as const)
            ).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setPlusMenuOpen(false);
                }}
                className={mobileMenuRow}
              >
                <Sparkles
                  size={16}
                  className={
                    mode === m && m !== "default" ? "text-accent" : undefined
                  }
                />
                {modeLabels[m]}
                {mode === m && (
                  <Check size={14} className="ml-auto shrink-0 text-accent" />
                )}
              </button>
            ))}
            {usesPnyxyQuota && (
              <div className="border-t border-glass-border px-3 pb-2 pt-2">
                <QuotaBar
                  activeModel={activeQuotaModel}
                  isPinned={pnyxyModel !== null}
                  isStreaming={isStreaming}
                />
              </div>
            )}
          </FloatingMenu>

          <div className="min-w-0 flex-1" />

          <ModelPicker
            compact
            value={selectedProvider}
            options={configuredProviders}
            onChange={setSelectedProvider}
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent/80 cursor-pointer"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : canSend ? (
            <button
              type="button"
              onClick={() => void handleSendClick()}
              aria-label={t("chat.send")}
              title={t("chat.send")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent/80 cursor-pointer"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          ) : speech.supported ? (
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
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
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer",
                speech.listening
                  ? "border-danger/40 bg-danger/20 text-danger hover:bg-danger/30"
                  : "border-glass-border bg-bg-primary/50 text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          ) : (
            <button
              type="button"
              disabled
              aria-label={t("chat.send")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-glass-bg text-text-muted cursor-not-allowed"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      ) : (
        <>
      {/* Toolbar: one row when wide, two stacked rows below the 30rem @container
          threshold. Container width, not viewport, since Dockview sizes the panel freely. */}
      <div className="@container/cm mt-1.5 sm:mt-2">
      <div className="flex flex-col gap-1.5 @[30rem]/cm:flex-row @[30rem]/cm:items-center">
      <div className="flex min-w-0 items-center gap-1.5 @[30rem]/cm:contents">
        <ModelPicker
          value={selectedProvider}
          options={configuredProviders}
          onChange={setSelectedProvider}
        />
        <ModePicker
          value={mode}
          onChange={setMode}
          allowImage={openAiConfigured}
        />
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
        </>
      )}
      {ConfirmModalElement}
    </div>
  );
});
