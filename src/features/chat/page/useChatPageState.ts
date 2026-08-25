/**
 * Page-level state for /chat: the chat-store slice the page composes from,
 * scope filtering, the initial-load "settling" layout logic (one place),
 * the reader hand-off draft, auto-open of the newest thread, the new-chat
 * shortcut (Ctrl+Shift+O and router `state.newChat`) and the composer
 * draft. Sidebar and thread own their own local state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore, pathFromRoot } from "@/stores/chat-store";

/**
 * When set, ChatPage runs in "book-scoped" mode: the sidebar lists only this
 * book's conversations (source_doc_id === docId), organized by fork lineage,
 * and every new conversation is tagged with the book so it lives beside it in
 * the library. Reached from a book page's "Chat" entry point.
 */
export interface ChatPageScope {
  docId: string;
  docTitle: string;
  /** Route to return to (the book page); shows a back button when present. */
  backTo?: string;
  backLabel?: string;
}

/** Source context new conversations inherit in book-scoped mode. */
export type ScopeSource = {
  docId: string;
  docTitle: string;
  page: null;
} | null;

/** Last settled sheet layout, read on the next /chat mount so the composer
 *  starts where it will most likely end up (see `settling`). */
const SHEET_LAYOUT_KEY = "pnyxy-chat:sheet-layout";

export function useChatPageState(scope?: ChatPageScope) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const {
    conversations,
    activeId,
    activeLeafId,
    messages,
    streamingMessageId,
    isLoading,
    pendingDraft,
    fetchConversations,
    fetchFolders,
    createConversation,
    openConversation,
    ensureQuickChatsFolder,
  } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeConversationId,
      activeLeafId: s.activeLeafId,
      messages: s.messages,
      streamingMessageId: s.streamingMessageId,
      isLoading: s.isLoading,
      pendingDraft: s.pendingDraft,
      fetchConversations: s.fetchConversations,
      fetchFolders: s.fetchFolders,
      createConversation: s.createConversation,
      openConversation: s.openConversation,
      ensureQuickChatsFolder: s.ensureQuickChatsFolder,
    })),
  );
  const { confirm, ConfirmModalElement } = useConfirm();

  // Drill-in: when set, the sidebar tree treats this folder as its root so
  // the user can focus on one topic. null = the general (all chats) view.
  // Lives here (not in the sidebar) because a new chat lands in it.
  const [chatRootFolderId, setChatRootFolderId] = useState<string | null>(null);

  // in book-scoped mode, only this book's conversations (forks copy the
  // source_doc_id, so they come along too)
  const visibleConversations = useMemo(
    () =>
      scope
        ? conversations.filter((c) => c.source_doc_id === scope.docId)
        : conversations,
    [scope, conversations],
  );
  // new conversations started here inherit the book as their source context
  const scopeSource = useMemo<ScopeSource>(
    () =>
      scope
        ? { docId: scope.docId, docTitle: scope.docTitle, page: null }
        : null,
    [scope],
  );

  const [input, setInput] = useState("");
  // mobile-only slide-in conversation drawer
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);

  // True once the first conversation-list fetch has settled. Until then we
  // cannot know whether a thread will be auto-opened, so the sheet stays in
  // a neutral "settling" layout instead of flashing the empty headline.
  const [listFetched, setListFetched] = useState(false);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchConversations().finally(() => {
      if (!cancelled) setListFetched(true);
    });
    fetchFolders();
    return () => {
      cancelled = true;
    };
  }, [user, fetchConversations, fetchFolders]);

  // reader hand-off: drain a stashed draft on mount, create a source-tagged
  // conversation and prefill the composer
  useEffect(() => {
    if (!user) return;
    // reader hand-off drafts always target the global /chat page, not a
    // book-scoped one
    if (scope) return;
    const draft = useChatStore.getState().consumePendingDraft();
    if (!draft) return;
    // prefill before the await so the draft survives an upstream error
    setInput(draft.text);
    void (async () => {
      // createConversation already opens it (sets active + empty thread)
      await createConversation(
        "",
        null,
        draft.source ?? null,
        draft.target ?? null,
      );
    })();
    // drain once per mount / sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // book-scoped: if the store's active conversation belongs to another book
  // (leftover from the global /chat), drop it so we snap to this book's thread
  useEffect(() => {
    if (!scope || !activeId) return;
    const active = conversations.find((c) => c.id === activeId);
    if (active && active.source_doc_id === scope.docId) return;
    useChatStore.getState().clearActive();
  }, [scope, activeId, conversations]);

  // auto-open the most recent conversation on a fresh /chat, unless a
  // reader-handoff draft is in flight
  useEffect(() => {
    if (!user) return;
    if (activeId) return;
    if (visibleConversations.length === 0) return;
    if (!scope && useChatStore.getState().pendingDraft !== null) return;
    void openConversation(visibleConversations[0].id);
  }, [user, activeId, visibleConversations, openConversation, scope]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // export the active thread as Markdown
  const handleExportActive = useCallback(() => {
    if (!activeConversation) return;
    const md = conversationToMarkdown(
      activeConversation,
      messages,
      activeLeafId,
    );
    downloadMarkdown(
      activeConversation.title.trim() || t("chat.untitled"),
      md,
    );
  }, [activeConversation, messages, activeLeafId, t]);

  const threadPath = useMemo(
    () => pathFromRoot(messages, activeLeafId),
    [messages, activeLeafId],
  );
  // no conversation open, or an open one with nothing in it yet (and not
  // mid-load): drives the centered-composer empty state
  //
  // `isLoading` is shared by the list fetch and the thread fetch, so a list
  // fetch finishing while a thread is still loading (StrictMode's double
  // mount, a refresh after a send) briefly reads as "open and empty". The
  // list row already says whether the thread has messages (a stored
  // active leaf), so treat "leaf known, nothing rendered yet" as loading.
  const threadLoading =
    !!activeId &&
    threadPath.length === 0 &&
    (isLoading ||
      (messages.size === 0 &&
        !!conversations.find((c) => c.id === activeId)?.active_leaf_id));
  const threadEmpty = !activeId || (threadPath.length === 0 && !threadLoading);

  // Initial load: the list fetch, the pending auto-open of the newest
  // conversation, and that conversation's message fetch all happen before
  // we know the final layout. While any of them is in flight the sheet
  // "settles": the composer keeps one position, the headline is reserved
  // but invisible, and the spinner is overlaid so nothing reflows.
  const autoOpenPending =
    !activeId &&
    visibleConversations.length > 0 &&
    (!!scope || pendingDraft === null);
  const settling =
    !!user &&
    (!listFetched || autoOpenPending || threadLoading);
  // Where the composer will end up. Before the list is in we go by the
  // last settled layout (a wrong guess costs one silent correction while
  // the headline is hidden); once the list is in, the conversation about
  // to open tells us: a stored active leaf means it has messages.
  const predictedEmpty = useMemo(() => {
    if (listFetched) {
      const target = activeId
        ? conversations.find((c) => c.id === activeId)
        : visibleConversations[0];
      return !target || !target.active_leaf_id;
    }
    try {
      return localStorage.getItem(SHEET_LAYOUT_KEY) !== "bottom";
    } catch {
      return true;
    }
  }, [listFetched, activeId, conversations, visibleConversations]);
  const sheetCentered = settling ? predictedEmpty : threadEmpty;
  useEffect(() => {
    if (settling || !user) return;
    try {
      localStorage.setItem(SHEET_LAYOUT_KEY, threadEmpty ? "centered" : "bottom");
    } catch {
      /* storage unavailable, next visit falls back to the centered guess */
    }
  }, [settling, threadEmpty, user]);

  const composerWrapRef = useRef<HTMLDivElement>(null);
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      composerWrapRef.current?.querySelector("textarea")?.focus();
    });
  }, []);

  const handleNew = async () => {
    setMobileListOpen(false);
    // In a drilled view a new quick chat goes into that folder's own "Quick
    // chats" subfolder; otherwise the shared one (createConversation handles
    // null -> shared).
    const target = chatRootFolderId
      ? await ensureQuickChatsFolder(chatRootFolderId)
      : null;
    // createConversation already sets it active with an empty thread, no need
    // for a second openConversation round-trip (that was the visible lag).
    await createConversation("", target, scopeSource);
    focusComposer();
  };
  const handleNewRef = useRef(handleNew);
  handleNewRef.current = handleNew;

  // Ctrl+Shift+O (Cmd on Mac): new chat + focus the composer.
  useKeyboardShortcut({
    id: "chat:new",
    key: "o",
    ctrl: true,
    shift: true,
    description: "New chat",
    handler: useCallback(() => void handleNewRef.current(), []),
  });

  // Arrived via the global shortcut / a "new chat" link: state carries a
  // timestamp so repeated presses while already here start another one.
  const location = useLocation();
  const newChatStamp = (location.state as { newChat?: number } | null)?.newChat;
  const lastNewChatStamp = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!newChatStamp || newChatStamp === lastNewChatStamp.current) return;
    lastNewChatStamp.current = newChatStamp;
    if (!user) return;
    void handleNewRef.current();
  }, [newChatStamp, user]);

  // empty-state suggestion chip: prefill the composer (already on screen in
  // the empty state) and, when no conversation is open yet, open a fresh one
  const handleEmptySuggestion = (text: string) => {
    setInput(text);
    if (!activeId) void handleNew();
  };

  const branchParent = branchFromId ? messages.get(branchFromId) : null;
  const activeTitle = activeConversation
    ? activeConversation.title || t("chat.untitled")
    : t("chat.title");
  const headerBook = activeConversation?.source_doc_title ?? scope?.docTitle;

  return {
    user,
    scopeSource,
    visibleConversations,
    activeId,
    activeConversation,
    messages,
    activeLeafId,
    streamingMessageId,
    threadPath,
    settling,
    threadLoading,
    sheetCentered,
    input,
    setInput,
    branchFromId,
    setBranchFromId,
    branchParent,
    mobileListOpen,
    setMobileListOpen,
    chatRootFolderId,
    setChatRootFolderId,
    composerWrapRef,
    handleNew,
    handleEmptySuggestion,
    handleExportActive,
    confirm,
    ConfirmModalElement,
    activeTitle,
    headerBook,
  };
}

export type ConfirmFn = ReturnType<typeof useConfirm>["confirm"];
