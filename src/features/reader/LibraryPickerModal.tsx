import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Search, X } from "lucide-react";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { cn } from "@/lib/cn";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface LibraryPickerModalProps {
  onClose: () => void;
}

interface PickerRow {
  key: string;
  title: string;
  author: string | null;
  // Identity used for "already open" detection — file_hash for uploads,
  // catalog_book.id for catalog entries (the latter is what registerFile
  // uses on open).
  openHashOrId: string;
  hasFile: boolean;
  open: () => Promise<void>;
}

/**
 * Picks a book from the user's library to open in the reader alongside
 * whatever's already open. Supports both uploaded books (downloaded from
 * Supabase Storage) and catalog books (downloaded via the catalog hook).
 */
export function LibraryPickerModal({ onClose }: LibraryPickerModalProps) {
  const { t } = useTranslation();
  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const openDocs = useReaderStore((s) => s.documents);
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();
  const [query, setQuery] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  // Always refetch on mount so a freshly-signed-in user sees their library
  // even if `books` was populated from a stale anonymous session.
  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  // Android back button / system back gesture closes the picker
  // instead of navigating away from the reader.
  useBackToClose(true, onClose);

  const rows: PickerRow[] = useMemo(() => {
    const out: PickerRow[] = [];
    for (const entry of books as UnifiedLibraryItem[]) {
      if (entry.source === "uploaded") {
        out.push({
          key: `up:${entry.id}`,
          title: entry.book.title,
          author: entry.book.author,
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

  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.author ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Identity set: a doc is considered "already open" if any open doc's
  // meta.id matches the row's hash/id. The reader's docId is the file
  // hash (uploaded) or the catalog book id, both of which we mirror here.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-glass-border bg-bg-secondary shadow-xl"
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
            className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-glass-border px-4 py-2">
          <div className="flex items-center gap-2 rounded-md border border-glass-border bg-bg-secondary px-3 py-1.5 focus-within:border-accent-purple">
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

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("common.loading")}
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="p-6 text-center text-sm text-text-muted">
              {query
                ? t("reader.libraryPicker.noMatches")
                : t("reader.libraryPicker.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-glass-border/50">
              {filteredRows.map((row) => {
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
                        <span className="text-[11px] text-text-muted">
                          {t("reader.libraryPicker.alreadyOpen")}
                        </span>
                      ) : !row.hasFile ? (
                        <span className="text-[11px] text-text-muted">
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
