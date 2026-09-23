import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fieldClass } from "@/components/ui";
import {
  captionClass,
  dateGroupLabel,
  folderNameById,
  groupConversationsByDate,
} from "@/features/chat/sidebar/conversation-groups";
import { useContentSearch } from "@/features/chat/sidebar/useContentSearch";
import { useSettingsStore } from "@/stores/settings-store";
import type { ChatConversation, ChatFolder } from "@/types/chat";

type Scope = "doc" | "all";

interface ReaderConversationListProps {
  /** Conversations for the whole account; scoping happens here. */
  conversations: ChatConversation[];
  folders: ChatFolder[];
  /** Reader document the panel is attached to (null for a loose panel). */
  docId: string | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (conversation: ChatConversation) => void;
  onClose: () => void;
}

/**
 * Conversation picker for the reader's AI panel. The old one was a flat,
 * unfiltered list of this document's chats, which is fine at five and
 * useless at fifty, so this brings over what the /chat sidebar does: a
 * search box (titles, and message content when that setting is on), Today /
 * This week / Earlier grouping, the folder a chat lives in, and a switch
 * between "this book" and every conversation, since the one you want is
 * sometimes the one you started somewhere else.
 */
export function ReaderConversationList({
  conversations,
  folders,
  docId,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: ReaderConversationListProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("doc");
  const [query, setQuery] = useState("");
  const contentSearchEnabled = useSettingsStore((s) => s.chatSearchInMessages);
  const contentSearch = useContentSearch(query, contentSearchEnabled);
  const contentHits = contentSearch.hits;

  const folderNames = useMemo(() => folderNameById(folders, t), [folders, t]);

  const scoped = useMemo(() => {
    const base = conversations.filter((c) => !c.archived_at && !c.is_temporary);
    if (scope === "all" || !docId) return base;
    return base.filter((c) => c.source_doc_id === docId);
  }, [conversations, scope, docId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) || contentHits.has(c.id),
    );
  }, [scoped, query, contentHits]);

  const groups = useMemo(() => groupConversationsByDate(filtered), [filtered]);

  const scopeTab = (value: Scope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(value)}
      className={cn(
        "flex-1 rounded-[7px] px-2 py-1 text-2xs font-medium transition-colors cursor-pointer",
        scope === value
          ? "bg-bg-tertiary text-text-primary"
          : "text-text-muted hover:text-text-primary",
      )}
      aria-pressed={scope === value}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <button
          type="button"
          onClick={onClose}
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
          onClick={onNew}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
          title={t("reader.aiChat.newConversationForDoc")}
          aria-label={t("reader.aiChat.newConversationForDoc")}
        >
          <Plus size={18} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 px-2 pb-1.5">
        {docId && (
          <div className="flex items-center gap-1 rounded-control bg-bg-secondary p-0.5">
            {scopeTab("doc", t("reader.aiChat.scopeThisDoc"))}
            {scopeTab("all", t("reader.aiChat.scopeAll"))}
          </div>
        )}
        <div className="relative">
          <Search
            size={14}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted-2"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chat.searchPlaceholder")}
            aria-label={t("chat.searchPlaceholder")}
            className={cn(fieldClass, "pl-8 pr-7 text-[13px]")}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("common.cancel")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>
        {contentSearchEnabled && contentSearch.searching && (
          <span className="px-0.5 text-2xs text-text-muted-2">
            {t("chat.searchInMessagesSearching")}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-text-muted">
            {query.trim()
              ? t("chat.searchNoResults")
              : t("reader.aiChat.noConversationsForDoc")}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mb-2">
              <div className={cn(captionClass, "px-2 py-1")}>
                {dateGroupLabel(group.key, t)}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((c) => {
                  const hit = contentHits.get(c.id);
                  const folderName = c.folder_id
                    ? folderNames.get(c.folder_id)
                    : undefined;
                  // "in: <book>" only matters once the list spans books
                  const subtitle =
                    scope === "all" && c.source_doc_title
                      ? c.source_doc_title
                      : folderName;
                  return (
                    <li key={c.id} className="group/row relative">
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 rounded-[8px] py-1.5 pl-3 pr-8 text-left transition-colors cursor-pointer",
                          c.id === activeId
                            ? "bg-bg-tertiary text-text-primary"
                            : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
                        )}
                      >
                        <span className="min-w-0 truncate text-sm">
                          {c.title || t("chat.untitled")}
                        </span>
                        {subtitle && (
                          <span className="min-w-0 truncate text-2xs text-text-muted-2">
                            {subtitle}
                          </span>
                        )}
                        {hit && (
                          // server-highlighted excerpt; << >> mark the match
                          <span className="min-w-0 truncate text-2xs text-text-muted">
                            {hit.snippet.replace(/<<|>>/g, "")}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(c)}
                        className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-[6px] text-text-muted-2 transition-colors hover:bg-danger/15 hover:text-danger group-hover/row:flex cursor-pointer"
                        title={t("reader.aiChat.deleteConversationTitle")}
                        aria-label={t("reader.aiChat.deleteConversationTitle")}
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
