import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Bot,
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
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { getConfiguredProviders } from "@/lib/ai-client";
import type { RecommendationMode } from "@/lib/recommendation-prompts";
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

  const triggerLabel = value
    ? PROVIDER_INFO[value].model
    : t("chat.composer.modelDefault");

  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] text-text-muted">
      {label && (
        <span className="font-medium uppercase tracking-wider">{label}</span>
      )}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/50 px-2 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <Bot size={12} className="shrink-0 text-accent-purple/80" />
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
          active={value === null}
          label={t("chat.composer.modelDefault")}
          subtitle={t("chat.composer.modelDefaultSubtitle")}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        />
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
  onClick,
}: {
  active: boolean;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-glass-hover cursor-pointer",
        active
          ? "text-accent-purple"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "text-[10px]",
            active ? "text-accent-purple/70" : "text-text-muted",
          )}
        >
          {subtitle}
        </span>
      </span>
      {active && <Check size={12} className="mt-0.5" />}
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
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors cursor-pointer",
          value === "default"
            ? "border-glass-border bg-bg-primary/50 text-text-secondary hover:bg-glass-hover hover:text-text-primary"
            : "border-accent-purple/40 bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/20",
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
        <span className="max-w-[10rem] truncate text-[11px] text-text-secondary">
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
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  isStreaming,
  onStop,
  onLoadReadingContext,
  placeholderKey = "chat.composerPlaceholder",
}: ChatComposerProps) {
  const { t } = useTranslation();

  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    // configuration changes when settings change — re-evaluate.
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );

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
    const payload: ChatComposerSubmitPayload = {
      text,
      provider: selectedProvider,
      mode,
      attachments: pendingAttachments,
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
    onSubmit,
  ]);

  const canSend =
    !attachmentsBlocked &&
    (value.trim().length > 0 || pendingAttachments.length > 0);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-bg-tertiary p-3 shadow-md transition-colors",
        speech.listening
          ? "border-accent-purple ring-2 ring-accent-purple/30"
          : "border-glass-border focus-within:border-accent-purple/60",
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
        <p role="alert" className="mb-2 text-[11px] text-red-400">
          {attachmentError}
        </p>
      )}
      {attachmentsBlocked && !attachmentError && (
        <p className="mb-2 text-[11px] text-amber-400">
          {t("chat.composer.attachments.needVisionModel")}
        </p>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSendClick();
          }
        }}
        placeholder={
          speech.listening
            ? t("chat.composer.listeningPlaceholder")
            : t(placeholderKey)
        }
        rows={2}
        className="block min-h-[3rem] w-full resize-none bg-transparent px-1 text-sm text-text-primary placeholder:text-text-muted outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        disabled={isStreaming}
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
      {/* Single toolbar row — no flex-wrap so it never splits into
          two visual rows on narrow phones. */}
      <div className="mt-2 flex items-center gap-1.5">
        <ModelPicker
          value={selectedProvider}
          options={configuredProviders}
          onChange={setSelectedProvider}
        />
        <ModePicker value={mode} onChange={setMode} />
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
                <span className="text-[11px] text-text-muted">
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
                <span className="text-[11px] text-text-muted">
                  {t("chat.readingContext.recentHint")}
                </span>
              </button>
            </FloatingMenu>
          </>
        )}
        {speech.error && (
          <span className="ml-auto truncate text-[11px] text-red-400">
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
                  ? "border-red-500/40 bg-red-500/20 text-red-400 hover:bg-red-500/30"
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
                ? "bg-accent-purple text-white hover:bg-accent-purple/80"
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
  );
}
