import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BotMessageSquare,
  ChevronLeft,
  Download,
  FileText,
  Gauge,
  MessagesSquare,
  MoreVertical,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  ChatComposer,
  type ChatComposerSubmitPayload,
} from "@/features/chat/ChatComposer";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useConfirm } from "@/hooks/use-confirm";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { renderMarkdown, handleCodeBlockCopy, detectAiLinkClick } from "@/lib/markdown-message";
import { promptOpenAiLink } from "@/lib/ai-link-prompt";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import { FloatingMenu, TypingIndicator } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { IDockviewPanelProps } from "dockview";
import type { ChatConversation, ChatMessage } from "@/types/chat";

const EMPTY_PATH: ChatMessage[] = [];

interface AiChatPanelContentProps {
  /** Mobile slide-over passes a close handler so the X in the header
   *  collapses it. Dockview-mounted panels don't (the panel has its
   *  own header chrome). */
  onClose?: () => void;
}

/**
 * Reader-side AI chat panel. Renders the same `useChatStore` thread
 * that powers `/chat`, scoped to conversations whose `source_doc_id`
 * matches the active reader doc. The shared store means a thread
 * started here also appears in the standalone chat page (and vice
 * versa) — no parallel data path.
 *
 * Today this panel ships a subset of `/chat` UX: conversation list,
 * switch, new, delete, send, render. Branching, attachments, mic,
 * tool-use, folders, model picker — those still live only in `/chat`
 * for now (Pnyxy's standalone chat surface for power flows). The
 * reader panel deliberately stays "lean and distraction-free" while
 * persisting properly to the same DB rows.
 */
export function AiChatPanelContent({ onClose }: AiChatPanelContentProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handleCitationClick = usePageCitationDispatch();

  const user = useAuthStore((s) => s.user);
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const openaiApiKey = useSettingsStore((s) => s.openaiApiKey);
  const aiAttachToc = useSettingsStore((s) => s.aiAttachToc);
  const aiCustomDefaultContext = useSettingsStore(
    (s) => s.aiCustomDefaultContext,
  );
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const activeDoc = useReaderStore((s) => s.getActiveDoc());

  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const openConversation = useChatStore((s) => s.openConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearActive = useChatStore((s) => s.clearActive);
  // Subscribe to pendingDraft so we can drain reader-handoff drafts
  // even when this panel is already mounted (the user clicks "Send
  // to AI" with the panel open).
  const pendingDraft = useChatStore((s) => s.pendingDraft);

  const { confirm, ConfirmModalElement } = useConfirm();
  const isStreaming = streamingMessageId !== null;

  const docConversations: ChatConversation[] = useMemo(
    () =>
      conversations.filter((c) => c.source_doc_id === activeDocumentId),
    [conversations, activeDocumentId],
  );

  // Strict book scoping: a conversation is only "active" in this
  // panel when its source_doc_id matches the doc the reader is
  // currently showing. Without this guard, the brief moment between
  // (a) the user switching docs and (b) the auto-snap effect below
  // running could leak the previous doc's title / messages into the
  // new doc's panel — and any other code path that ends up with an
  // activeConversationId pointing at a foreign book would too. The
  // standalone /chat page deliberately doesn't have this guard;
  // there the user wants to see all conversations regardless of
  // source. (Side-panel = book-scoped, /chat = global — that
  // distinction is the user's explicit ask.)
  const activeConversation = useMemo(() => {
    const conv =
      conversations.find((c) => c.id === activeConversationId) ?? null;
    if (!conv) return null;
    if (conv.source_doc_id !== activeDocumentId) return null;
    return conv;
  }, [conversations, activeConversationId, activeDocumentId]);

  const activeIsForThisDoc = activeConversation !== null;

  const path = useMemo(
    () =>
      activeIsForThisDoc
        ? pathFromRoot(messages, activeLeafId)
        : EMPTY_PATH,
    [messages, activeLeafId, activeIsForThisDoc],
  );

  const sourceDocId = activeConversation?.source_doc_id ?? null;

  const [input, setInput] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();

  // Inline rename for the active conversation's title (header).
  // Click the title → input mode; Enter / blur saves; Escape cancels.
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Pull the user's conversation list once per signed-in mount. The
  // store handles dedupe / caching beyond that.
  useEffect(() => {
    if (!user) return;
    void fetchConversations();
  }, [user, fetchConversations]);

  // Reader → AI hand-off. When the user picks "Send to AI chat" from
  // the annotation menu, the menu stashes a draft and asks the UI
  // store to open this panel. We drain the draft into a fresh
  // book-scoped conversation, prefill the composer with the quoted
  // selection, and focus the textarea. Subscribed to `pendingDraft`
  // so this works whether the panel was just opened or was already
  // mounted at the moment the user fired the action.
  useEffect(() => {
    if (!user || !pendingDraft) return;
    const draft = useChatStore.getState().consumePendingDraft();
    if (!draft) return;
    void (async () => {
      await createConversation(
        "",
        null,
        draft.source ?? null,
        draft.target ?? null,
      );
      setInput(draft.text);
      // The composer owns its own textarea ref now; auto-focusing on
      // draft handoff would require an imperative handle on the
      // composer. Skipping for now — the user landed in the chat
      // panel deliberately, the input already has their text in it,
      // and tapping it to type more works.
    })();
  }, [pendingDraft, user, createConversation]);

  // Snap to the most recent conversation for the doc when the user
  // switches docs (reader tabs). Falls back to clearActive() so the
  // composer treats the next send as "create a new conversation".
  // Keyed on `activeDocumentId` only — re-running on every conversation
  // list update would clobber the user's manual switch.
  useEffect(() => {
    if (!activeDocumentId || !user) return;
    if (
      activeConversation &&
      activeConversation.source_doc_id === activeDocumentId
    ) {
      return;
    }
    const candidates = conversations.filter(
      (c) => c.source_doc_id === activeDocumentId,
    );
    if (candidates.length > 0) {
      void openConversation(candidates[0].id);
    } else {
      clearActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate single-run-on-doc-change semantics; see comment above
  }, [activeDocumentId, user]);

  // Auto-scroll to bottom when new messages arrive or the streaming
  // assistant message grows.
  const lastMessageContent =
    path[path.length - 1]?.content ?? "";
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [path.length, lastMessageContent]);

  const sendImageMessage = useChatStore((s) => s.sendImageMessage);
  // Composer submit. Composer owns its own state (attachments,
  // model pick, mode); this surface just turns the payload into a
  // chat-store call and creates a doc-scoped conversation lazily
  // on first send.
  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const trimmed = payload.text.trim();
      if (!trimmed && payload.attachments.length === 0) return;
      if (isStreaming) return;
      if (!user || !activeDocumentId || !activeDoc) return;
      setInput("");

      if (!activeIsForThisDoc) {
        try {
          await createConversation(
            trimmed.slice(0, 60),
            null,
            {
              docId: activeDocumentId,
              docTitle:
                activeDoc.customTitle ||
                activeDoc.meta.title ||
                "Untitled",
              page: activeDoc.currentPage,
            },
            null,
          );
        } catch {
          return;
        }
      }
      if (payload.mode === "image") {
        await sendImageMessage(trimmed);
        return;
      }
      await sendMessage(
        trimmed,
        payload.provider ?? undefined,
        payload.attachments.length > 0 ? payload.attachments : undefined,
      );
    },
    [
      isStreaming,
      user,
      activeDocumentId,
      activeDoc,
      activeIsForThisDoc,
      createConversation,
      sendMessage,
      sendImageMessage,
    ],
  );

  const handleNewConversation = useCallback(async () => {
    if (!user || !activeDocumentId || !activeDoc) return;
    try {
      await createConversation(
        "",
        null,
        {
          docId: activeDocumentId,
          docTitle:
            activeDoc.customTitle ||
            activeDoc.meta.title ||
            "Untitled",
          page: activeDoc.currentPage,
        },
        null,
      );
      setListOpen(false);
    } catch {
      // surface via store error / network UI later; silent for now
    }
  }, [user, activeDocumentId, activeDoc, createConversation]);

  const handleDeleteActive = useCallback(async () => {
    if (!activeConversationId) return;
    const ok = await confirm({
      title: t("reader.aiChat.deleteConversationTitle"),
      body: t("reader.aiChat.deleteConversationBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await deleteConversation(activeConversationId);
  }, [activeConversationId, confirm, deleteConversation, t]);

  // ─── gating screens ────────────────────────────────────────

  const hasUsableProvider = useMemo(() => {
    return enabledProviders.some((p) => {
      if (p === "pnyxy") return true;
      if (p === "anthropic") return !!anthropicApiKey.trim();
      if (p === "openai") return !!openaiApiKey.trim();
      return false;
    });
  }, [enabledProviders, anthropicApiKey, openaiApiKey]);

  if (!hasUsableProvider) {
    return (
      <PanelShell onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Settings size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">
            {enabledProviders.length === 0
              ? t("reader.aiChat.noProviders")
              : t("reader.aiChat.needsConfig")}
          </p>
        </div>
      </PanelShell>
    );
  }

  if (!user) {
    return (
      <PanelShell onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <BotMessageSquare size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">
            {t("reader.aiChat.signInRequired")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="rounded-full bg-accent-purple px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-purple/80 cursor-pointer"
          >
            {t("chat.signInRequired")}
          </button>
        </div>
      </PanelShell>
    );
  }

  if (!activeDocumentId) {
    return (
      <PanelShell onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <BotMessageSquare size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">
            {t("reader.aiChat.openDocument")}
          </p>
        </div>
      </PanelShell>
    );
  }

  // ─── main panel ────────────────────────────────────────────

  return (
    <div
      className="relative flex h-full flex-col bg-bg-secondary/50 transition-[padding] duration-150 ease-out"
      style={{
        paddingBottom: keyboardInset > 0 ? keyboardInset : undefined,
      }}
    >
      {/* Header. Hamburger toggles the conversation list overlay;
          the title shows the active conversation (or a fallback);
          the right-side cluster keeps Trash + 3-dots + Close. */}
      <div className="flex items-center justify-between gap-1 border-b border-glass-border pl-1 pr-1 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.showConversations")}
            title={t("reader.aiChat.showConversations")}
          >
            <MessagesSquare size={16} />
          </button>
          {isEditingTitle && activeIsForThisDoc && activeConversation ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={async () => {
                const trimmed = titleInput.trim();
                if (
                  trimmed &&
                  trimmed !== (activeConversation.title || "")
                ) {
                  await renameConversation(activeConversation.id, trimmed);
                }
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setIsEditingTitle(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-glass-border bg-glass-bg px-2 py-0.5 text-sm font-medium text-text-primary outline-none focus:border-accent-purple"
              autoFocus
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium text-text-primary",
                activeIsForThisDoc &&
                  activeConversation &&
                  "cursor-text hover:text-accent-purple",
              )}
              title={
                activeIsForThisDoc
                  ? t("chat.rename", { defaultValue: "Rename" })
                  : undefined
              }
              onClick={() => {
                if (!activeIsForThisDoc || !activeConversation) return;
                setTitleInput(activeConversation.title || "");
                setIsEditingTitle(true);
              }}
            >
              {activeIsForThisDoc
                ? activeConversation?.title || t("chat.untitled")
                : t("reader.aiChat.title")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {activeIsForThisDoc && (
            <button
              type="button"
              onClick={handleDeleteActive}
              className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-red-400 cursor-pointer"
              title={t("reader.aiChat.deleteConversation")}
              aria-label={t("reader.aiChat.deleteConversation")}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            ref={overflowAnchorRef}
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            title={t("settings.aiSection.moreActions")}
            aria-label={t("settings.aiSection.moreActions")}
          >
            <MoreVertical size={16} />
          </button>
          <FloatingMenu
            open={overflowOpen}
            anchorRef={overflowAnchorRef}
            onClose={() => setOverflowOpen(false)}
          >
            {activeIsForThisDoc && activeConversation && (
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  const md = conversationToMarkdown(
                    activeConversation,
                    messages,
                    activeLeafId,
                  );
                  downloadMarkdown(
                    activeConversation.title.trim() || t("chat.untitled"),
                    md,
                  );
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Download size={14} />
                {t("chat.exportMarkdown")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOverflowOpen(false);
                navigate("/settings/ai");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Gauge size={14} />
              {t("settings.aiSection.openQuotas")}
            </button>
          </FloatingMenu>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
              aria-label={t("reader.aiChat.closeAria")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onClick={(e) => {
          handleCodeBlockCopy(e);
          if (e.defaultPrevented) return;
          const aiLink = detectAiLinkClick(e);
          if (aiLink) {
            void promptOpenAiLink(aiLink, confirm, t);
            return;
          }
          handleCitationClick(e);
        }}
        className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
      >
        {!activeIsForThisDoc && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BotMessageSquare size={24} className="text-text-muted/50" />
            <p className="text-xs text-text-muted">
              {t("reader.aiChat.emptyPrompt")}
            </p>
          </div>
        )}

        {path.map((msg) =>
          msg.role === "user" ? (
            <div
              key={msg.id}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-purple/20 px-3.5 py-2 text-sm text-text-primary"
            >
              {msg.content}
            </div>
          ) : msg.id === streamingMessageId && msg.content.length === 0 ? (
            // Empty assistant placeholder while waiting for the first
            // delta. We render the typing indicator INSIDE the bubble
            // (no innerHTML) so the bubble has visible content + a
            // sane height instead of being a pulsing 28px sliver.
            <div
              key={msg.id}
              className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-3 text-sm text-text-muted"
            >
              <TypingIndicator label={t("reader.aiChat.thinking")} />
            </div>
          ) : (
            // Content has started arriving — drop any pulse, render
            // the markdown as it streams. The cursor / streaming
            // visual is implicit in characters appearing one chunk
            // at a time; pulsing the bubble on top of that just
            // makes the page feel laggy.
            <div
              key={msg.id}
              className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-2 text-sm text-text-secondary space-y-2"
            >
              {/* Assistant attachments — currently just generated
                  images from the "Generate image" composer mode. */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {msg.attachments.map((att, idx) =>
                    att.kind === "image" ? (
                      <a
                        key={idx}
                        href={`data:${att.media_type};base64,${att.data}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        title={att.name ?? ""}
                      >
                        <img
                          src={`data:${att.media_type};base64,${att.data}`}
                          alt={att.name ?? "generated image"}
                          className="max-h-72 max-w-full rounded-md object-contain"
                        />
                      </a>
                    ) : null,
                  )}
                </div>
              )}
              {msg.content && (
                <div
                  className="ai-message"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(msg.content, sourceDocId),
                  }}
                />
              )}
            </div>
          ),
        )}

        {/* Pre-placeholder thinking pill — covers the brief gap
            between "user message sent" and "assistant placeholder
            inserted into the path" so the user sees feedback
            immediately. Once the placeholder lands, the empty
            bubble above takes over. */}
        {isStreaming &&
          path[path.length - 1]?.id === streamingMessageId &&
          path[path.length - 1]?.role !== "assistant" && (
            <div className="mr-auto rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-3 text-sm text-text-muted">
              <TypingIndicator label={t("reader.aiChat.thinking")} />
            </div>
          )}
      </div>

      {/* Context summary pill — surfaces what the next message will
          carry as system-prompt context (TOC outline, manually-selected
          pages, custom default persona). The chat-store reads the same
          state at send time, so this matches what's actually sent. */}
      <ContextSummaryPill
        tocAvailable={(activeDoc?.toc.length ?? 0) > 0}
        tocAttached={aiAttachToc}
        selectedPages={activeDoc?.aiSelectedPages.size ?? 0}
        hasPersona={aiCustomDefaultContext.trim().length > 0}
      />
      {/* Shared ChatComposer — same component as the standalone
          chat page, so the reader panel automatically gets every
          composer feature: attachments, mode picker, mic, model
          selection, send/stop. Reading-context is intentionally
          omitted (the current book IS the context here); the
          History button hides when onLoadReadingContext is unset. */}
      <div className="p-3">
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          onStop={() => useChatStore.getState().stopStreaming()}
          placeholderKey="reader.aiChat.placeholder"
        />
      </div>

      {/* Conversation list overlay — slides in from the left over the
          messages area. Same drawer pattern the mobile reader already
          uses for TOC / Comments / AI-Chat itself. The `onClose`
          backdrop is the X in its own header; tapping outside is
          handled by the FloatingMenu siblings, not this drawer
          (deliberate — accidental dismissal mid-scroll is annoying). */}
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col bg-bg-secondary/95 backdrop-blur-xl transition-transform duration-200",
          listOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between gap-1 border-b border-glass-border pl-1 pr-1 py-1">
          <button
            type="button"
            onClick={() => setListOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("common.close")}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {t("reader.aiChat.conversations")}
          </span>
          <button
            type="button"
            onClick={handleNewConversation}
            className="flex h-11 w-11 items-center justify-center rounded-md text-accent-purple transition-colors hover:bg-glass-hover cursor-pointer"
            title={t("reader.aiChat.newConversationForDoc")}
            aria-label={t("reader.aiChat.newConversationForDoc")}
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {docConversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-text-muted">
              {t("reader.aiChat.noConversationsForDoc")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {docConversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void openConversation(c.id);
                      setListOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                      c.id === activeConversationId
                        ? "bg-accent-purple/15 text-text-primary"
                        : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.title || t("chat.untitled")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {ConfirmModalElement}
    </div>
  );
}

/**
 * Common chrome for the gating screens (no provider / signed out /
 * no doc) — header with title + optional close. Keeps the panel
 * recognisable and lets the user dismiss it on mobile even before
 * they have a working chat to show.
 */
function PanelShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-bg-secondary/50">
      {onClose && (
        <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
          <div className="flex items-center gap-2">
            <BotMessageSquare size={16} className="text-accent-purple" />
            <span className="text-sm font-medium text-text-primary">
              {t("reader.aiChat.title")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.closeAria")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

export function AiChatPanel(props: IDockviewPanelProps) {
  // Pass an explicit onClose so the X in the panel header dismisses
  // the dockview panel — same effect as the AI-chat toggle button
  // in the reader toolbar. Without this the X only showed up for
  // the mobile slide-over, and desktop users had to use dockview's
  // own tab close (which lives in a different visual spot than
  // their mouse instinct goes).
  return <AiChatPanelContent onClose={() => props.api.close()} />;
}

/** Tiny line above the composer summarising what context the next
 *  message will carry. Mirrors the chat-store's send-time logic
 *  (Settings → AI persona, the per-book TOC toggle, the user's
 *  manually-selected pages from the TOC selection mode), so the
 *  user can verify what's about to ship without reading our code.
 *
 *  Doubles as a "Customize context" entry point — clicking it (or
 *  the trailing pencil) opens the sidebar's thumbnail TOC in page-
 *  selection mode. The opener function is registered by
 *  `ReaderSidebar`; on surfaces where it's null (e.g. the
 *  standalone `/chat` page) the pill stays as a passive label. */
function ContextSummaryPill({
  tocAvailable,
  tocAttached,
  selectedPages,
  hasPersona,
}: {
  tocAvailable: boolean;
  tocAttached: boolean;
  selectedPages: number;
  hasPersona: boolean;
}) {
  const { t } = useTranslation();
  const openAiContextEditor = useUIStore((s) => s.openAiContextEditor);
  // Only show the customize entry point when there's a book in
  // scope (the page selection only makes sense then) AND the
  // reader actually registered an opener. /chat without a doc → no
  // pill at all.
  const showEditor = tocAvailable && !!openAiContextEditor;

  if (!tocAvailable && selectedPages === 0 && !hasPersona && !showEditor) {
    return null;
  }
  const parts: string[] = [];
  if (tocAttached && tocAvailable) {
    parts.push(t("reader.aiChat.contextToc"));
  }
  if (selectedPages > 0) {
    parts.push(
      t("reader.aiChat.contextPages", { count: selectedPages }),
    );
  }
  if (hasPersona) {
    parts.push(t("reader.aiChat.contextPersona"));
  }
  const summary =
    parts.length > 0
      ? parts.join(" · ")
      : t("reader.aiChat.contextEmpty");

  if (!showEditor) {
    return (
      <div className="px-3">
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <FileText size={11} />
          <span className="truncate">{summary}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3">
      <button
        type="button"
        onClick={() => openAiContextEditor?.()}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        title={t("reader.aiChat.customizeContext", {
          defaultValue: "Customize what pages get sent to the AI",
        })}
      >
        <FileText size={11} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <span className="shrink-0 text-[10px] text-accent-purple/80">
          {t("reader.aiChat.customizeContextAction", {
            defaultValue: "Customize",
          })}
        </span>
      </button>
    </div>
  );
}
