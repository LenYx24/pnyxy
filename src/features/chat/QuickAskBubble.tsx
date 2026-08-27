/**
 * "Gyors kérdés" bubble (design canvas variant B): Ctrl+Shift+K anywhere
 * pops a small floating chat over the current screen, so an off-topic
 * question doesn't cost the reading position. Deliberately independent
 * of the chat-store's active-conversation state (that also drives the
 * /chat page AND the reader's Tanár panel); it persists directly and
 * streams via the low-level client. The conversation lands in the
 * shared "Quick chats" folder, so it shows up in the sidebar, and the
 * expand button promotes it to the full /chat view.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowUp, Eye, Maximize2, RotateCcw, X } from "lucide-react";
import { IconButton, TypingIndicator } from "@/components/ui";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile } from "@/hooks/use-media-query";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { supabase } from "@/lib/supabase";
import { streamChatResponse, isAbortError } from "@/lib/ai/ai-client";
import { ContextInspectorModal } from "./ContextInspectorModal";
import { renderMarkdown } from "@/lib/ai/markdown-message";
import { logError } from "@/lib/logger";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";

interface QuickMsg {
  id: string | null;
  role: "user" | "assistant";
  content: string;
}

export function QuickAskBubble() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const user = useAuthStore((s) => s.user);

  const [open, setOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<QuickMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcut({
    id: "app:quick-ask",
    key: "k",
    ctrl: true,
    shift: true,
    description: "Quick ask",
    handler: useCallback(() => setOpen((v) => !v), []),
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const reset = useCallback(() => {
    setConvId(null);
    setMsgs([]);
    setError(null);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !user) return;
    setInput("");
    setError(null);
    setStreaming(true);
    track("chat_send", { scope: "chat", quick: true });
    try {
      // lazily create the conversation in the shared Quick chats folder
      let cid = convId;
      if (!cid) {
        const folderId = await useChatStore.getState().ensureQuickChatsFolder();
        const { data, error: convErr } = await supabase
          .from("chat_conversations")
          .insert({ user_id: user.id, title: "", folder_id: folderId })
          .select("id")
          .single();
        if (convErr || !data) throw convErr ?? new Error("create failed");
        cid = data.id as string;
        setConvId(cid);
      }
      const parentId = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
      const { data: userRow, error: userErr } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: cid,
          parent_message_id: parentId,
          role: "user",
          content: text,
        })
        .select("id")
        .single();
      if (userErr || !userRow) throw userErr ?? new Error("insert failed");
      const userMsg: QuickMsg = {
        id: userRow.id as string,
        role: "user",
        content: text,
      };
      setMsgs((m) => [
        ...m,
        userMsg,
        { id: null, role: "assistant", content: "" },
      ]);

      // stream: default routing, no doc context (this is the whole point)
      const history = [...msgs, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      let full = "";
      for await (const { delta } of streamChatResponse(history, "", "")) {
        full += delta;
        setMsgs((m) => {
          const next = [...m];
          next[next.length - 1] = { ...next[next.length - 1], content: full };
          return next;
        });
      }
      const { data: aiRow } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: cid,
          parent_message_id: userRow.id as string,
          role: "assistant",
          content: full,
        })
        .select("id")
        .single();
      if (aiRow) {
        setMsgs((m) => {
          const next = [...m];
          next[next.length - 1] = {
            ...next[next.length - 1],
            id: aiRow.id as string,
          };
          return next;
        });
        await supabase
          .from("chat_conversations")
          .update({ active_leaf_id: aiRow.id })
          .eq("id", cid);
      }
      // the sidebar list should learn about the new thread
      void useChatStore.getState().fetchConversations();
    } catch (err) {
      if (!isAbortError(err)) {
        logError("quick-ask:send", err);
        setError(t("chat.quickAsk.error"));
        // drop the empty streaming placeholder if it's still there
        setMsgs((m) =>
          m.length > 0 &&
          m[m.length - 1].role === "assistant" &&
          !m[m.length - 1].content
            ? m.slice(0, -1)
            : m,
        );
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, user, convId, msgs, t]);

  if (isMobile || !user || !open) return null;

  return (
    <div
      className="pop-in fixed bottom-4 right-4 z-40 flex max-h-[70vh] w-80 flex-col gap-2 rounded-panel bg-bg-tertiary p-3 shadow-page"
      style={{ transformOrigin: "bottom right" }}
      role="dialog"
      aria-label={t("chat.quickAsk.title")}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          {t("chat.quickAsk.title")}
        </span>
        <div className="flex items-center gap-0.5 text-text-muted">
          <IconButton
            size="sm"
            onClick={() => setInspectorOpen(true)}
            title={t("chat.contextInspector.open")}
            aria-label={t("chat.contextInspector.open")}
            aria-haspopup="dialog"
          >
            <Eye size={15} strokeWidth={1.5} />
          </IconButton>
          {msgs.length > 0 && (
            <IconButton
              size="sm"
              onClick={reset}
              title={t("chat.quickAsk.new")}
              aria-label={t("chat.quickAsk.new")}
            >
              <RotateCcw size={15} strokeWidth={1.5} />
            </IconButton>
          )}
          {convId && (
            <IconButton
              size="sm"
              onClick={() => {
                setOpen(false);
                navigate(`/chat/${convId}`);
                reset();
              }}
              title={t("chat.quickAsk.expand")}
              aria-label={t("chat.quickAsk.expand")}
            >
              <Maximize2 size={15} strokeWidth={1.5} />
            </IconButton>
          )}
          <IconButton
            size="sm"
            onClick={() => setOpen(false)}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X size={15} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>

      {msgs.length > 0 && (
        <div
          ref={scrollRef}
          className="menu-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 text-[13px]"
        >
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div
                key={m.id ?? i}
                className="max-w-[85%] self-end rounded-[12px] rounded-br-[4px] bg-surface-3 px-3 py-1.5 text-text-primary"
              >
                {m.content}
              </div>
            ) : m.content ? (
              <div
                key={m.id ?? i}
                className="ai-message break-words text-text-secondary"
                // renderMarkdown output is DOMPurify-sanitized
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(m.content, null),
                }}
              />
            ) : (
              <div key={i} className="text-text-muted">
                <TypingIndicator />
              </div>
            ),
          )}
        </div>
      )}
      {error && <p className="text-2xs text-danger">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.quickAsk.placeholder")}
          className="field bg-bg-secondary text-[13px]"
        />
        <button
          type="submit"
          disabled={streaming || input.trim().length === 0}
          aria-label={t("chat.send")}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text-primary text-bg-primary transition-opacity cursor-pointer",
            "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30",
          )}
        >
          <ArrowUp size={15} strokeWidth={1.5} />
        </button>
      </form>
      <ContextInspectorModal
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        docId={null}
        docTitle={null}
        conversationId={convId}
      />
    </div>
  );
}
