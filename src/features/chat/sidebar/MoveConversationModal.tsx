import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Folder as FolderIcon, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useBackToClose } from "@/hooks/use-back-to-close";
import type { ChatFolder } from "@/types/chat";
import { isQuickChatsFolder } from "./conversation-groups";

interface MoveConversationModalProps {
  open: boolean;
  /** Where the conversation lives now (null = root); that row is marked
   *  and disabled so "move to where it already is" is a no-op. */
  currentFolderId: string | null;
  folders: ChatFolder[];
  onClose: () => void;
  onSelect: (folderId: string | null) => void;
}

interface FolderRow {
  folder: ChatFolder;
  depth: number;
}

/**
 * Small folder picker for "Move to folder…". Replaces the old context-menu
 * variant that listed every folder as its own menu entry. Shows the folder
 * hierarchy indented; typing in the search box flattens it to name matches.
 * Clicking a row moves immediately and closes.
 */
export function MoveConversationModal({
  open,
  currentFolderId,
  folders,
  onClose,
  onSelect,
}: MoveConversationModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // reset the search whenever the modal opens for a new conversation
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) setQuery("");
  }

  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useBackToClose(open, onClose);

  // the auto-created "Quick chats" folder(s) are internal, never a target
  const visibleFolders = useMemo(
    () => folders.filter((f) => !isQuickChatsFolder(f, t)),
    [folders, t],
  );

  // hierarchy flattened depth-first so rows can indent by depth
  const rows = useMemo<FolderRow[]>(() => {
    const byParent = new Map<string | null, ChatFolder[]>();
    const ids = new Set(visibleFolders.map((f) => f.id));
    for (const f of visibleFolders) {
      // a hidden/missing parent (e.g. Quick chats) promotes the child to root
      const parent =
        f.parent_id !== null && ids.has(f.parent_id) ? f.parent_id : null;
      const arr = byParent.get(parent) ?? [];
      arr.push(f);
      byParent.set(parent, arr);
    }
    const out: FolderRow[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of byParent.get(parent) ?? []) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [visibleFolders]);

  const q = query.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      q === ""
        ? rows
        : rows
            .filter((r) => r.folder.name.toLowerCase().includes(q))
            .map((r) => ({ ...r, depth: 0 })),
    [rows, q],
  );

  if (!open || typeof document === "undefined") return null;

  const pick = (folderId: string | null) => {
    onSelect(folderId);
    onClose();
  };

  const rowClass = (isCurrent: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm transition-colors",
      isCurrent
        ? "cursor-default text-text-muted"
        : "cursor-pointer text-text-secondary hover:bg-bg-secondary hover:text-text-primary",
    );

  const rootIsCurrent = currentFolderId === null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-conversation-title"
        className="relative z-10 flex w-full max-w-sm flex-col rounded-page bg-bg-tertiary p-6 shadow-page"
      >
        <h3
          id="move-conversation-title"
          className="mb-3 text-lg font-semibold text-text-primary"
        >
          {t("chat.folders.moveTitle")}
        </h3>
        {rows.length > 4 && (
          <div className="relative mb-2">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.folders.searchPlaceholder")}
              className="field bg-bg-secondary pl-9"
            />
          </div>
        )}
        <div className="chat-scroll -mx-1.5 max-h-72 overflow-y-auto px-1.5 py-1">
          {q === "" && (
            <button
              type="button"
              disabled={rootIsCurrent}
              onClick={() => pick(null)}
              className={rowClass(rootIsCurrent)}
            >
              <Undo2 size={18} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t("chat.folders.root")}
              </span>
              {rootIsCurrent && (
                <Check size={16} strokeWidth={2} className="shrink-0" />
              )}
            </button>
          )}
          {filteredRows.map(({ folder, depth }) => {
            const isCurrent = folder.id === currentFolderId;
            return (
              <button
                key={folder.id}
                type="button"
                disabled={isCurrent}
                onClick={() => pick(folder.id)}
                style={{ paddingLeft: 12 + depth * 16 }}
                className={rowClass(isCurrent)}
              >
                <FolderIcon size={18} strokeWidth={1.5} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {isCurrent && (
                  <Check size={16} strokeWidth={2} className="shrink-0" />
                )}
              </button>
            );
          })}
          {q !== "" && filteredRows.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-text-muted">
              {t("chat.searchNoResults")}
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
