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
  BookOpen,
  BookOpenCheck,
  Brain,
  Check,
  ChevronRight,
  Eye,
  Clapperboard,
  History,
  Image as ImageIcon,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  ScrollText,
  Sparkles,
  Square,
  X,
  FolderTree,
  Globe,
  Gauge,
} from "lucide-react";
import {
  FloatingMenu,
  IconButton,
  TypingIndicator,
  chipActiveClass,
  chipClass,
} from "@/components/ui";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useConfirm } from "@/hooks/use-confirm";
import { useIsMobile } from "@/hooks/use-media-query";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useChatStore, pathFromRoot, windowChatHistory } from "@/stores/chat-store";
import {
  AI_CONTEXT_DRAFT_CONVERSATION_KEY,
  useAiContextSessionStore,
} from "@/features/settings/ai-context/session-overrides";
import {
  buildSystemPrompt,
  estimateTokens,
  getConfiguredProviders,
} from "@/lib/ai/ai-client";
import { TEACHER_GUARDRAIL, TEACHER_MODE_ENABLED } from "@/lib/ai/teacher-mode";
import { resolveAiContextForConversation } from "@/features/settings/ai-context/resolve-runtime";
import type { RecommendationMode } from "@/lib/ai/recommendation-prompts";
import { matchChatCommands } from "@/lib/ai/chat-commands";
import { useFeatures } from "@/lib/use-features";
import type { ChatMessageAttachment } from "@/types/chat";
import { ContextInspectorModal } from "./ContextInspectorModal";
import { ModelPicker } from "./composer/ModelPicker";
import { useQuotaRows } from "./composer/model-meta";
import { AttachmentCard } from "./composer/AttachmentCard";
import { QuotaModal } from "./QuotaModal";
import { questionsLeft as computeQuestionsLeft, selectQuotaRow } from "./quota";
import { useServedModelStore } from "@/lib/ai/served-model";
import { cn } from "@/lib/cn";

// Same cap on every route; the proxy bills each image into the token bucket.
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_MB = 5;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Distinct icon per composer mode so the "Recommend …" rows don't read
// as duplicates of each other.
const MODE_ICONS: Record<RecommendationMode, typeof Sparkles> = {
  default: Sparkles,
  books: BookOpen,
  videos: Clapperboard,
  image: ImageIcon,
  library: FolderTree,
};

/** Compact token count for the context chip ("~6,2k"): comma decimal for
 *  Hungarian, dot otherwise, "k" from 1000 tokens up. */
function formatCompactTokens(tokens: number, locale: string): string {
  if (tokens < 1000) return String(tokens);
  const decimal = locale.startsWith("hu") ? "," : ".";
  return `${(tokens / 1000).toFixed(1).replace(".", decimal)}k`;
}

// Read a File as base64 (no `data:` prefix). Uint8Array->btoa breaks past the arg-count limit.
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

export interface ChatComposerSubmitPayload {
  text: string;
  provider: AiProvider | null;
  mode: RecommendationMode;
  attachments: ChatMessageAttachment[];
  /** Only the OpenAI BYOK path honors this (swaps gpt-4o-mini -> o3-mini). */
  reasoning: boolean;
  /** Web search for this turn: Gemini grounding on Pnyxy, Anthropic
   *  web_search tool, OpenAI search-preview model; local ignores it. */
  webSearch: boolean;
}

/** forwardRef handle letting external surfaces (e.g. reader rect-to-AI) drop in attachments. */
export interface ChatComposerHandle {
  addAttachments: (atts: ChatMessageAttachment[]) => void;
}

/** Source-document chip in the composer's bottom row (book + pages). */
export interface ChatComposerContextChip {
  label: string;
  /** Click on the chip: jump into the reader. */
  onOpen: () => void;
  /** The x: hide for this session. */
  onHide: () => void;
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
  /** When set, renders the reading-context entries in the "+" menu; returns prompt text to prepend to the input. */
  onLoadReadingContext?: (mode: "week" | "all") => Promise<string>;
  /** Override the textarea placeholder i18n key. */
  placeholderKey?: string;
  /** Mobile-flush variant: drops the bottom corners so the composer meets the screen edge. */
  edgeToEdgeOnMobile?: boolean;
  /** Source-document chip (book + pages) at the left of the bottom row. */
  contextChip?: ChatComposerContextChip | null;
  /** Dropped/picked PDF handler: upload to the library + open a doc-scoped
   *  conversation. When unset, PDFs are rejected as unsupported. */
  onAttachPdf?: (file: File) => Promise<void>;
  /** Narrow hosts (browser-extension side panel): no quota line, no
   *  context-token chip, no model picker in the bottom row; the "+" menu
   *  keeps mode / reasoning / web search. */
  compact?: boolean;
}

const menuRowClass =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    {
      value: valueProp,
      onChange: onChangeProp,
      onSubmit,
      isStreaming,
      onStop,
      onLoadReadingContext,
      placeholderKey = "chat.composerPlaceholder",
      edgeToEdgeOnMobile = false,
      contextChip = null,
      onAttachPdf,
      compact = false,
    },
    ref,
  ) {
    const { t, i18n } = useTranslation();
    const { confirm, ConfirmModalElement } = useConfirm();
    // The draft is LOCAL state: a keystroke re-renders only the composer,
    // not the page around it (thread + sidebar), which is what made typing
    // lag on weaker machines. The parent's `value` is a seed: prefills
    // (intent chips, reader hand-offs) flow in through the sync effect;
    // the parent hears back only through onSubmit's payload text.
    const [value, setValue] = useState(valueProp);
    useEffect(() => {
      setValue(valueProp);
    }, [valueProp]);
    const onChange = useCallback((next: string) => setValue(next), []);
    // keep the parent's copy in step at the points it cares about (the
    // seed it holds, so a later identical prefill still re-triggers the
    // sync effect above), without a re-render per keystroke
    const notifyParent = onChangeProp;
    // On mobile, Enter inserts a newline and the send button sends; desktop is the inverse.
    const isMobile = useIsMobile();

    const enabledProviders = useSettingsStore((s) => s.enabledProviders);
    const configuredProviders = useMemo(
      // re-evaluate when provider settings change.
      () => getConfiguredProviders(),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [enabledProviders],
    );

    // "Use whole book": only shown with an active reader doc. Confirm modal -> selectAllAiPages.
    const activeDoc = useActiveDocument();
    const selectAllAiPages = useReaderStore((s) => s.selectAllAiPages);
    const allPagesAlreadySelected =
      !!activeDoc &&
      activeDoc.totalPages > 0 &&
      activeDoc.aiSelectedPages.size === activeDoc.totalPages;
    const handleSelectWholeBook = useCallback(async () => {
      if (!activeDoc || activeDoc.totalPages <= 0) return;
      const ok = await confirm({
        title: t("chat.composer.wholeBook.confirmTitle"),
        body: t("chat.composer.wholeBook.confirmBody", {
          count: activeDoc.totalPages,
        }),
        confirmLabel: t("chat.composer.wholeBook.confirmLabel"),
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

    // Esc stops a streaming reply (the ChatGPT/Claude convention) and, when
    // the box is empty, puts the just-sent question back so it can be
    // edited and resent ("undo send" for a too-early Enter).
    useEffect(() => {
      if (!isStreaming) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        onStop();
        if (value.trim().length > 0) return;
        const st = useChatStore.getState();
        const streaming = st.streamingMessageId
          ? st.messages.get(st.streamingMessageId)
          : null;
        const parent = streaming?.parent_message_id
          ? st.messages.get(streaming.parent_message_id)
          : null;
        if (parent?.role === "user" && parent.content) onChange(parent.content);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [isStreaming, onStop, value, onChange]);

    const [mode, setMode] = useState<RecommendationMode>("default");
    // "+" secondary-actions menu (mode / reasoning / whole-book / reading context,
    // plus attach on mobile)
    const plusBtnRef = useRef<HTMLButtonElement>(null);
    const [plusMenuOpen, setPlusMenuOpen] = useState(false);

    // Quota line only applies when the turn bills the Pnyxy bucket (Default or proxy picked).
    const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
    const usesPnyxyQuota =
      (selectedProvider === null || selectedProvider === "pnyxy") &&
      configuredProviders.includes("pnyxy");
    // "Context" submenu in the "+" menu: pick a context preset for this
    // conversation. With a book it binds the preset to the book (durable,
    // settings-store); without one it is a session-only override.
    const aiContexts = useSettingsStore((s) => s.aiContexts);
    const aiContextBindings = useSettingsStore((s) => s.aiContextBindings);
    const bindAiContext = useSettingsStore((s) => s.bindAiContext);
    const activeConversationId = useChatStore((s) => s.activeConversationId);
    const convDocId = useChatStore((s) => {
      if (!s.activeConversationId) return null;
      return (
        s.conversations.find((c) => c.id === s.activeConversationId)
          ?.source_doc_id ?? null
      );
    });
    const convDocTitle = useChatStore((s) => {
      if (!s.activeConversationId) return null;
      return (
        s.conversations.find((c) => c.id === s.activeConversationId)
          ?.source_doc_title ?? null
      );
    });
    const contextDocId = convDocId ?? activeDoc?.meta.id ?? null;
    const sessionKey =
      activeConversationId ?? AI_CONTEXT_DRAFT_CONVERSATION_KEY;
    const sessionOverride = useAiContextSessionStore(
      (s) => s.overrides[sessionKey] ?? null,
    );
    const setSessionOverride = useAiContextSessionStore((s) => s.setOverride);
    const pickedContextId = contextDocId
      ? (aiContextBindings.books[contextDocId] ?? null)
      : sessionOverride;
    const [contextSubmenuOpen, setContextSubmenuOpen] = useState(false);
    // "What does the AI get?" transparency modal
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const handlePickContext = useCallback(
      (presetId: string) => {
        const next = pickedContextId === presetId ? null : presetId;
        if (contextDocId) bindAiContext("books", contextDocId, next);
        else setSessionOverride(sessionKey, next);
        setPlusMenuOpen(false);
      },
      [
        pickedContextId,
        contextDocId,
        bindAiContext,
        setSessionOverride,
        sessionKey,
      ],
    );
    const quotaRows = useQuotaRows(isStreaming);
    // The row that governs the next turn: the pinned model, or on the auto
    // route the predicted bucket, walking the proxy's chain once it is
    // exhausted (the proxy skips a full bucket rather than bouncing 429).
    const servedModel = useServedModelStore((s) => s.model);
    const quotaSelection = useMemo(
      () =>
        selectQuotaRow(quotaRows, {
          pinnedModel: pnyxyModel,
          servedModel,
        }),
      [quotaRows, pnyxyModel, servedModel],
    );
    const activeQuotaModel = quotaSelection.model;
    const quotaRow = usesPnyxyQuota ? quotaSelection.row : null;
    // null hides the line: BYOK provider, anon, or the RPC returned nothing
    const questionsLeft = quotaRow ? computeQuestionsLeft(quotaRow) : null;
    const [quotaModalOpen, setQuotaModalOpen] = useState(false);

    // Reasoning toggle persists across sends (unlike `mode`). Pnyxy route:
    // the proxy turns on Gemini thinking; OpenAI BYOK swaps to o3-mini.
    const [reasoning, setReasoning] = useState(false);
    // "/gr" at the start of an otherwise empty message: slash-command hint
    const features = useFeatures();
    const commandPartial = /^\/\S*$/.test(value) ? value : null;
    const commandMatches = useMemo(
      () =>
        commandPartial
          ? matchChatCommands(commandPartial, (f) => (f ? features[f] : true))
          : [],
      [commandPartial, features],
    );
    // sticky like reasoning: stays on for follow-ups until switched off
    const [webSearch, setWebSearch] = useState(false);
    const openAiConfigured = configuredProviders.includes("openai");
    // Image generation needs an OpenAI key; fall back to Chat if it disappears.
    useEffect(() => {
      if (!openAiConfigured && mode === "image") setMode("default");
    }, [openAiConfigured, mode]);

    const [pendingAttachments, setPendingAttachments] = useState<
      ChatMessageAttachment[]
    >([]);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);

    // Cheap, live estimate for the composer's context chip (~6,2k): mirrors
    // the inspector modal's buckets but skips PDF text extraction/rendering
    // (too heavy to run on every keystroke), so the document/attachment
    // sizes are a rough per-page/per-image guess rather than real text.
    const aiAttachToc = useSettingsStore((s) => s.aiAttachToc);
    const chatMessages = useChatStore((s) => s.messages);
    const chatActiveLeafId = useChatStore((s) => s.activeLeafId);
    const composerContextTokens = useMemo(() => {
      const effectiveDocTitle = (
        activeDoc?.meta.title ??
        convDocTitle ??
        ""
      ).trim();
      const base = buildSystemPrompt(effectiveDocTitle, "", "");
      let total = estimateTokens(base);
      if (TEACHER_MODE_ENABLED) total += estimateTokens(TEACHER_GUARDRAIL);
      const preset = resolveAiContextForConversation({
        docId: contextDocId,
        conversationId: activeConversationId,
      });
      if (preset) total += estimateTokens(preset.preset.body);
      const selectedPages = activeDoc?.aiSelectedPages.size ?? 0;
      total += selectedPages * 600; // rough tokens/page, no PDF parsing here
      if (aiAttachToc && (activeDoc?.toc.length ?? 0) > 0) total += 300;
      total += pendingAttachments.length * 1500;
      if (activeConversationId) {
        const turns = windowChatHistory(
          pathFromRoot(chatMessages, chatActiveLeafId)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
        );
        total += turns.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      }
      return total;
    }, [
      activeDoc,
      convDocTitle,
      contextDocId,
      activeConversationId,
      aiAttachToc,
      pendingAttachments.length,
      chatMessages,
      chatActiveLeafId,
    ]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [dragOver, setDragOver] = useState(false);
    // A dropped PDF uploads to the library in the background; the chip in the
    // attachment row shows progress and blocks a second PDF meanwhile.
    const [pdfUploading, setPdfUploading] = useState<string | null>(null);
    const handleAttachPdf = useCallback(
      async (file: File) => {
        if (!onAttachPdf || pdfUploading) return;
        setPdfUploading(file.name);
        try {
          await onAttachPdf(file);
        } catch (err) {
          setAttachmentError(
            err instanceof Error
              ? err.message
              : t("chat.composer.attachments.pdfFailed"),
          );
        } finally {
          setPdfUploading(null);
        }
      },
      [onAttachPdf, pdfUploading, t],
    );

    const handleAddFiles = useCallback(
      async (files: FileList | File[]) => {
        setAttachmentError(null);
        const incoming: ChatMessageAttachment[] = [];
        for (const file of Array.from(files)) {
          if (incoming.length + pendingAttachments.length >= MAX_ATTACHMENTS) {
            setAttachmentError(
              t("chat.composer.attachments.tooMany", {
                max: MAX_ATTACHMENTS,
              }),
            );
            break;
          }
          if (file.type === "application/pdf" && onAttachPdf) {
            void handleAttachPdf(file);
            continue;
          }
          if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
            setAttachmentError(t("chat.composer.attachments.unsupported"));
            continue;
          }
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setAttachmentError(
              t("chat.composer.attachments.tooLarge", {
                mb: MAX_ATTACHMENT_MB,
              }),
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
      [pendingAttachments.length, t, onAttachPdf, handleAttachPdf],
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

    // Which reading-context row is fetching; the menu stays open with a
    // bouncing-dots loader on that row until the text arrives.
    const [readingCtxLoading, setReadingCtxLoading] = useState<
      "week" | "all" | null
    >(null);
    const handleInsertReadingContext = useCallback(
      async (windowMode: "week" | "all") => {
        if (!onLoadReadingContext || readingCtxLoading) return;
        setReadingCtxLoading(windowMode);
        try {
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
        } finally {
          setReadingCtxLoading(null);
          setPlusMenuOpen(false);
        }
      },
      // value is a dep so the concat below uses the latest input.
      [onChange, onLoadReadingContext, value, readingCtxLoading],
    );

    const handleSendClick = useCallback(async () => {
      const text = value.trim();
      if (!text && pendingAttachments.length === 0) return;
      const payload: ChatComposerSubmitPayload = {
        text,
        provider: selectedProvider,
        mode,
        attachments: pendingAttachments,
        reasoning,
        webSearch,
      };
      // Clear the draft + attachments + reset mode before the await so a
      // slow send doesn't leave them stuck.
      setValue("");
      notifyParent("");
      setPendingAttachments([]);
      setAttachmentError(null);
      if (mode !== "default") setMode("default");
      await onSubmit(payload);
    }, [
      value,
      pendingAttachments,
      selectedProvider,
      mode,
      reasoning,
      webSearch,
      onSubmit,
      notifyParent,
    ]);

    const canSend = value.trim().length > 0 || pendingAttachments.length > 0;

    const modeLabels: Record<RecommendationMode, string> = {
      default: t("chat.composer.modeDefault"),
      books: t("chat.composer.modeBooks"),
      videos: t("chat.composer.modeVideos"),
      image: t("chat.composer.modeImage"),
      library: t("chat.composer.modeLibrary"),
    };
    const modeOptions = openAiConfigured
      ? (["default", "library", "books", "videos", "image"] as const)
      : (["default", "library", "books", "videos"] as const);
    const wholeBookAvailable = !!activeDoc && activeDoc.totalPages > 0;
    const showWholeBookChip = wholeBookAvailable && allPagesAlreadySelected;

    const micButton = speech.supported && (
      <IconButton
        size="sm"
        onClick={() => (speech.listening ? speech.stop() : speech.start())}
        disabled={isStreaming}
        variant={speech.listening ? "danger" : "ghost"}
        className={cn(speech.listening && "bg-danger/15 text-danger")}
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
        aria-pressed={speech.listening}
      >
        {speech.listening ? (
          <MicOff size={18} strokeWidth={1.5} />
        ) : (
          <Mic size={18} strokeWidth={1.5} />
        )}
      </IconButton>
    );

    // 34 px round send, turns into a stop square while streaming
    const sendButton = (
      <button
        type="button"
        onClick={() => {
          if (isStreaming) onStop();
          else void handleSendClick();
        }}
        disabled={!isStreaming && !canSend}
        className={cn(
          "inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-text-primary text-bg-primary transition-opacity cursor-pointer",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30",
        )}
        aria-label={isStreaming ? t("chat.stop") : t("chat.send")}
        title={isStreaming ? t("chat.stop") : t("chat.send")}
      >
        {isStreaming ? (
          <Square size={14} fill="currentColor" strokeWidth={1.5} />
        ) : (
          <ArrowUp size={16} strokeWidth={1.5} />
        )}
      </button>
    );

    return (
      <div className="flex flex-col">
        <div
          // images can be dropped straight onto the composer card
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            setDragOver(false);
            if (e.dataTransfer.files.length === 0) return;
            e.preventDefault();
            void handleAddFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col gap-1.5 rounded-page bg-bg-tertiary px-3 pb-2 pt-2.5 shadow-page transition-shadow",
            // Mobile-flush: negative margin breaks out of the parent's px-3 to reach the viewport edge.
            edgeToEdgeOnMobile &&
              "-mx-3 rounded-b-none sm:mx-0 sm:rounded-page",
            speech.listening && "ring-2 ring-accent-soft",
            dragOver && "ring-2 ring-accent-soft",
          )}
        >
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att, idx) => (
                <AttachmentCard
                  key={idx}
                  attachment={att}
                  onRemove={() => removeAttachment(idx)}
                />
              ))}
            </div>
          )}
          {pdfUploading && (
            <span className={cn(chipActiveClass, "self-start")}>
              <TypingIndicator className="w-4 justify-center" />
              <span className="min-w-0 truncate">
                {t("chat.composer.attachments.pdfUploading", {
                  name: pdfUploading,
                })}
              </span>
            </span>
          )}
          {attachmentError && (
            <p role="alert" className="text-2xs text-danger">
              {attachmentError}
            </p>
          )}
          <textarea
            ref={textareaRef}
            data-tour="chat-composer"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // "/gr⏎" completes the slash command instead of sending
              if (commandMatches.length > 0 && !e.shiftKey) {
                e.preventDefault();
                onChange(`/${commandMatches[0].aliases[0]} `);
                return;
              }
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
            className="block min-h-[1.5rem] w-full resize-none bg-transparent px-1 py-0 text-[length:var(--chat-font-size,15px)] leading-normal text-text-primary outline-none placeholder:text-text-muted-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleAddFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* bottom row: context chip + active option chips + "+" | mic, attach, send */}
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {contextChip && (
                <span className={cn(chipActiveClass, "shrink-0 pr-1.5")}>
                  <button
                    type="button"
                    onClick={contextChip.onOpen}
                    className="inline-flex min-w-0 items-center gap-1.5 cursor-pointer hover:text-text-primary"
                    title={t("chat.openInReader")}
                  >
                    <BookOpen
                      size={14}
                      strokeWidth={1.5}
                      className="shrink-0"
                    />
                    <span className="max-w-[16rem] truncate">
                      {contextChip.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={contextChip.onHide}
                    aria-label={t("chat.hideSourceChip")}
                    title={t("chat.hideSourceChip")}
                    className="ml-0.5 rounded-full p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              {mode !== "default" && (
                <span className={cn(chipActiveClass, "shrink-0 pr-1.5")}>
                  {(() => {
                    const ModeIcon = MODE_ICONS[mode];
                    return (
                      <ModeIcon
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0"
                      />
                    );
                  })()}
                  {modeLabels[mode]}
                  <button
                    type="button"
                    onClick={() => setMode("default")}
                    aria-label={t("chat.composer.clearMode")}
                    title={t("chat.composer.clearMode")}
                    className="ml-0.5 rounded-full p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              {commandMatches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange(`/${c.aliases[0]} `)}
                  className={cn(chipClass, "shrink-0 gap-1.5 cursor-pointer hover:bg-surface-3 hover:text-text-primary")}
                  title={t(`chat.commands.${c.id}.hint`)}
                >
                  <span className="font-mono text-xs">/{c.aliases[0]}</span>
                  <span className="text-2xs text-text-muted">{t(`chat.commands.${c.id}.label`)}</span>
                </button>
              ))}
              {webSearch && (
                <span className={cn(chipActiveClass, "shrink-0 pr-1.5")}>
                  <Globe size={14} strokeWidth={1.5} className="shrink-0" />
                  {t("chat.composer.webSearch.label")}
                  <button
                    type="button"
                    onClick={() => setWebSearch(false)}
                    aria-label={t("chat.composer.webSearch.off")}
                    title={t("chat.composer.webSearch.off")}
                    className="ml-0.5 rounded-full p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              {reasoning && (
                <span className={cn(chipActiveClass, "shrink-0 pr-1.5")}>
                  <Brain size={14} strokeWidth={1.5} className="shrink-0" />
                  {t("chat.composer.reasoning.label")}
                  <button
                    type="button"
                    onClick={() => setReasoning(false)}
                    aria-label={t("chat.composer.reasoning.off")}
                    title={t("chat.composer.reasoning.off")}
                    className="ml-0.5 rounded-full p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              {showWholeBookChip && (
                <span
                  className={cn(chipActiveClass, "shrink-0")}
                  title={t("chat.composer.wholeBook.button")}
                >
                  <BookOpenCheck
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0"
                  />
                  {t("chat.composer.wholeBook.chip")}
                </span>
              )}
              <>
                <button
                  ref={plusBtnRef}
                  type="button"
                  onClick={() => setPlusMenuOpen((v) => !v)}
                  disabled={isStreaming}
                  aria-label={t("chat.composer.moreActions")}
                  title={t("chat.composer.moreActions")}
                  aria-haspopup="menu"
                  aria-expanded={plusMenuOpen}
                  className={cn(
                    chipClass,
                    "shrink-0 px-2 text-text-muted transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  <Plus size={16} strokeWidth={1.5} />
                </button>
                <FloatingMenu
                  open={plusMenuOpen}
                  anchorRef={plusBtnRef}
                  onClose={() => setPlusMenuOpen(false)}
                  className="w-64"
                >
                  {isMobile && (
                    <button
                      type="button"
                      disabled={
                        isStreaming ||
                        pendingAttachments.length >= MAX_ATTACHMENTS
                      }
                      onClick={() => {
                        setPlusMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className={menuRowClass}
                    >
                      <Paperclip size={16} strokeWidth={1.5} />
                      {t("chat.composer.attachments.add")}
                    </button>
                  )}
                  {wholeBookAvailable && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        void handleSelectWholeBook();
                      }}
                      className={menuRowClass}
                    >
                      <BookOpenCheck size={16} strokeWidth={1.5} />
                      {t("chat.composer.wholeBook.button")}
                      {allPagesAlreadySelected && (
                        <Check
                          size={14}
                          strokeWidth={1.5}
                          className="ml-auto shrink-0"
                        />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setWebSearch((v) => !v);
                      setPlusMenuOpen(false);
                    }}
                    className={menuRowClass}
                    title={t("chat.composer.webSearch.button")}
                  >
                    <Globe size={16} strokeWidth={1.5} />
                    {t("chat.composer.webSearch.label")}
                    {webSearch && (
                      <Check
                        size={14}
                        strokeWidth={1.5}
                        className="ml-auto shrink-0"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReasoning((r) => !r);
                      setPlusMenuOpen(false);
                    }}
                    className={menuRowClass}
                    title={t("chat.composer.reasoning.button")}
                  >
                    <Brain size={16} strokeWidth={1.5} />
                    {t("chat.composer.reasoning.label")}
                    {reasoning && (
                      <Check
                        size={14}
                        strokeWidth={1.5}
                        className="ml-auto shrink-0"
                      />
                    )}
                  </button>
                  {onLoadReadingContext && (
                    <>
                      {(["week", "all"] as const).map((windowMode) => (
                        <button
                          key={windowMode}
                          type="button"
                          disabled={readingCtxLoading !== null}
                          onClick={() =>
                            void handleInsertReadingContext(windowMode)
                          }
                          className={menuRowClass}
                          title={t(
                            windowMode === "week"
                              ? "chat.readingContext.weekHint"
                              : "chat.readingContext.recentHint",
                          )}
                        >
                          {readingCtxLoading === windowMode ? (
                            <TypingIndicator className="w-4 justify-center" />
                          ) : (
                            <History size={16} strokeWidth={1.5} />
                          )}
                          {t(
                            windowMode === "week"
                              ? "chat.readingContext.weekTitle"
                              : "chat.readingContext.recentTitle",
                          )}
                        </button>
                      ))}
                    </>
                  )}
                  {aiContexts.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setContextSubmenuOpen((v) => !v)}
                        aria-expanded={contextSubmenuOpen}
                        className={menuRowClass}
                        title={t("chat.composer.context.hint")}
                      >
                        <ScrollText size={16} strokeWidth={1.5} />
                        <span className="min-w-0 flex-1 truncate">
                          {t("chat.composer.context.label")}
                          {pickedContextId && (
                            <span className="text-text-muted">
                              {": "}
                              {
                                aiContexts.find((p) => p.id === pickedContextId)
                                  ?.name
                              }
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          size={14}
                          strokeWidth={1.5}
                          className={cn(
                            "ml-auto shrink-0 transition-transform",
                            contextSubmenuOpen && "rotate-90",
                          )}
                        />
                      </button>
                      {contextSubmenuOpen &&
                        aiContexts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handlePickContext(p.id)}
                            className={cn(menuRowClass, "pl-9")}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {p.name}
                            </span>
                            {pickedContextId === p.id && (
                              <Check
                                size={14}
                                strokeWidth={1.5}
                                className="ml-auto shrink-0"
                              />
                            )}
                          </button>
                        ))}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      setInspectorOpen(true);
                    }}
                    className={menuRowClass}
                  >
                    <Eye size={16} strokeWidth={1.5} />
                    {t("chat.contextInspector.open")}
                  </button>
                  {questionsLeft !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuotaModalOpen(true);
                        setPlusMenuOpen(false);
                      }}
                      className={menuRowClass}
                      title={t("chat.quotaModal.title")}
                    >
                      <Gauge size={16} strokeWidth={1.5} />
                      {t("chat.composer.quota.remaining", { count: questionsLeft })}
                    </button>
                  )}
                  {(isMobile ||
                    wholeBookAvailable ||
                    openAiConfigured ||
                    aiContexts.length > 0 ||
                    onLoadReadingContext) && (
                    <div className="my-1 h-px bg-surface-3" />
                  )}
                  <p className="px-3 pb-1 pt-1 text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
                    {t("chat.composer.modeLabel")}
                  </p>
                  {modeOptions.map((m) => {
                    const ModeIcon = MODE_ICONS[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMode(m);
                          setPlusMenuOpen(false);
                        }}
                        className={menuRowClass}
                      >
                        <ModeIcon size={16} strokeWidth={1.5} />
                        {modeLabels[m]}
                        {mode === m && (
                          <Check
                            size={14}
                            strokeWidth={1.5}
                            className="ml-auto shrink-0"
                          />
                        )}
                      </button>
                    );
                  })}
                </FloatingMenu>
              </>
            </div>

            {speech.error && (
              <span className="truncate text-2xs text-danger">
                {speech.error === "not-allowed"
                  ? t("chat.composer.micDenied")
                  : t("chat.composer.micError")}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {!compact && (
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                className={cn(
                  chipClass,
                  "shrink-0 gap-1 px-2 text-text-muted transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary",
                )}
                title={t("chat.contextInspector.open")}
                aria-label={t("chat.contextInspector.open")}
                aria-haspopup="dialog"
              >
                <Eye size={14} strokeWidth={1.5} />
                {!isMobile && (
                  <span>{t("chat.contextInspector.chipLabel")}</span>
                )}
                <span className="font-mono text-2xs tabular-nums">
                  ~{formatCompactTokens(composerContextTokens, i18n.language)}
                </span>
              </button>
              )}
              {!compact && (
              <span data-tour="chat-model" className="inline-flex">
              <ModelPicker
                value={selectedProvider}
                options={configuredProviders}
                onChange={setSelectedProvider}
                autoModel={activeQuotaModel}
                quotaRows={quotaRows}
              />
              </span>
              )}
              {micButton}
              {!isMobile && (
                <IconButton
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    isStreaming || pendingAttachments.length >= MAX_ATTACHMENTS
                  }
                  title={t("chat.composer.attachments.add")}
                  aria-label={t("chat.composer.attachments.add")}
                >
                  <Paperclip size={18} strokeWidth={1.5} />
                </IconButton>
              )}
              {sendButton}
            </div>
          </div>
        </div>

        <ContextInspectorModal
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          docId={contextDocId}
          docTitle={activeDoc?.meta.title ?? convDocTitle}
          conversationId={activeConversationId}
          attachments={pendingAttachments}
          reasoning={reasoning}
        />
        <QuotaModal
          open={quotaModalOpen}
          onClose={() => setQuotaModalOpen(false)}
          rows={quotaRows}
          activeModel={activeQuotaModel}
          pinnedModel={pnyxyModel}
          fellThrough={quotaSelection.fellThrough}
        />
        {ConfirmModalElement}
      </div>
    );
  },
);
