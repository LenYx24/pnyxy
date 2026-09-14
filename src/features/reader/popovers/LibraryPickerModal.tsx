import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { cn } from "@/lib/cn";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { Folder } from "@/types/database";

interface LibraryPickerModalProps {
  onClose: () => void;
}

interface PickerRow {
  key: string;
  title: string;
  author: string | null;
  folderId: string | null;
  // Identity used for "already open" detection, file_hash for uploads,
  // catalog_book.id for catalog entries (the latter is what registerFile
  // uses on open).
  openHashOrId: string;
  hasFile: boolean;
  open: () => Promise<void>;
}

/** Walk parent links to build the breadcrumb path for a folder id. */
function folderPathOf(folders: Folder[], targetId: string | null): Folder[] {
  const path: Folder[] = [];
  let current = targetId ? folders.find((f) => f.id === targetId) : undefined;
  while (current) {
    path.unshift(current);
    const parentId: string | null = current.parent_id;
    current = parentId ? folders.find((f) => f.id === parentId) : undefined;
  }
  return path;
}

/**
 * Picks a book from the user's library to open in the reader alongside
 * whatever's already open. Mirrors the library's own list view (folders you
 * can drill into, then books), stripped down to the pick-to-open essentials.
 * Supports uploaded books (Supabase Storage) and catalog books.
 */
export function LibraryPickerModal({ onClose }: LibraryPickerModalProps) {
  const { t } = useTranslation();
  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const openDocs = useReaderStore((s) => s.documents);
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  // Always refetch on mount so a freshly-signed-in user sees their library
  // even if `books` was populated from a stale anonymous session.
  useEffect(() => {
    void fetchLibrary();
    void fetchFolders();
  }, [fetchLibrary, fetchFolders]);

  // Android back button / system back gesture: step out of a subfolder first,
  // then close the picker.
  useBackToClose(true, () => {
    if (folderId) setFolderId(null);
    else onClose();
  });

  const rows: PickerRow[] = useMemo(() => {
    const out: PickerRow[] = [];
    for (const entry of books as UnifiedLibraryItem[]) {
      if (entry.source === "uploaded") {
        out.push({
          key: `up:${entry.id}`,
          title: entry.book.title,
          author: entry.book.author,
          folderId: entry.folder_id,
          openHashOrId: entry.book.file_hash ?? entry.book.id,
          hasFile: !!entry.book.storage_path,
          open: async () => {
            await openUploadedBook(entry);
          },
        });
      } else {
        const cb = entry.catalog_book;
        out.push({
          key: `cat:${entry.id}`,
          title: cb.title,
          author: cb.authors[0] ?? null,
          folderId: entry.folder_id,
          openHashOrId: cb.id,
          hasFile: !!cb.download_url,
          open: async () => {
            await openCatalogBook(cb);
          },
        });
      }
    }
    return out;
  }, [books, openUploadedBook, openCatalogBook]);

  const searching = query.trim().length > 0;

  // Search flattens across every folder; otherwise show the current folder's
  // subfolders + books, like the library's own list view.
  const visibleRows = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.author ?? "").toLowerCase().includes(q),
      );
    }
    return rows.filter((r) => r.folderId === folderId);
  }, [rows, query, searching, folderId]);

  const subfolders = useMemo(
    () =>
      searching
        ? []
        : folders
            .filter((f) => f.parent_id === folderId)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, folderId, searching],
  );

  const breadcrumb = useMemo(
    () => folderPathOf(folders, folderId),
    [folders, folderId],
  );

  const bookCountIn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.folderId) counts.set(r.folderId, (counts.get(r.folderId) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  // Identity set: a doc is "already open" if any open doc's meta.id matches the
  // row's hash/id (the reader's docId is the file hash / catalog book id).
  const openIds = useMemo(() => {
    const set = new Set<string>();
    for (const d of openDocs.values()) {
      if (d.meta?.id) set.add(d.meta.id);
    }
    return set;
  }, [openDocs]);

  const handleOpen = async (row: PickerRow) => {
    if (!row.hasFile) return;
    setOpeningKey(row.key);
    try {
      await row.open();
      onClose();
    } finally {
      setOpeningKey(null);
    }
  };

  const isEmpty =
    !isLoading && subfolders.length === 0 && visibleRows.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-page bg-bg-tertiary shadow-page"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "80vh" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-glass-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">
            {t("reader.libraryPicker.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-glass-border px-4 py-2">
          <div className="flex items-center gap-2 rounded-control bg-surface-3 px-3 py-1.5 focus-within:border-accent">
            <Search size={14} className="text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reader.libraryPicker.search")}
              className="flex-1 border-0 bg-transparent text-sm text-text-primary outline-none"
            />
          </div>
        </div>

        {/* Breadcrumb, only in browse mode. */}
        {!searching && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-glass-border px-4 py-1.5 text-xs text-text-muted">
            <button
              onClick={() => setFolderId(null)}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
                folderId === null && "text-text-primary",
              )}
            >
              {t("reader.libraryPicker.root")}
            </button>
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex shrink-0 items-center gap-1">
                <ChevronRight size={12} className="text-text-muted-2" />
                <button
                  onClick={() => setFolderId(f.id)}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
                    folderId === f.id && "text-text-primary",
                  )}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : isEmpty ? (
            <p className="p-6 text-center text-sm text-text-muted">
              {searching
                ? t("reader.libraryPicker.noMatches")
                : t("reader.libraryPicker.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-glass-border/50">
              {subfolders.map((f) => (
                <li key={`folder:${f.id}`}>
                  <button
                    onClick={() => setFolderId(f.id)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-glass-hover cursor-pointer"
                  >
                    <div className="flex h-10 w-8 shrink-0 items-center justify-center rounded bg-glass-bg">
                      <FolderIcon size={14} className="text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {f.name}
                      </p>
                    </div>
                    {(bookCountIn.get(f.id) ?? 0) > 0 && (
                      <span className="text-2xs text-text-muted">
                        {bookCountIn.get(f.id)}
                      </span>
                    )}
                    <ChevronRight size={14} className="text-text-muted-2" />
                  </button>
                </li>
              ))}
              {visibleRows.map((row) => {
                const alreadyOpen = openIds.has(row.openHashOrId);
                const isOpening = openingKey === row.key;
                const disabled = alreadyOpen || isOpening || !row.hasFile;
                return (
                  <li key={row.key}>
                    <button
                      onClick={() => handleOpen(row)}
                      disabled={disabled}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                        disabled
                          ? "opacity-50"
                          : "hover:bg-glass-hover cursor-pointer",
                      )}
                    >
                      <div className="flex h-10 w-8 shrink-0 items-center justify-center rounded bg-glass-bg">
                        <FileText size={14} className="text-text-muted" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {row.title}
                        </p>
                        {row.author && (
                          <p className="truncate text-xs text-text-muted">
                            {row.author}
                          </p>
                        )}
                      </div>
                      {isOpening ? (
                        <Loader2
                          size={14}
                          className="animate-spin text-text-muted"
                        />
                      ) : alreadyOpen ? (
                        <span className="text-2xs text-text-muted">
                          {t("reader.libraryPicker.alreadyOpen")}
                        </span>
                      ) : !row.hasFile ? (
                        <span className="text-2xs text-text-muted">
                          {t("reader.libraryPicker.noFile")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
