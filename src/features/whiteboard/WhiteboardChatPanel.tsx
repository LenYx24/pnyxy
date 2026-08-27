import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BotMessageSquare, Eye, ImagePlus, SquarePen, X } from "lucide-react";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";
import {
  ChatComposer,
  type ChatComposerHandle,
  type ChatComposerSubmitPayload,
} from "@/features/chat/ChatComposer";
import { ContextInspectorModal } from "@/features/chat/ContextInspectorModal";
import { MessageBubble } from "@/features/chat/MessageBubble";
import { useAuthStore } from "@/stores/auth-store";
import { useConfirm } from "@/hooks/use-confirm";
import { useReadAloud } from "@/hooks/use-read-aloud";
import { TypingIndicator } from "@/components/ui";
import type { ChatMessage, ChatMessageAttachment } from "@/types/chat";
import { captureBoardImage } from "./board-capture";

const EMPTY_PATH: ChatMessage[] = [];

interface WhiteboardChatPanelProps {
  /** Scopes the conversations. Book-scoped when the board belongs to a book,
   *  otherwise scoped to the whiteboard itself. */
  scopeId: string;
  scopeTitle: string;
  onClose: () => void;
}

/**
 * AI chat sidebar for the whiteboard. Reuses the chat store + composer, with
 * conversations scoped to the board's book. The "attach board" button snapshots
 * the canvas so the model can see the drawing (image context).
 */
export function WhiteboardChatPanel({
  scopeId,
  scopeTitle,
  onClose,
}: WhiteboardChatPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

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

  const { confirm, ConfirmModalElement } = useConfirm();
  const tts = useReadAloud();
  const isStreaming = streamingMessageId !== null;

  const [input, setInput] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const composerRef = useRef<ChatComposerHandle>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // only surface a conversation that belongs to this board/book scope
  const activeConversation = useMemo(() => {
    const conv =
      conversations.find((c) => c.id === activeConversationId) ?? null;
    if (!conv || conv.source_doc_id !== scopeId) return null;
    return conv;
  }, [conversations, activeConversationId, scopeId]);
  const activeIsForScope = activeConversation !== null;

  const path = useMemo(
    () =>
      activeIsForScope ? pathFromRoot(messages, activeLeafId) : EMPTY_PATH,
    [messages, activeLeafId, activeIsForScope],
  );

  useEffect(() => {
    if (!user) return;
    void fetchConversations();
  }, [user, fetchConversations]);

  // snap to the scope's most recent conversation once the list is loaded
  const snappedRef = useRef(false);
  useEffect(() => {
    if (!user || snappedRef.current) return;
    if (isChatLoading && conversations.length === 0) return;
    const candidates = conversations.filter((c) => c.source_doc_id === scopeId);
    if (candidates.length > 0) void openConversation(candidates[0].id);
    else clearActive();
    snappedRef.current = true;
  }, [
    user,
    isChatLoading,
    conversations,
    scopeId,
    openConversation,
    clearActive,
  ]);

  const lastContent = path[path.length - 1]?.content ?? "";
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [path.length, lastContent]);

  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const trimmed = payload.text.trim();
      if (!trimmed && payload.attachments.length === 0) return;
      if (isStreaming || !user) return;
      setInput("");
      if (!activeIsForScope) {
        try {
          await createConversation(
            trimmed.slice(0, 60),
            null,
            { docId: scopeId, docTitle: scopeTitle, page: null },
            null,
          );
        } catch {
          return;
        }
      }
      await sendMessage(
        trimmed,
        payload.provider ?? undefined,
        payload.attachments.length > 0 ? payload.attachments : undefined,
        { scope: "whiteboard", ...(payload.reasoning ? { reasoning: true } : {}) },
      );
    },
    [
      isStreaming,
      user,
      activeIsForScope,
      createConversation,
      scopeId,
      scopeTitle,
      sendMessage,
    ],
  );

  const handleNew = useCallback(async () => {
    if (!user) return;
    try {
      await createConversation(
        "",
        null,
        { docId: scopeId, docTitle: scopeTitle, page: null },
        null,
      );
    } catch {
      // surfaced via store error UI
    }
  }, [user, createConversation, scopeId, scopeTitle]);

  const handleAttachBoard = useCallback(() => {
    const img = captureBoardImage();
    if (!img) return;
    const att: ChatMessageAttachment = {
      kind: "image",
      media_type: img.media_type,
      data: img.data,
      name: `board-${Date.now()}.png`,
    };
    composerRef.current?.addAttachments([att]);
  }, []);

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-secondary p-6 text-center">
        <BotMessageSquare size={28} className="text-text-muted" />
        <p className="text-sm text-text-secondary">
          {t("reader.aiChat.signInRequired")}
        </p>
        <button
          type="button"
          onClick={() => navigate("/auth")}
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/80 cursor-pointer"
        >
          {t("chat.signInRequired")}
        </button>
      </div>
    );
  }

  const iconBtn =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer";

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <div className="flex items-center gap-0.5 border-b border-glass-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {activeIsForScope
            ? activeConversation?.title || t("chat.untitled")
            : t("whiteboard.chat.title")}
        </span>
        <button
          type="button"
          onClick={() => setInspectorOpen(true)}
          className={iconBtn}
          title={t("chat.contextInspector.open")}
          aria-label={t("chat.contextInspector.open")}
          aria-haspopup="dialog"
        >
          <Eye size={17} />
        </button>
        <button
          type="button"
          onClick={handleAttachBoard}
          className={iconBtn}
          title={t("whiteboard.chat.attachBoard")}
          aria-label={t("whiteboard.chat.attachBoard")}
        >
          <ImagePlus size={17} />
        </button>
        <button
          type="button"
          onClick={handleNew}
          className={iconBtn}
          title={t("chat.newConversation")}
          aria-label={t("chat.newConversation")}
        >
          <SquarePen size={17} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className={iconBtn}
          aria-label={t("common.close")}
        >
          <X size={17} />
        </button>
      </div>

      <div
        ref={messagesContainerRef}
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-3"
      >
        {!activeIsForScope && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BotMessageSquare size={24} className="text-text-muted/50" />
            <p className="text-xs text-text-muted">
              {t("whiteboard.chat.empty")}
            </p>
          </div>
        )}
        {path.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            messages={messages}
            activeLeafId={activeLeafId}
            streamingMessageId={streamingMessageId}
            sourceDocId={null}
            confirm={confirm}
            tts={tts}
            onBranchHere={() => {}}
            onPickBranch={setActiveLeaf}
            onRegenerate={
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
                : undefined
            }
            onEdit={
              msg.role === "user"
                ? (newText: string) =>
                    void branchFrom(
                      msg.parent_message_id,
                      newText,
                      undefined,
                      msg.attachments ?? undefined,
                    )
                : undefined
            }
          />
        ))}
        {isStreaming &&
          path[path.length - 1]?.id === streamingMessageId &&
          path[path.length - 1]?.role !== "assistant" && (
            <div className="mr-auto rounded-2xl rounded-bl-md bg-glass-bg px-3.5 py-3 text-sm text-text-muted">
              <TypingIndicator label={t("reader.aiChat.thinking")} />
            </div>
          )}
      </div>

      <div className="p-2">
        <ChatComposer
          ref={composerRef}
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          onStop={() => useChatStore.getState().stopStreaming()}
        />
      </div>
      {ConfirmModalElement}
      <ContextInspectorModal
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        docId={scopeId}
        docTitle={scopeTitle}
        conversationId={activeIsForScope ? activeConversationId : null}
      />
    </div>
  );
}
