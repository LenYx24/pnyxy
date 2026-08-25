import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BotMessageSquare,
  ChevronDown,
  ChevronLeft,
  Download,
  Gauge,
  MessagesSquare,
  MoreVertical,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  ChatComposer,
  type ChatComposerHandle,
  type ChatComposerSubmitPayload,
} from "@/features/chat/ChatComposer";
import { MessageBubble } from "@/features/chat/MessageBubble";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useConfirm } from "@/hooks/use-confirm";
import { useReadAloud } from "@/hooks/use-read-aloud";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import { FloatingMenu, TypingIndicator } from "@/components/ui";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import type { IDockviewPanelProps } from "dockview";
import type { ChatConversation, ChatMessage } from "@/types/chat";
import { PanelShell } from "./PanelShell";
import { ContextSummaryPill } from "./ContextSummaryPill";
import { InlineAiPagePicker } from "./InlineAiPagePicker";

const EMPTY_PATH: ChatMessage[] = [];

interface AiChatPanelContentProps {
  /** Only the mobile slide-over passes this; dockview panels have their own header. */
  onClose?: () => void;
}

/** Reader-side AI chat panel, scoped to conversations for the active doc. */
export function AiChatPanelContent({ onClose }: AiChatPanelContentProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

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
  const isChatLoading = useChatStore((s) => s.isLoading);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const openConversation = useChatStore((s) => s.openConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const clearActive = useChatStore((s) => s.clearActive);
  // subscribe so handoff drafts drain even when already mounted
  const pendingDraft = useChatStore((s) => s.pendingDraft);

  const { confirm, ConfirmModalElement } = useConfirm();
  const isStreaming = streamingMessageId !== null;

  const docConversations: ChatConversation[] = useMemo(
    () =>
      conversations.filter((c) => c.source_doc_id === activeDocumentId),
    [conversations, activeDocumentId],
  );

  // only active when source_doc_id matches the current doc, else a foreign
  // book's title/messages leak in before the auto-snap effect runs
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

  // "Summarize where you left off": offered when the book was opened with
  // meaningful prior progress after a break, and there's no thread yet.
  const resumeDaysAgo = activeDoc?.lastReadAt
    ? (Date.now() - new Date(activeDoc.lastReadAt).getTime()) / 86_400_000
    : null;
  const showResume =
    !activeIsForThisDoc &&
    !!activeDoc &&
    (activeDoc.currentPage ?? 1) > 5 &&
    resumeDaysAgo !== null &&
    resumeDaysAgo >= 4;
  const resumePrompt = t("reader.aiChat.resumeSummaryPrompt", {
    defaultValue:
      "Summarize the part of this book I've read so far, up to page {{page}}. Focus on the key ideas and how they build up so I can pick up where I left off.",
    page: activeDoc?.currentPage ?? 1,
  });

  const [input, setInput] = useState("");
  const [listOpen, setListOpen] = useState(false);
  // reset on doc change so a different book doesn't show a stale picker
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  useEffect(() => {
    setPagePickerOpen(false);
  }, [activeDocumentId]);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  // ref not state so set+read happen synchronously in one submit handler
  const pendingCitationRef = useRef<{
    documentId: string;
    selection: import("@/types/annotation").TextSelection;
  } | null>(null);
  const keyboardInset = useKeyboardInset();
  // one utterance per panel so reading a new message stops the previous
  const tts = useReadAloud();

  // drain the UI-store pending-attachments queue into the composer; consume
  // clears it so items aren't injected twice
  const pendingChatAttachments = useUIStore((s) => s.pendingChatAttachments);
  useEffect(() => {
    if (pendingChatAttachments.length === 0) return;
    const items = useUIStore.getState().consumePendingChatAttachments();
    if (items.length === 0) return;
    composerRef.current?.addAttachments(items);
  }, [pendingChatAttachments]);

  // inline title rename in the header: enter/blur saves, escape cancels
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // fetch the conversation list once per signed-in mount
  useEffect(() => {
    if (!user) return;
    void fetchConversations();
  }, [user, fetchConversations]);

  // "Send to AI" handoff: drain the stashed draft, arm the citation.
  // handleSubmit lazily creates a doc-scoped conversation on first send.
  useEffect(() => {
    if (!user || !pendingDraft) return;
    const draft = useChatStore.getState().consumePendingDraft();
    if (!draft) return;
    if (draft.selection && draft.source?.docId) {
      pendingCitationRef.current = {
        documentId: draft.source.docId,
        selection: draft.selection,
      };
    }
    setInput(draft.text);
  }, [pendingDraft, user]);

  // Snap to the doc's most recent conversation on open / doc switch. List is
  // fetched lazily, so the ref tracks the snapped docId (re-runs once populated)
  // and also stops a re-snap from clobbering a manual choice.
  const snappedForDocIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeDocumentId || !user) return;
    // wait for the initial fetch, else we snap to an empty list and never
    // recover since the ref is already set for this doc
    if (isChatLoading && conversations.length === 0) return;
    if (snappedForDocIdRef.current === activeDocumentId) return;
    // already on a conversation for this doc (e.g. arrived from /chat)
    if (
      activeConversation &&
      activeConversation.source_doc_id === activeDocumentId
    ) {
      snappedForDocIdRef.current = activeDocumentId;
      return;
    }
    const candidates = conversations.filter(
      (c) => c.source_doc_id === activeDocumentId,
    );
    if (candidates.length > 0) {
      // list is ordered updated_at desc, so [0] is the most recent thread
      void openConversation(candidates[0].id);
    } else {
      clearActive();
    }
    snappedForDocIdRef.current = activeDocumentId;
  }, [
    activeDocumentId,
    user,
    isChatLoading,
    conversations,
    activeConversation,
    openConversation,
    clearActive,
  ]);

  // auto-scroll to bottom on new messages or as the streaming message grows
  const lastMessageContent =
    path[path.length - 1]?.content ?? "";
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [path.length, lastMessageContent]);

  const sendImageMessage = useChatStore((s) => s.sendImageMessage);
  // creates a doc-scoped conversation lazily on first send
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
      // consume the citation on first send only, so a follow-up turn isn't
      // re-cited from the original passage
      const armedCitation = pendingCitationRef.current;
      pendingCitationRef.current = null;
      const sendOptions: import("@/stores/chat-store").ChatSendOptions = {};
      if (payload.reasoning) sendOptions.reasoning = true;
      if (armedCitation) sendOptions.citation = armedCitation;
      const finalSendOptions =
        Object.keys(sendOptions).length > 0 ? sendOptions : undefined;
      // when branchFromId is set, send under that parent instead of the leaf
      if (branchFromId) {
        const parentId = branchFromId;
        setBranchFromId(null);
        await branchFrom(
          parentId,
          trimmed,
          payload.provider ?? undefined,
          payload.attachments.length > 0 ? payload.attachments : undefined,
          finalSendOptions,
        );
        return;
      }
      await sendMessage(
        trimmed,
        payload.provider ?? undefined,
        payload.attachments.length > 0 ? payload.attachments : undefined,
        finalSendOptions,
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
      branchFrom,
      branchFromId,
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
    } catch (error) {
      logError("handleNewConversation", error);
      showToast(
        t("reader.aiChat.newConversationFailed", {
          defaultValue:
            "Couldn't start a new conversation. Check your connection and try again.",
        }),
        "error",
      );
    }
  }, [user, activeDocumentId, activeDoc, createConversation, t]);

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
            className="rounded-chip bg-text-primary px-4 py-1.5 text-xs font-medium text-bg-primary transition-opacity hover:opacity-90 cursor-pointer"
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

  return (
    // opaque surface so the dark dockview backdrop doesn't wash it gray in light theme
    <div
      // no transition on paddingBottom: it's driven by the keyboard inset,
      // which ticks rapidly as the on-screen keyboard animates in, animating
      // it too made the whole panel reflow-lag behind the keyboard
      className="relative flex h-full flex-col"
      style={{
        paddingBottom: keyboardInset > 0 ? keyboardInset : undefined,
      }}
    >
      {/* Header: list toggle, active title, overflow + close */}
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {/* chip + caret so it reads as a "switch conversation" dropdown */}
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="chip flex h-8 shrink-0 items-center gap-1 px-2.5 text-text-muted hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.showConversations")}
            title={t("reader.aiChat.showConversations")}
          >
            <MessagesSquare size={16} />
            <ChevronDown size={13} />
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
              className="field min-w-0 flex-1 px-2 py-0.5 text-sm font-medium"
              autoFocus
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] font-medium text-text-secondary",
                activeIsForThisDoc &&
                  activeConversation &&
                  "cursor-text hover:text-text-primary",
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
          {/* start a fresh conversation for this doc */}
          <button
            type="button"
            onClick={handleNewConversation}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            title={t("reader.aiChat.newConversationForDoc")}
            aria-label={t("reader.aiChat.newConversationForDoc")}
          >
            <Plus size={16} strokeWidth={1.5} />
          </button>
          <button
            ref={overflowAnchorRef}
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            title={t("settings.aiSection.moreActions")}
            aria-label={t("settings.aiSection.moreActions")}
          >
            <MoreVertical size={16} strokeWidth={1.5} />
          </button>
          <FloatingMenu
            open={overflowOpen}
            anchorRef={overflowAnchorRef}
            onClose={() => setOverflowOpen(false)}
            className="p-1"
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
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary cursor-pointer"
            >
              <Gauge size={14} />
              {t("settings.aiSection.openQuotas")}
            </button>
            {/* delete moved out of the title bar into the overflow menu */}
            {activeIsForThisDoc && (
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  void handleDeleteActive();
                }}
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-danger hover:bg-danger/10 cursor-pointer"
              >
                <Trash2 size={14} />
                {t("reader.aiChat.deleteConversation")}
              </button>
            )}
          </FloatingMenu>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
              aria-label={t("reader.aiChat.closeAria")}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="min-w-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3 pt-1"
      >
        {!activeIsForThisDoc && (
          <div className="flex flex-col gap-2.5 rounded-panel bg-bg-secondary px-3.5 py-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Sparkles size={14} strokeWidth={1.5} />
              <span>
                {t("reader.tools.teacher", { defaultValue: "Teacher" })}
                {activeDoc?.currentPage
                  ? ` · ${t("reader.sidebar.page", { n: activeDoc.currentPage })}`
                  : ""}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {t("reader.aiChat.emptyPrompt")}
            </p>
            {showResume && (
              <button
                type="button"
                onClick={() =>
                  void handleSubmit({
                    text: resumePrompt,
                    provider: null,
                    mode: "default",
                    attachments: [],
                    reasoning: false,
                  })
                }
                className="chip inline-flex w-max items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary cursor-pointer"
              >
                <Sparkles size={13} strokeWidth={1.5} />
                {t("reader.aiChat.resumeSummary", {
                  defaultValue: "Summarize where I left off (p.{{page}})",
                  page: activeDoc?.currentPage ?? 1,
                })}
              </button>
            )}
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
                    undefined,
                    parent.attachments ?? undefined,
                  );
                }
              : undefined;
          const handleEdit =
            msg.role === "user"
              ? (newText: string) => {
                  void branchFrom(
                    msg.parent_message_id,
                    newText,
                    undefined,
                    msg.attachments ?? undefined,
                  );
                }
              : undefined;
          return (
            <div
              key={msg.id}
              className={cn(
                msg.role === "assistant" &&
                  "reader-margin-card rounded-panel bg-bg-tertiary px-3.5 py-3 text-[13.5px] leading-[1.55] shadow-page",
              )}
            >
              {msg.role === "assistant" && (
                <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
                  <Sparkles size={14} strokeWidth={1.5} />
                  <span className="truncate">
                    {t("reader.tools.teacher", { defaultValue: "Teacher" })}
                    {activeConversation?.source_page
                      ? ` · ${t("reader.sidebar.page", { n: activeConversation.source_page })}`
                      : ""}
                  </span>
                </div>
              )}
            <MessageBubble
              msg={msg}
              messages={messages}
              activeLeafId={activeLeafId}
              streamingMessageId={streamingMessageId}
              sourceDocId={sourceDocId}
              confirm={confirm}
              tts={tts}
              onBranchHere={() => setBranchFromId(msg.id)}
              onPickBranch={setActiveLeaf}
              onRegenerate={handleRegenerate}
              onEdit={handleEdit}
              onDelete={async () => {
                const ok = await confirm({
                  title: t("chat.confirmDeleteMessageTitle", {
                    defaultValue: "Delete this message?",
                  }),
                  body: t("chat.confirmDeleteMessageBody", {
                    defaultValue:
                      "Every reply and follow-up underneath this message will also be removed. The deletion is permanent.",
                  }),
                  confirmLabel: t("common.delete"),
                  danger: true,
                });
                if (!ok) return;
                await useChatStore.getState().deleteMessage(msg.id);
              }}
              onDuplicate={async () => {
                await useChatStore
                  .getState()
                  .duplicateFromMessage(msg.id);
              }}
            />
            </div>
          );
        })}

        {/* thinking pill covering the gap before the assistant placeholder lands */}
        {isStreaming &&
          path[path.length - 1]?.id === streamingMessageId &&
          path[path.length - 1]?.role !== "assistant" && (
            <div className="mr-auto rounded-panel bg-bg-tertiary px-3.5 py-3 text-sm text-text-muted shadow-page">
              <TypingIndicator label={t("reader.aiChat.thinking")} />
            </div>
          )}
      </div>

      {/* context the next message carries. PDFs get the inline page-picker,
          other formats fall back to the sidebar editor route. */}
      <ContextSummaryPill
        tocAvailable={(activeDoc?.toc.length ?? 0) > 0}
        tocAttached={aiAttachToc}
        selectedPages={activeDoc?.aiSelectedPages.size ?? 0}
        hasPersona={aiCustomDefaultContext.trim().length > 0}
        onPickPages={
          activeDoc?.meta.format === "pdf"
            ? () => setPagePickerOpen((v) => !v)
            : undefined
        }
      />
      {pagePickerOpen && activeDoc?.meta.format === "pdf" && (
        <InlineAiPagePicker onClose={() => setPagePickerOpen(false)} />
      )}
      {/* reading-context omitted here since the current book is the context */}
      <div className="space-y-2 px-3 pb-3 pt-1">
        {/* branch banner: next submit branches from the picked bubble */}
        {branchFromId && messages.get(branchFromId) && (
          <div className="flex items-center justify-between gap-2 rounded-control bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5 min-w-0">
              <GitBranch size={12} className="shrink-0" />
              <span className="truncate">
                {t("chat.branchingFrom", {
                  snippet:
                    messages.get(branchFromId)!.content.slice(0, 48) +
                    (messages.get(branchFromId)!.content.length > 48
                      ? "…"
                      : ""),
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
        {(activeDoc?.aiSelectedPages.size ?? 0) > 0 && (
          <p className="rounded-control bg-bg-secondary px-2.5 py-1.5 text-2xs text-text-muted">
            {t("reader.aiChat.pagesContextNote", {
              defaultValue:
                'Pages with no text layer are sent as page images; figures on text pages aren\'t attached automatically, turn on "Send as images" in the page picker if you need them.',
            })}
          </p>
        )}
        {/* the ask pill: surface 2 + the one shadow, wraps the shared composer */}
        <div className="reader-ask-pill rounded-[22px] bg-bg-tertiary p-1.5 shadow-page">
          <ChatComposer
            ref={composerRef}
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
            onStop={() => useChatStore.getState().stopStreaming()}
            placeholderKey="reader.aiChat.placeholder"
          />
        </div>
      </div>

      {/* Conversation list overlay. Dismissed only via its header X, no
          tap-outside (avoids accidental mid-scroll close). */}
      <div
        className={cn(
          "absolute inset-0 z-20 flex flex-col bg-bg-primary transition-transform duration-200",
          listOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between gap-1 px-2 py-1">
          <button
            type="button"
            onClick={() => setListOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            aria-label={t("common.close")}
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {t("reader.aiChat.conversations")}
          </span>
          <button
            type="button"
            onClick={handleNewConversation}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            title={t("reader.aiChat.newConversationForDoc")}
            aria-label={t("reader.aiChat.newConversationForDoc")}
          >
            <Plus size={18} strokeWidth={1.5} />
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
                      "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                      c.id === activeConversationId
                        ? "bg-bg-tertiary text-text-primary"
                        : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
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

export function AiChatPanel(props: IDockviewPanelProps) {
  return <AiChatPanelContent onClose={() => props.api.close()} />;
}

