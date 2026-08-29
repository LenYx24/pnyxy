import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";
import type { ChatSendOptions } from "@/stores/chat-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useResourceStore } from "@/stores/resource-store";
import {
  ChatComposer,
  type ChatComposerSubmitPayload,
} from "@/features/chat/ChatComposer";
import { MessageBubble } from "@/features/chat/MessageBubble";
import { useConfirm } from "@/hooks/use-confirm";
import { useReadAloud } from "@/hooks/use-read-aloud";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import {
  buildArticleSystemPrompt,
  buildVideoSystemPrompt,
  formatTimestamp,
  parseTimestamp,
  type VideoClip,
  type VideoContextMode,
} from "@/lib/ai/video-chat";
import { Button, FloatingMenu, TypingIndicator } from "@/components/ui";
import {
  fieldSmClass,
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui/classes";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import type { Resource } from "@/types/resource";
import type { ChatMessage } from "@/types/chat";
import { isSafeExternalUrl } from "@/lib/safe-url";

const EMPTY_PATH: ChatMessage[] = [];

/** [mm:ss] / [h:mm:ss] citations in an assistant reply → seconds. */
const TIMESTAMP_RE = /\[(\d{1,2}:)?(\d{1,2}):(\d{2})\]/g;

function extractTimestamps(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    const h = m[1] ? Number(m[1].slice(0, -1)) : 0;
    const secs = h * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (!seen.has(secs)) {
      seen.add(secs);
      out.push(secs);
    }
  }
  return out;
}

interface ResourceChatPanelProps {
  resource: Resource;
  /** Playhead of the embedded player, for the "from now" clip buttons. */
  currentTime: number;
  /** Video length when the player has reported it. */
  duration: number | null;
  /** Jump the player to a second (timestamp citations). */
  onSeek: (seconds: number) => void;
  /** Mobile: collapse the panel. */
  onClose?: () => void;
  /** Prefill the composer (browser extension: the page selection). */
  initialInput?: string;
  /** Browser-extension side panel: one slim header (title + open original
   *  + conversations + new), no context row for articles, composer flush
   *  to the edge, compact composer. */
  compact?: boolean;
  /** Extra header actions (compact mode), e.g. the extension's settings. */
  extraActions?: React.ReactNode;
  /** Compact mode: show the resource title in the header (the extension
   *  has no other title); the in-app viewer already shows it above. */
  showTitle?: boolean;
}

/**
 * AI side-chat for a YouTube resource. The student picks how the model
 * gets the video:
 *   - transcript: stored captions (clipped to a time range) go in the
 *     system prompt, works with every provider;
 *   - video: the Pnyxy proxy hands the YouTube URL (+ range) to Gemini,
 *     which watches it natively.
 * Conversations are tied to the resource (chat_conversations
 * .source_resource_id) so returning to the video restores the thread.
 */
export function ResourceChatPanel({
  resource,
  currentTime,
  duration,
  onSeek,
  onClose,
  initialInput,
  compact = false,
  extraActions,
  showTitle = true,
}: ResourceChatPanelProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const { confirm, ConfirmModalElement } = useConfirm();
  const tts = useReadAloud();

  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const isChatLoading = useChatStore((s) => s.isLoading);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const openConversation = useChatStore((s) => s.openConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const clearActive = useChatStore((s) => s.clearActive);
  const refreshTranscript = useResourceStore((s) => s.refreshTranscript);

  const [input, setInput] = useState(initialInput ?? "");
  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // collapsed by default: the one-line summary is enough until it's needed
  const [contextOpen, setContextOpen] = useState(false);
  const [mode, setMode] = useState<VideoContextMode>("transcript");
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const listBtnRef = useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Gemini direct-video only rides the Pnyxy route.
  const pnyxyAvailable = useMemo(
    () => getConfiguredProviders().includes("pnyxy"),
    // re-evaluate when provider settings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  useEffect(() => {
    if (mode === "video" && !pnyxyAvailable) setMode("transcript");
  }, [mode, pnyxyAvailable]);

  const transcript = resource.transcript ?? null;
  const hasTranscript = !!transcript && transcript.length > 0;

  // Clip parsing; `undefined` = unparseable input, shown as an error ring.
  const startSec = parseTimestamp(startText);
  const endSec = parseTimestamp(endText);
  const clipInvalid =
    startSec === undefined ||
    endSec === undefined ||
    (typeof startSec === "number" && typeof endSec === "number" && endSec <= startSec);
  const clip = useMemo<VideoClip>(
    () => ({
      startSec: typeof startSec === "number" ? startSec : null,
      endSec: typeof endSec === "number" ? endSec : null,
    }),
    [startSec, endSec],
  );
  const wholeVideo = clip.startSec === null && clip.endSec === null;

  const resourceConversations = useMemo(
    () => conversations.filter((c) => c.source_resource_id === resource.id),
    [conversations, resource.id],
  );
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const activeIsForResource =
    !!activeConversation && activeConversation.source_resource_id === resource.id;
  const path = useMemo(
    () =>
      activeIsForResource && activeLeafId
        ? pathFromRoot(messages, activeLeafId)
        : EMPTY_PATH,
    [activeIsForResource, messages, activeLeafId],
  );
  const isStreaming = streamingMessageId !== null;

  useEffect(() => {
    if (user && conversations.length === 0) void fetchConversations();
  }, [user, conversations.length, fetchConversations]);

  // Snap to the most recent thread for this video (list is updated_at desc).
  const snappedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    if (isChatLoading && conversations.length === 0) return;
    if (snappedForRef.current === resource.id) return;
    if (activeIsForResource) {
      snappedForRef.current = resource.id;
      return;
    }
    if (resourceConversations.length > 0) {
      void openConversation(resourceConversations[0].id);
    } else {
      clearActive();
    }
    snappedForRef.current = resource.id;
  }, [
    user,
    isChatLoading,
    conversations.length,
    resource.id,
    activeIsForResource,
    resourceConversations,
    openConversation,
    clearActive,
  ]);

  // keep the newest message in view while streaming
  const lastContent = path[path.length - 1]?.content ?? "";
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [path.length, lastContent]);

  const isArticle = resource.kind === "web";

  const buildSendOptions = useCallback((): ChatSendOptions => {
    if (isArticle) {
      return {
        systemPromptOverride: buildArticleSystemPrompt({
          title: resource.title,
          url: resource.url,
          content: resource.content,
        }),
        scope: "chat",
      };
    }
    const systemPromptOverride = buildVideoSystemPrompt({
      title: resource.title,
      author: resource.description,
      mode,
      clip,
      transcript,
    });
    const options: ChatSendOptions = { systemPromptOverride, scope: "video" };
    if (mode === "video") {
      options.videoContext = {
        url: resource.url,
        startSec: clip.startSec,
        endSec: clip.endSec,
        durationSec: duration,
      };
    }
    return options;
  }, [isArticle, resource.title, resource.description, resource.url, resource.content, mode, clip, transcript, duration]);

  const ensureConversation = useCallback(async () => {
    if (activeIsForResource) return true;
    try {
      await createConversation(
        "",
        resource.folder_id,
        {
          docId: "",
          docTitle: resource.title,
          page: null,
          resourceId: resource.id,
        },
        null,
      );
      return true;
    } catch (err) {
      logError("resourceChat:createConversation", err);
      showToast(t("resources.chat.newConversationFailed"), "error");
      return false;
    }
  }, [activeIsForResource, createConversation, resource, t]);

  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const trimmed = payload.text.trim();
      if (!trimmed && payload.attachments.length === 0) return;
      if (isStreaming || !user || clipInvalid) return;
      setInput("");
      if (!(await ensureConversation())) return;
      const options = buildSendOptions();
      // "+ → Organize library": route through the tool loop, telling it
      // which item this chat is about so "move this to X" needs no ids
      if (payload.mode === "library") {
        options.libraryTools = true;
        options.libraryToolsContext = `The user is currently viewing the ${resource.kind === "youtube" ? "YouTube video" : "saved web page"} "${resource.title}" (resource id: ${resource.id}). "This video" / "this page" / "this" refers to that resource; its conversations move with it.`;
        delete options.systemPromptOverride;
      }
      if (payload.reasoning) options.reasoning = true;
      if (payload.webSearch) options.webSearch = true;
      // direct video is proxy-only; the picker's choice is overridden
      const provider = mode === "video" ? "pnyxy" : (payload.provider ?? undefined);
      const attachments =
        payload.attachments.length > 0 ? payload.attachments : undefined;
      if (branchFromId) {
        const parentId = branchFromId;
        setBranchFromId(null);
        await branchFrom(parentId, trimmed, provider, attachments, options);
        return;
      }
      await sendMessage(trimmed, provider, attachments, options);
    },
    [
      isStreaming,
      user,
      clipInvalid,
      ensureConversation,
      buildSendOptions,
      mode,
      branchFromId,
      branchFrom,
      sendMessage,
    ],
  );

  const handleNewConversation = useCallback(async () => {
    setListOpen(false);
    clearActive();
    // created lazily on first send so an abandoned "new" leaves no empty row
  }, [clearActive]);

  const handleRefreshTranscript = useCallback(async () => {
    setRefreshing(true);
    try {
      const ok = await refreshTranscript(resource.id);
      showToast(
        ok
          ? t("resources.chat.transcriptFetched")
          : t("resources.chat.transcriptUnavailable"),
        ok ? "success" : "info",
      );
    } catch (err) {
      logError("resourceChat:refreshTranscript", err);
      showToast(t("resources.chat.transcriptFetchFailed"), "error");
    } finally {
      setRefreshing(false);
    }
  }, [refreshTranscript, resource.id, t]);

  const setNow = (which: "start" | "end") => {
    const stamp = formatTimestamp(currentTime);
    if (which === "start") setStartText(stamp);
    else setEndText(stamp);
  };

  const modeHint =
    mode === "video"
      ? t("resources.chat.modeVideoHint")
      : hasTranscript
        ? t("resources.chat.modeTranscriptHint", {
            lang: resource.transcript_lang ?? "?",
            count: transcript?.length ?? 0,
          })
        : t("resources.chat.modeTranscriptMissing");

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bg-primary">
      {/* header */}
      <div className={cn("flex items-center gap-1 border-b border-glass-border px-2", compact ? "py-1" : "py-1.5")}>
        {!compact && (
          <Sparkles size={15} strokeWidth={1.5} className="ml-1 shrink-0 text-accent" />
        )}
        <span
          className={cn("min-w-0 flex-1 truncate", compact ? "pl-1 text-xs font-medium text-text-primary" : "text-sm font-medium text-text-primary")}
          title={compact ? resource.title : undefined}
        >
          {compact
            ? showTitle
              ? resource.title
              : activeIsForResource && activeConversation?.title
                ? activeConversation.title
                : ""
            : activeIsForResource && activeConversation?.title
              ? activeConversation.title
              : t("resources.chat.title")}
        </span>
        {compact && showTitle && isSafeExternalUrl(resource.url) && (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t("resources.openOriginal")}
            aria-label={t("resources.openOriginal")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary"
          >
            <ExternalLink size={15} strokeWidth={1.5} />
          </a>
        )}
        <button
          ref={listBtnRef}
          type="button"
          onClick={() => setListOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
          title={t("resources.chat.conversations")}
          aria-label={t("resources.chat.conversations")}
          aria-haspopup="menu"
          aria-expanded={listOpen}
        >
          <MessagesSquare size={17} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => void handleNewConversation()}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
          title={t("resources.chat.newConversation")}
          aria-label={t("resources.chat.newConversation")}
        >
          <Plus size={17} strokeWidth={1.5} />
        </button>
        {extraActions}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            aria-label={t("common.close")}
          >
            <X size={17} strokeWidth={1.5} />
          </button>
        )}
        <FloatingMenu
          open={listOpen}
          anchorRef={listBtnRef}
          onClose={() => setListOpen(false)}
          className="max-h-72 min-w-[14rem] overflow-y-auto py-1"
        >
          {resourceConversations.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-text-muted">
              {t("resources.chat.noConversations")}
            </p>
          ) : (
            resourceConversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  void openConversation(c.id);
                  setListOpen(false);
                }}
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                  c.id === activeConversationId
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {c.title || t("chat.untitled")}
                </span>
              </button>
            ))
          )}
        </FloatingMenu>
      </div>

      {/* context: how the model gets the video + which part (video only;
          an article's whole text is the context) */}
      {isArticle ? (
        !compact && (
        <div className="flex items-center gap-2 border-b border-glass-border px-3 py-2 text-xs text-text-secondary">
          <FileText size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            {resource.content
              ? t("resources.chat.articleContext")
              : t("resources.chat.articleMissing")}
          </span>
        </div>
        )
      ) : (
      <div className="border-b border-glass-border">
        <button
          type="button"
          onClick={() => setContextOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-bg-secondary cursor-pointer"
          aria-expanded={contextOpen}
        >
          {mode === "video" ? (
            <Video size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
          ) : (
            <FileText size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {mode === "video"
              ? t("resources.chat.modeVideo")
              : t("resources.chat.modeTranscript")}
            {" · "}
            {wholeVideo
              ? t("resources.chat.wholeVideo")
              : `${clip.startSec !== null ? formatTimestamp(clip.startSec) : "0:00"} – ${
                  clip.endSec !== null ? formatTimestamp(clip.endSec) : t("resources.chat.toEnd")
                }`}
          </span>
          {contextOpen ? (
            <ChevronUp size={14} strokeWidth={1.5} className="shrink-0" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
          )}
        </button>

        {contextOpen && (
          <div className="space-y-3 px-3 pb-3">
            {/* mode picker */}
            <div>
              <div className={cn(segmentedGroupClass, "w-full")}>
                <button
                  type="button"
                  onClick={() => setMode("transcript")}
                  aria-pressed={mode === "transcript"}
                  className={cn(
                    segmentedItemClass,
                    "inline-flex flex-1 items-center justify-center gap-1.5 px-2 text-xs",
                    mode === "transcript" && segmentedItemActiveClass,
                  )}
                >
                  <FileText size={13} strokeWidth={1.5} />
                  {t("resources.chat.modeTranscript")}
                </button>
                <button
                  type="button"
                  onClick={() => pnyxyAvailable && setMode("video")}
                  disabled={!pnyxyAvailable}
                  aria-pressed={mode === "video"}
                  title={
                    pnyxyAvailable ? undefined : t("resources.chat.modeVideoNeedsPnyxy")
                  }
                  className={cn(
                    segmentedItemClass,
                    "inline-flex flex-1 items-center justify-center gap-1.5 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50",
                    mode === "video" && segmentedItemActiveClass,
                  )}
                >
                  <Video size={13} strokeWidth={1.5} />
                  {t("resources.chat.modeVideo")}
                </button>
              </div>
              <p className="mt-1.5 text-2xs leading-snug text-text-muted">
                {modeHint}
                {!pnyxyAvailable && (
                  <>
                    {" "}
                    {t("resources.chat.modeVideoNeedsPnyxy")}
                  </>
                )}
              </p>
              {mode === "transcript" && !hasTranscript && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 gap-1.5 text-xs"
                  onClick={() => void handleRefreshTranscript()}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} strokeWidth={1.5} />
                  )}
                  {t("resources.chat.fetchTranscript")}
                </Button>
              )}
            </div>

            {/* clip range */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
                  <Clock size={11} strokeWidth={1.5} />
                  {t("resources.chat.clipLabel")}
                </span>
                {!wholeVideo && (
                  <button
                    type="button"
                    onClick={() => {
                      setStartText("");
                      setEndText("");
                    }}
                    className="text-2xs text-text-muted underline-offset-2 hover:text-text-primary hover:underline cursor-pointer"
                  >
                    {t("resources.chat.wholeVideo")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["start", "end"] as const).map((which) => {
                  const value = which === "start" ? startText : endText;
                  const setValue = which === "start" ? setStartText : setEndText;
                  const parsed = which === "start" ? startSec : endSec;
                  return (
                    <div key={which} className="flex min-w-0 items-center gap-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={
                          which === "start"
                            ? t("resources.chat.clipFrom")
                            : t("resources.chat.clipTo")
                        }
                        aria-label={
                          which === "start"
                            ? t("resources.chat.clipFrom")
                            : t("resources.chat.clipTo")
                        }
                        className={cn(
                          fieldSmClass,
                          "min-w-0 flex-1 font-mono",
                          (parsed === undefined ||
                            (which === "end" && clipInvalid && parsed !== undefined && value)) &&
                            "ring-1 ring-danger",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setNow(which)}
                        className="shrink-0 rounded-control px-1.5 py-1 text-2xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
                        title={t("resources.chat.useCurrentTime")}
                      >
                        {t("resources.chat.now")}
                      </button>
                    </div>
                  );
                })}
              </div>
              {clipInvalid && (
                <p className="mt-1 text-2xs text-danger">
                  {t("resources.chat.clipInvalid")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* thread */}
      <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {path.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Sparkles size={22} strokeWidth={1.5} className="text-accent/70" />
            <p className="text-sm text-text-secondary">
              {isArticle ? t("resources.chat.emptyTitleArticle") : t("resources.chat.emptyTitle")}
            </p>
            <p className="text-xs text-text-muted">
              {isArticle ? t("resources.chat.emptyBodyArticle") : t("resources.chat.emptyBody")}
            </p>
          </div>
        )}
        {path.map((msg) => {
          const handleRegenerate =
            msg.role === "assistant" && msg.parent_message_id
              ? () => {
                  const parent = messages.get(msg.parent_message_id ?? "");
                  if (!parent || parent.role !== "user") return;
                  void branchFrom(
                    parent.parent_message_id,
                    parent.content,
                    mode === "video" ? "pnyxy" : undefined,
                    parent.attachments ?? undefined,
                    buildSendOptions(),
                  );
                }
              : undefined;
          const handleEdit =
            msg.role === "user"
              ? (newText: string) => {
                  void branchFrom(
                    msg.parent_message_id,
                    newText,
                    mode === "video" ? "pnyxy" : undefined,
                    msg.attachments ?? undefined,
                    buildSendOptions(),
                  );
                }
              : undefined;
          const stamps = msg.role === "assistant" ? extractTimestamps(msg.content) : [];
          return (
            <div
              key={msg.id}
              className={cn(
                msg.role === "assistant" &&
                  "rounded-panel bg-bg-tertiary px-3.5 py-3 text-[13.5px] leading-[1.55] shadow-page",
              )}
            >
              <MessageBubble
                msg={msg}
                messages={messages}
                activeLeafId={activeLeafId}
                streamingMessageId={streamingMessageId}
                sourceDocId={null}
                confirm={confirm}
                tts={tts}
                onBranchHere={() => setBranchFromId(msg.id)}
                onPickBranch={setActiveLeaf}
                onRegenerate={handleRegenerate}
                onEdit={handleEdit}
                onDelete={async () => {
                  const ok = await confirm({
                    title: t("chat.confirmDeleteMessageTitle"),
                    body: t("chat.confirmDeleteMessageBody"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  });
                  if (!ok) return;
                  await useChatStore.getState().deleteMessage(msg.id);
                }}
              />
              {/* [mm:ss] citations → seek chips */}
              {stamps.length > 0 && msg.id !== streamingMessageId && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {stamps.map((secs) => (
                    <button
                      key={secs}
                      type="button"
                      onClick={() => onSeek(secs)}
                      className="inline-flex items-center gap-1 rounded-chip bg-surface-3 px-2 py-0.5 font-mono text-2xs text-text-secondary transition-colors hover:bg-accent/15 hover:text-accent cursor-pointer"
                      title={t("resources.chat.seekTo", { time: formatTimestamp(secs) })}
                    >
                      <Clock size={10} strokeWidth={1.5} />
                      {formatTimestamp(secs)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {isStreaming &&
          path[path.length - 1]?.id === streamingMessageId &&
          path[path.length - 1]?.role !== "assistant" && (
            <div className="mr-auto rounded-panel bg-bg-tertiary px-3.5 py-3 text-sm text-text-muted shadow-page">
              <TypingIndicator label={t("reader.aiChat.thinking")} />
            </div>
          )}
      </div>

      {/* composer */}
      <div className={cn("space-y-2", compact ? "border-t border-glass-border px-1.5 pb-1.5 pt-1.5" : "px-3 pb-3 pt-1")}>
        {branchFromId && messages.get(branchFromId) && (
          <div className="flex items-center justify-between gap-2 rounded-control bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-secondary">
            <span className="flex min-w-0 items-center gap-1.5">
              <GitBranch size={12} className="shrink-0" />
              <span className="truncate">
                {t("chat.branchingFrom", {
                  snippet:
                    messages.get(branchFromId)!.content.slice(0, 48) +
                    (messages.get(branchFromId)!.content.length > 48 ? "…" : ""),
                })}
              </span>
            </span>
            <button
              onClick={() => setBranchFromId(null)}
              className="shrink-0 rounded p-0.5 hover:bg-surface-3 cursor-pointer"
              aria-label={t("common.cancel")}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className={cn(compact ? "" : "rounded-[22px] bg-bg-tertiary p-1.5 shadow-page")}>
          <ChatComposer
            compact={compact}
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
            onStop={() => useChatStore.getState().stopStreaming()}
            placeholderKey={isArticle ? "resources.chat.placeholderArticle" : "resources.chat.placeholder"}
          />
        </div>
      </div>

      {ConfirmModalElement}
    </div>
  );
}
