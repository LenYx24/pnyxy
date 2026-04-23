import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MessagesSquare,
  Plus,
  Send,
  Loader2,
  GitBranch,
  Trash2,
  Pencil,
  X,
  Check,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import {
  useChatStore,
  pathFromRoot,
  countBranches,
  childrenOf,
} from "@/stores/chat-store";
import type { ChatMessage } from "@/types/chat";

export function ChatPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const messages = useChatStore((s) => s.messages);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const isLoading = useChatStore((s) => s.isLoading);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const openConversation = useChatStore((s) => s.openConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const clearActive = useChatStore((s) => s.clearActive);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);

  const [input, setInput] = useState("");
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user, fetchConversations]);

  // Auto-scroll to the latest message as stream tokens arrive.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeLeafId, messages, streamingMessageId]);

  const threadPath = useMemo(
    () => pathFromRoot(messages, activeLeafId),
    [messages, activeLeafId],
  );

  const handleNew = async () => {
    const id = await createConversation();
    if (id) await openConversation(id);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (branchFromId) {
      const parentId = branchFromId;
      setBranchFromId(null);
      await branchFrom(parentId, text);
    } else {
      if (!activeId) {
        const id = await createConversation();
        if (!id) return;
        await openConversation(id);
      }
      await sendMessage(text);
    }
  };

  const handleSaveTitle = async (id: string) => {
    await renameConversation(id, editTitle.trim() || t("chat.untitled"));
    setEditingId(null);
  };

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="text-center">
          <MessagesSquare size={36} className="mx-auto mb-3 text-text-muted/50" />
          <p className="text-sm text-text-primary font-medium">
            {t("chat.signInRequired")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("chat.signInHint")}
          </p>
        </div>
      </div>
    );
  }

  const branchParent = branchFromId ? messages.get(branchFromId) : null;

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-6xl gap-0 p-0 sm:h-screen sm:gap-4 sm:p-4">
      {/* Sidebar: conversations list */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 rounded-xl border border-glass-border bg-glass-bg/40 p-2 sm:flex">
        <button
          onClick={handleNew}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-glass-border bg-glass-bg/30 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <Plus size={14} />
          {t("chat.newConversation")}
        </button>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-text-muted">
              {t("chat.sidebar.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => {
                const isActive = c.id === activeId;
                const isEditing = editingId === c.id;
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
                      isActive
                        ? "bg-accent-purple/15 text-accent-purple"
                        : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                    )}
                  >
                    {isEditing ? (
                      <>
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveTitle(c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent-purple"
                        />
                        <button
                          onClick={() => handleSaveTitle(c.id)}
                          className="rounded p-1 text-green-400 hover:bg-glass-hover cursor-pointer"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => openConversation(c.id)}
                          className="flex-1 min-w-0 truncate text-left text-xs cursor-pointer"
                        >
                          {c.title || t("chat.untitled")}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setEditTitle(c.title);
                          }}
                          className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
                          aria-label={t("chat.rename")}
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => deleteConversation(c.id)}
                          className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                          aria-label={t("chat.delete")}
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: new convo button at top */}
        <div className="flex items-center gap-2 border-b border-glass-border bg-bg-primary/40 px-3 py-2 sm:hidden">
          {activeId && (
            <button
              onClick={clearActive}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              aria-label={t("chat.backToList")}
            >
              <ChevronRight size={16} className="rotate-180" />
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {activeId
              ? conversations.find((c) => c.id === activeId)?.title ||
                t("chat.untitled")
              : t("chat.title")}
          </span>
          <button
            onClick={handleNew}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.newConversation")}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Mobile: conversation list when nothing open */}
        {!activeId && (
          <div className="flex-1 overflow-y-auto p-3 sm:hidden">
            {conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <MessagesSquare size={36} className="mx-auto mb-3 text-text-muted/50" />
                  <p className="text-sm font-medium text-text-primary">
                    {t("chat.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {t("chat.emptyBody")}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openConversation(c.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2 text-left text-sm transition-colors hover:bg-glass-hover"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {c.title || t("chat.untitled")}
                      </span>
                      <ChevronRight size={14} className="text-text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Desktop empty state */}
        {!activeId && (
          <div className="hidden flex-1 items-center justify-center sm:flex">
            <div className="text-center">
              <MessagesSquare
                size={40}
                className="mx-auto mb-3 text-text-muted/50"
              />
              <p className="text-sm font-medium text-text-primary">
                {t("chat.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("chat.emptyBody")}
              </p>
              <button
                onClick={handleNew}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-purple px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-purple/80 cursor-pointer"
              >
                <Plus size={14} />
                {t("chat.newConversation")}
              </button>
            </div>
          </div>
        )}

        {/* Active conversation — thread */}
        {activeId && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {isLoading && threadPath.length === 0 && (
                <p className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 size={12} className="animate-spin" />
                  {t("chat.loading")}
                </p>
              )}

              {threadPath.length === 0 && !isLoading && (
                <p className="text-center text-xs text-text-muted">
                  {t("chat.newConversationHint")}
                </p>
              )}

              {threadPath.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  messages={messages}
                  activeLeafId={activeLeafId}
                  streamingMessageId={streamingMessageId}
                  onBranchHere={() => setBranchFromId(msg.id)}
                  onPickBranch={setActiveLeaf}
                />
              ))}
              <div ref={threadEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-glass-border bg-bg-primary/30 p-3">
              {branchParent && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-accent-purple/30 bg-accent-purple/10 px-2 py-1.5 text-xs text-accent-purple">
                  <span className="flex items-center gap-1.5">
                    <GitBranch size={12} />
                    {t("chat.branchingFrom", {
                      snippet:
                        branchParent.content.slice(0, 48) +
                        (branchParent.content.length > 48 ? "…" : ""),
                    })}
                  </span>
                  <button
                    onClick={() => setBranchFromId(null)}
                    className="rounded p-0.5 hover:bg-accent-purple/20 cursor-pointer"
                    aria-label={t("common.cancel")}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={t("chat.composerPlaceholder")}
                  rows={1}
                  className="min-h-[2.5rem] max-h-[12rem] flex-1 resize-none rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple"
                  disabled={streamingMessageId !== null}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || streamingMessageId !== null}
                  className={cn(
                    "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
                    input.trim() && streamingMessageId === null
                      ? "bg-accent-purple text-white hover:bg-accent-purple/80"
                      : "bg-glass-bg text-text-muted",
                  )}
                  aria-label={t("chat.send")}
                >
                  {streamingMessageId !== null ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MessageBubble({
  msg,
  messages,
  activeLeafId,
  streamingMessageId,
  onBranchHere,
  onPickBranch,
}: {
  msg: ChatMessage;
  messages: Map<string, ChatMessage>;
  activeLeafId: string | null;
  streamingMessageId: string | null;
  onBranchHere: () => void;
  onPickBranch: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  const isStreaming = msg.id === streamingMessageId;
  const branches = countBranches(messages, msg.id);
  const [showBranches, setShowBranches] = useState(false);

  // Which child of this message is on the active path (if any)?
  const activePath = pathFromRoot(messages, activeLeafId).map((m) => m.id);
  const activeChildId = childrenOf(messages, msg.id).find((c) =>
    activePath.includes(c.id),
  )?.id;

  return (
    <div
      className={cn(
        "group flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-accent-purple/20 text-text-primary"
            : "bg-glass-bg text-text-secondary",
          isStreaming && "animate-pulse",
        )}
      >
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>

        {/* Actions: visible on hover or when there are branches */}
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[10px] text-text-muted transition-opacity",
            branches > 1 || showBranches
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            onClick={onBranchHere}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            title={t("chat.branchHere")}
          >
            <GitBranch size={10} />
            {t("chat.branchHere")}
          </button>
          {branches > 1 && (
            <button
              onClick={() => setShowBranches((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              {t("chat.branchesCount", { count: branches })}
            </button>
          )}
        </div>

        {/* Branch switcher */}
        {showBranches && branches > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {childrenOf(messages, msg.id).map((child, i) => {
              const isActiveChild = child.id === activeChildId;
              return (
                <button
                  key={child.id}
                  onClick={() => onPickBranch(child.id)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] transition-colors cursor-pointer",
                    isActiveChild
                      ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
                      : "border-glass-border text-text-muted hover:border-accent-purple/40 hover:text-text-primary",
                  )}
                  title={child.content.slice(0, 80)}
                >
                  {t("chat.branchN", { n: i + 1 })}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
