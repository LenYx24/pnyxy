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
  ChevronDown,
  Mic,
  MicOff,
  FolderPlus,
  Folder as FolderIcon,
  FolderInput,
} from "lucide-react";
import { FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import {
  useChatStore,
  pathFromRoot,
  countBranches,
  childrenOf,
} from "@/stores/chat-store";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { getConfiguredProviders } from "@/lib/ai-client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import type { ChatMessage } from "@/types/chat";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Claude",
  openai: "GPT",
};

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
  const moveConversationToFolder = useChatStore((s) => s.moveConversationToFolder);
  const clearActive = useChatStore((s) => s.clearActive);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const folders = useChatStore((s) => s.folders);
  const fetchFolders = useChatStore((s) => s.fetchFolders);
  const createFolder = useChatStore((s) => s.createFolder);
  const renameFolder = useChatStore((s) => s.renameFolder);
  const deleteFolder = useChatStore((s) => s.deleteFolder);

  const [input, setInput] = useState("");
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Per-conversation provider override. Initial value = the first
  // currently-configured provider (mirrors the saved fallback chain).
  // The dropdown is always present; if the user has only Pnyxy
  // enabled, it just shows Pnyxy with no other choices.
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // configuration changes when settings change — re-evaluate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(
    () => configuredProviders[0] ?? "pnyxy",
  );
  // If the user disables the picked provider, fall back to whatever's
  // first in the still-configured list — better than holding a stale
  // value that streamChatResponse will silently ignore.
  useEffect(() => {
    if (!configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(configuredProviders[0] ?? "pnyxy");
    }
  }, [configuredProviders, selectedProvider]);

  // Speech-to-text — appends finalized chunks to the textarea, leaves
  // partial / interim results dropped (could surface as a ghost line
  // later if it reads as choppy).
  const speech = useSpeechRecognition({
    onResult: (text) => {
      setInput((prev) =>
        prev
          ? prev + (prev.endsWith(" ") ? "" : " ") + text.trim()
          : text.trim(),
      );
    },
  });

  useEffect(() => {
    if (user) {
      fetchConversations();
      fetchFolders();
    }
  }, [user, fetchConversations, fetchFolders]);

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
    // Stop dictation when the user submits — otherwise the next
    // utterance lands on the now-empty textarea and looks like a
    // ghost transcript.
    if (speech.listening) speech.stop();
    if (branchFromId) {
      const parentId = branchFromId;
      setBranchFromId(null);
      await branchFrom(parentId, text, selectedProvider);
    } else {
      if (!activeId) {
        const id = await createConversation();
        if (!id) return;
        await openConversation(id);
      }
      await sendMessage(text, selectedProvider);
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
      {/* Sidebar: folder tree + conversations */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 rounded-xl border border-glass-border bg-glass-bg/40 p-2 sm:flex">
        <div className="flex items-center gap-1">
          <button
            onClick={handleNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-glass-border bg-glass-bg/30 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Plus size={14} />
            {t("chat.newConversation")}
          </button>
          <button
            onClick={async () => {
              const name = prompt(t("chat.folders.namePrompt"));
              if (name?.trim()) await createFolder(name.trim());
            }}
            title={t("chat.folders.create")}
            aria-label={t("chat.folders.create")}
            className="rounded-md border border-dashed border-glass-border bg-glass-bg/30 p-2 text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <FolderPlus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && folders.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-text-muted">
              {t("chat.sidebar.empty")}
            </p>
          ) : (
            <ChatTree
              folders={folders}
              conversations={conversations}
              activeId={activeId}
              editingId={editingId}
              editTitle={editTitle}
              onOpen={openConversation}
              onStartEdit={(id, title) => {
                setEditingId(id);
                setEditTitle(title);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveTitle={handleSaveTitle}
              onEditTitleChange={setEditTitle}
              onDelete={deleteConversation}
              onMove={moveConversationToFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
              t={t}
            />
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
              {/* Model picker + mic + send. The model dropdown is
                  always rendered (defaults to Pnyxy) so picking a
                  model feels first-class rather than buried in
                  settings. The mic only appears when the browser
                  exposes the Web Speech API. */}
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      <span className="font-medium uppercase tracking-wider">
                        {t("chat.composer.modelLabel")}
                      </span>
                      <select
                        value={selectedProvider}
                        onChange={(e) =>
                          setSelectedProvider(e.target.value as AiProvider)
                        }
                        className="rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-secondary outline-none focus:border-accent-purple"
                      >
                        {configuredProviders.map((p) => (
                          <option key={p} value={p}>
                            {PROVIDER_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {speech.error && (
                      <span className="text-[11px] text-red-400">
                        {speech.error === "not-allowed"
                          ? t("chat.composer.micDenied")
                          : t("chat.composer.micError")}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={
                      speech.listening
                        ? t("chat.composer.listeningPlaceholder")
                        : t("chat.composerPlaceholder")
                    }
                    rows={1}
                    className={cn(
                      "min-h-[2.5rem] max-h-[12rem] resize-none rounded-lg border bg-glass-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors",
                      speech.listening
                        ? "border-accent-purple ring-2 ring-accent-purple/30"
                        : "border-glass-border focus:border-accent-purple",
                    )}
                    disabled={streamingMessageId !== null}
                  />
                </div>
                {speech.supported && (
                  <button
                    onClick={() =>
                      speech.listening ? speech.stop() : speech.start()
                    }
                    disabled={streamingMessageId !== null}
                    className={cn(
                      "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
                      speech.listening
                        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        : "bg-glass-bg text-text-muted hover:bg-glass-hover hover:text-text-primary",
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
                    {speech.listening ? (
                      <MicOff size={16} />
                    ) : (
                      <Mic size={16} />
                    )}
                  </button>
                )}
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

// ── Sidebar tree ────────────────────────────────────────────

interface ChatTreeProps {
  folders: import("@/types/chat").ChatFolder[];
  conversations: import("@/types/chat").ChatConversation[];
  activeId: string | null;
  editingId: string | null;
  editTitle: string;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ChatTree(props: ChatTreeProps) {
  const { folders, conversations } = props;
  // Index conversations and child folders by parent for cheap lookup.
  // Folder tree is flat-with-parent_id; we render recursively from
  // the roots (parent_id === null) downward.
  const childFolders = useMemo(() => {
    const m = new Map<string | null, typeof folders>();
    for (const f of folders) {
      const arr = m.get(f.parent_id) ?? [];
      arr.push(f);
      m.set(f.parent_id, arr);
    }
    return m;
  }, [folders]);
  const folderConversations = useMemo(() => {
    const m = new Map<string | null, typeof conversations>();
    for (const c of conversations) {
      const arr = m.get(c.folder_id) ?? [];
      arr.push(c);
      m.set(c.folder_id, arr);
    }
    return m;
  }, [conversations]);

  // Root: loose conversations first, then top-level folders.
  return (
    <div className="flex flex-col gap-0.5">
      {(folderConversations.get(null) ?? []).map((c) => (
        <ConversationRow key={c.id} conversation={c} depth={0} {...props} />
      ))}
      {(childFolders.get(null) ?? []).map((f) => (
        <FolderRow
          key={f.id}
          folder={f}
          depth={0}
          childFolders={childFolders}
          folderConversations={folderConversations}
          {...props}
        />
      ))}
    </div>
  );
}

interface FolderRowProps extends ChatTreeProps {
  folder: import("@/types/chat").ChatFolder;
  depth: number;
  childFolders: Map<string | null, import("@/types/chat").ChatFolder[]>;
  folderConversations: Map<string | null, import("@/types/chat").ChatConversation[]>;
}

function FolderRow({
  folder,
  depth,
  childFolders,
  folderConversations,
  ...rest
}: FolderRowProps) {
  const [expanded, setExpanded] = useState(true);
  const subFolders = childFolders.get(folder.id) ?? [];
  const subConversations = folderConversations.get(folder.id) ?? [];
  const t = rest.t;
  return (
    <>
      <div
        className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <FolderIcon size={12} className="shrink-0 text-text-muted" />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium cursor-pointer"
          title={folder.name}
        >
          {folder.name}
        </button>
        <button
          onClick={() => {
            const next = prompt(t("chat.folders.renamePrompt"), folder.name);
            if (next?.trim()) rest.onRenameFolder(folder.id, next.trim());
          }}
          className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
          aria-label={t("chat.folders.rename")}
        >
          <Pencil size={10} />
        </button>
        <button
          onClick={() => {
            if (confirm(t("chat.folders.deleteConfirm", { name: folder.name }))) {
              rest.onDeleteFolder(folder.id);
            }
          }}
          className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
          aria-label={t("chat.folders.delete")}
        >
          <Trash2 size={10} />
        </button>
      </div>
      {expanded && (
        <>
          {subConversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              depth={depth + 1}
              {...rest}
            />
          ))}
          {subFolders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              depth={depth + 1}
              childFolders={childFolders}
              folderConversations={folderConversations}
              {...rest}
            />
          ))}
        </>
      )}
    </>
  );
}

interface ConversationRowProps extends ChatTreeProps {
  conversation: import("@/types/chat").ChatConversation;
  depth: number;
}

function ConversationRow({
  conversation,
  depth,
  folders,
  activeId,
  editingId,
  editTitle,
  onOpen,
  onStartEdit,
  onCancelEdit,
  onSaveTitle,
  onEditTitleChange,
  onDelete,
  onMove,
  t,
}: ConversationRowProps) {
  const isActive = conversation.id === activeId;
  const isEditing = editingId === conversation.id;
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [showMove, setShowMove] = useState(false);

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
        isActive
          ? "bg-accent-purple/15 text-accent-purple"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {isEditing ? (
        <>
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveTitle(conversation.id);
              if (e.key === "Escape") onCancelEdit();
            }}
            className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent-purple"
          />
          <button
            onClick={() => onSaveTitle(conversation.id)}
            className="rounded p-1 text-green-400 hover:bg-glass-hover cursor-pointer"
          >
            <Check size={12} />
          </button>
          <button
            onClick={onCancelEdit}
            className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <span className="w-5 shrink-0" aria-hidden="true" />
          <button
            onClick={() => onOpen(conversation.id)}
            className="flex-1 min-w-0 truncate text-left text-xs cursor-pointer"
          >
            {conversation.title || t("chat.untitled")}
          </button>
          <button
            ref={moveBtnRef}
            onClick={() => setShowMove((v) => !v)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.moveTo")}
            title={t("chat.folders.moveTo")}
          >
            <FolderInput size={10} />
          </button>
          <FloatingMenu
            open={showMove}
            anchorRef={moveBtnRef}
            onClose={() => setShowMove(false)}
            className="w-48"
          >
            <button
              onClick={() => {
                onMove(conversation.id, null);
                setShowMove(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderIcon size={12} className="text-text-muted" />
              {t("chat.folders.root")}
            </button>
            {folders.length > 0 && (
              <div className="my-0.5 h-px bg-glass-border" />
            )}
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onMove(conversation.id, f.id);
                  setShowMove(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <FolderIcon size={12} className="text-text-muted" />
                {f.name}
              </button>
            ))}
          </FloatingMenu>
          <button
            onClick={() => onStartEdit(conversation.id, conversation.title)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.rename")}
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => onDelete(conversation.id)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.delete")}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}
