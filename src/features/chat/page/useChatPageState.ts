/**
 * Page-level state for /chat: the chat-store slice the page composes from,
 * scope filtering, the initial-load "settling" layout logic (one place),
 * the reader hand-off draft, auto-open of the newest thread, the new-chat
 * shortcut (Ctrl+Shift+O and router `state.newChat`) and the composer
 * draft. Sidebar and thread own their own local state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
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
    })),
  );
  const { confirm, ConfirmModalElement } = useConfirm();

  // Drill-in: when set, the sidebar tree treats this folder as its root so
  // the user can focus on one topic. null = the general (all chats) view.
  // Lives here (not in the sidebar) because a new chat lands in it.
  // Drilled sidebar folder lives in the URL (?folder=<id>) so a reload or a
  // shared link lands in the same folder and back/forward walks the drill-in.
  const [searchParams, setSearchParams] = useSearchParams();
  const chatRootFolderId = searchParams.get("folder");
  const setChatRootFolderId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("folder", id);
          else next.delete("folder");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // in book-scoped mode, only this book's conversations (forks copy the
  // source_doc_id, so they come along too)
  const visibleConversations = useMemo(
    () =>
      conversations.filter((c) => {
        // archived live under the quick view's Archive section only;
        // temporary chats never enter the history (their own stays open)
        if (c.archived_at) return false;
        if (c.is_temporary && c.id !== activeId) return false;
        return scope ? c.source_doc_id === scope.docId : true;
      }),
    [scope, conversations, activeId],
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

  // browser-extension hand-off: /chat?q=<selection>&src=<pageUrl>&title=<pageTitle>
  // (the "Ask Pnyxy about this" context-menu entry / popup). Turns into a
  // pending draft, quoted selection plus a source line, before the reader
  // hand-off effect below drains it. Deleting q/src/title from the URL as
  // soon as they're read makes this idempotent (StrictMode's double effect,
  // a re-render) without needing its own "already ran" guard.
  useEffect(() => {
    if (scope) return;
    const q = searchParams.get("q");
    if (!q) return;
    const src = searchParams.get("src");
    const title = searchParams.get("title");
    const quoted = q
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const lines = [quoted];
    if (src) {
      lines.push(
        "",
        t("chat.extension.sourceLine", { title: title || src, url: src }),
      );
    }
    useChatStore.getState().setPendingDraft({ text: lines.join("\n") });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("q");
        next.delete("src");
        next.delete("title");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, searchParams]);

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
    // (auto-send drafts go straight out as the first message instead)
    if (!draft.autoSend) setInput(draft.text);
    if (draft.folderId) setChatRootFolderId(draft.folderId);
    void (async () => {
      // createConversation already opens it (sets active + empty thread)
      await createConversation(
        "",
        draft.folderId ?? null,
        draft.source ?? null,
        draft.target ?? null,
      );
      if (draft.autoSend) {
        // the only autoSend producer today is the course "Start learning" seed
        await useChatStore
          .getState()
          .sendMessage(draft.text, undefined, undefined, { scope: "course" });
      }
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

  // Every conversation is addressable as /chat/:conversationId so threads
  // can be linked and reopened. Book-scoped pages keep their own routes.
  const params = useParams<{ conversationId?: string }>();
  const routeConvId = scope ? null : (params.conversationId ?? null);
  const navigate = useNavigate();
  const location = useLocation();

  // URL -> store: deep links and back/forward restore the thread
  useEffect(() => {
    if (!user || !routeConvId) return;
    if (useChatStore.getState().activeConversationId === routeConvId) return;
    void openConversation(routeConvId);
  }, [user, routeConvId, openConversation]);

  // store -> URL: whatever is open, the address bar is shareable
  useEffect(() => {
    if (scope || !user) return;
    // keep ?folder= (the drilled sidebar folder) across thread switches
    if (activeId && routeConvId !== activeId) {
      navigate(
        { pathname: `/chat/${activeId}`, search: location.search },
        { replace: true },
      );
    } else if (
      !activeId &&
      routeConvId &&
      // a deep link being opened right now (the effect above already set
      // the store synchronously) must not be stripped back to /chat
      useChatStore.getState().activeConversationId === null
    ) {
      navigate(
        { pathname: "/chat", search: location.search },
        { replace: true },
      );
    }
  }, [scope, user, activeId, routeConvId, navigate, location.search]);

  // auto-open the most recent conversation on a fresh /chat, unless a
  // reader-handoff draft is in flight or a deep link names the thread
  useEffect(() => {
    if (!user) return;
    if (activeId || routeConvId) return;
    if (visibleConversations.length === 0) return;
    if (!scope && useChatStore.getState().pendingDraft !== null) return;
    void openConversation(visibleConversations[0].id);
  }, [
    user,
    activeId,
    routeConvId,
    visibleConversations,
    openConversation,
    scope,
  ]);

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
    downloadMarkdown(activeConversation.title.trim() || t("chat.untitled"), md);
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
  // Warm remount: navigating back to /chat with a thread already in the
  // store (the SPA keeps it) needs no settling pass, render instantly;
  // the background list refetch changes nothing visible.
  const warmThread = !!activeId && !threadLoading;
  const settling =
    !!user && !warmThread && (!listFetched || autoOpenPending || threadLoading);
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
      localStorage.setItem(
        SHEET_LAYOUT_KEY,
        threadEmpty ? "centered" : "bottom",
      );
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
    // In a drilled view the new chat lands directly in that folder (same as
    // the folder's "New conversation here"); at the root it goes to the
    // shared quick-chats folder (createConversation handles null -> shared).
    const target = chatRootFolderId ?? null;
    // createConversation already sets it active with an empty thread, no need
    // for a second openConversation round-trip (that was the visible lag).
    await createConversation("", target, scopeSource);
    focusComposer();
  };
  // incognito: not listed in history, purged ~24h later
  const handleNewTemporary = async () => {
    setMobileListOpen(false);
    await createConversation("", null, scopeSource, null, null, true);
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

  // "Branch here": fork the thread up to this message into a NEW
  // conversation (history copied, fork point marked) and land there.
  // duplicateFromMessage opens it; the URL follows via the sync effect.
  const handleBranchHere = useCallback(
    (messageId: string) => {
      const st = useChatStore.getState();
      const source = st.conversations.find(
        (c) => c.id === st.activeConversationId,
      );
      const base = source?.title || t("chat.untitled");
      void st.duplicateFromMessage(
        messageId,
        t("chat.forkTitle", {
          title: base,
        }),
      );
    },
    [t],
  );

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
    handleBranchHere,
    mobileListOpen,
    setMobileListOpen,
    chatRootFolderId,
    setChatRootFolderId,
    composerWrapRef,
    handleNew,
    handleNewTemporary,
    handleEmptySuggestion,
    handleExportActive,
    confirm,
    ConfirmModalElement,
    activeTitle,
    headerBook,
  };
}

export type ConfirmFn = ReturnType<typeof useConfirm>["confirm"];
