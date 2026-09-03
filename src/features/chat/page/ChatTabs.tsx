/**
 * Chat tab bar (chatTabs feature): the conversations the user has opened this
 * session, shown as VS Code-style tabs so several stay one click away instead
 * of hunting the sidebar. Clicking switches the active conversation; the X
 * closes the tab (not the conversation). Hidden when fewer than two are open.
 *
 * MVP scope: switching is instant and safe (each conversation's messages load
 * from its own store snapshot; a background conversation's stream never writes
 * into the visible thread, guarded in chat-stream). Live token streaming in a
 * background tab is a later layer on the shared stream path.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, X } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/cn";

export function ChatTabs() {
  const { t } = useTranslation();
  const openTabIds = useChatStore((s) => s.openTabIds);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const openConversation = useChatStore((s) => s.openConversation);
  const closeTab = useChatStore((s) => s.closeTab);

  // Resolve open ids to live conversations, dropping any that were deleted or
  // archived out from under the tab bar.
  const tabs = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    return openTabIds
      .map((id) => byId.get(id))
      .filter((c): c is (typeof conversations)[number] => Boolean(c) && !c!.archived_at);
  }, [openTabIds, conversations]);

  if (tabs.length < 2) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-glass-border bg-bg-secondary/40 px-2 py-1">
      {tabs.map((conv) => {
        const isActive = conv.id === activeConversationId;
        const title = conv.title?.trim() || t("chat.untitled");
        return (
          <div
            key={conv.id}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-bg-tertiary text-text-primary"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <button
              onClick={() => void openConversation(conv.id)}
              className="flex max-w-[200px] items-center gap-1.5 cursor-pointer"
              title={title}
            >
              <MessageSquare size={12} className="shrink-0" />
              <span className="truncate">{title}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(conv.id);
              }}
              aria-label={t("chat.tabs.close")}
              title={t("chat.tabs.close")}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded text-current opacity-50 transition-opacity hover:bg-glass-hover hover:opacity-100 cursor-pointer",
                isActive && "opacity-80",
              )}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
