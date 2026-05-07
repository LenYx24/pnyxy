import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  BotMessageSquare,
  ChevronLeft,
  Download,
  FileText,
  Gauge,
  MessagesSquare,
  MoreVertical,
  Plus,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useReaderStore } from "@/stores/reader-store";
import { useAuthStore } from "@/stores/auth-store";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useConfirm } from "@/hooks/use-confirm";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { renderMarkdown, handleCodeBlockCopy } from "@/lib/markdown-message";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import { FloatingMenu } from "@/components/ui";
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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearActive = useChatStore((s) => s.clearActive);

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyboardInset = useKeyboardInset();

  // Pull the user's conversation list once per signed-in mount. The
  // store handles dedupe / caching beyond that.
  useEffect(() => {
    if (!user) return;
    void fetchConversations();
  }, [user, fetchConversations]);

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

  // Auto-resize textarea up to a reasonable cap so a long question
  // doesn't push the messages area off-screen on phones.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
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
    await sendMessage(trimmed);
  }, [
    input,
    isStreaming,
    user,
    activeDocumentId,
    activeDoc,
    activeIsForThisDoc,
    createConversation,
    sendMessage,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
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
      textareaRef.current?.focus();
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {activeIsForThisDoc
              ? activeConversation?.title || t("chat.untitled")
              : t("reader.aiChat.title")}
          </span>
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
          ) : (
            <div
              key={msg.id}
              className={cn(
                "ai-message mr-auto max-w-[85%] rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-2 text-sm text-text-secondary",
                msg.id === streamingMessageId &&
                  msg.content.length === 0 &&
                  "animate-pulse",
              )}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(msg.content, sourceDocId),
              }}
            />
          ),
        )}

        {isStreaming &&
          path[path.length - 1]?.id === streamingMessageId &&
          path[path.length - 1]?.role !== "assistant" && (
            <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-2 text-sm text-text-muted">
              <div className="flex gap-1">
                <div
                  className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              {t("reader.aiChat.thinking")}
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
      {/* Composer */}
      <div className="p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-glass-border bg-bg-secondary/70 p-2 shadow-sm backdrop-blur-md transition-colors focus-within:border-accent-purple/60">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("reader.aiChat.placeholder")}
            rows={1}
            className="flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => {
              if (isStreaming) {
                useChatStore.getState().stopStreaming();
              } else {
                void handleSend();
              }
            }}
            disabled={!isStreaming && !input.trim()}
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors cursor-pointer",
              isStreaming || input.trim()
                ? "bg-accent-purple text-white hover:bg-accent-purple/80"
                : "bg-glass-bg text-text-muted",
            )}
            aria-label={isStreaming ? t("chat.stop") : t("chat.send")}
            title={isStreaming ? t("chat.stop") : t("chat.send")}
          >
            {isStreaming ? (
              <Square size={14} fill="currentColor" />
            ) : (
              <ArrowUp size={18} strokeWidth={2.5} />
            )}
          </button>
        </div>
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

export function AiChatPanel(_props: IDockviewPanelProps) {
  return <AiChatPanelContent />;
}

/** Tiny line above the composer summarising what context the next
 *  message will carry. Mirrors the chat-store's send-time logic
 *  (Settings → AI persona, the per-book TOC toggle, the user's
 *  manually-selected pages from the TOC selection mode), so the
 *  user can verify what's about to ship without reading our code. */
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
  // No book + no persona = nothing to show; suppress the pill so it
  // doesn't look like noisy chrome on the standalone /chat surface.
  if (!tocAvailable && selectedPages === 0 && !hasPersona) return null;
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
  return (
    <div className="px-3">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <FileText size={11} />
        <span className="truncate">{summary}</span>
      </div>
    </div>
  );
}
