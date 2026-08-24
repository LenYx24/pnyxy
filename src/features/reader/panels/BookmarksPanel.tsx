import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark as BookmarkIcon, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useBookmarkStore, BOOKMARK_COLORS, type Bookmark } from "@/stores/bookmark-store";

interface BookmarksPanelProps {
  /** Hide the "Add bookmark" row, useful when the panel is embedded
   *  somewhere that already has its own add affordance. */
  hideAddRow?: boolean;
  /** Optional: custom click handler. Defaults to jumping to the page
   *  via reader-store. */
  onJump?: (bookmark: Bookmark) => void;
}

export function BookmarksPanel({ hideAddRow, onJump }: BookmarksPanelProps) {
  const { t } = useTranslation();
  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const updateBookmark = useBookmarkStore((s) => s.updateBookmark);
  const removeBookmark = useBookmarkStore((s) => s.removeBookmark);

  const sorted = useMemo(
    () => [...bookmarks.values()].sort((a, b) => a.page - b.page),
    [bookmarks],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const handleAdd = async () => {
    if (!activeDoc) return;
    const bm = await addBookmark(activeDoc.currentPage);
    if (bm) {
      setEditingId(bm.id);
      setEditLabel("");
    }
  };

  const handleJump = (bm: Bookmark) => {
    if (onJump) onJump(bm);
    else goToPage(bm.page);
  };

  const handleSaveLabel = async (id: string) => {
    await updateBookmark(id, { label: editLabel });
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {!hideAddRow && activeDoc && (
        <button
          onClick={handleAdd}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-glass-border bg-glass-bg/30 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <Plus size={14} />
          {t("reader.bookmarks.addAt", { page: activeDoc.currentPage })}
        </button>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed border-glass-border bg-glass-bg/20 p-4 text-center">
          <BookmarkIcon size={20} className="mx-auto mb-1 text-text-muted/50" />
          <p className="text-xs text-text-muted">{t("reader.bookmarks.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((bm) => (
            <li
              key={bm.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-glass-hover"
            >
              {/* Color swatch: click to cycle */}
              <button
                onClick={() => {
                  const idx = BOOKMARK_COLORS.indexOf(
                    bm.color as (typeof BOOKMARK_COLORS)[number],
                  );
                  const next =
                    BOOKMARK_COLORS[(idx + 1) % BOOKMARK_COLORS.length];
                  updateBookmark(bm.id, { color: next });
                }}
                className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-white/20 transition-transform cursor-pointer hover:scale-125"
                style={{ backgroundColor: bm.color }}
                title={t("reader.bookmarks.changeColor")}
                aria-label={t("reader.bookmarks.changeColor")}
              />

              {editingId === bm.id ? (
                <input
                  autoFocus
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={() => handleSaveLabel(bm.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveLabel(bm.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder={t("reader.bookmarks.labelPlaceholder")}
                  className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none"
                />
              ) : (
                <button
                  onClick={() => handleJump(bm)}
                  className="flex-1 min-w-0 text-left truncate text-xs text-text-primary cursor-pointer"
                >
                  {bm.label || (
                    <span className="text-text-muted">
                      {t("reader.bookmarks.untitled")}
                    </span>
                  )}
                </button>
              )}

              <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                {t("reader.bookmarks.page", { page: bm.page })}
              </span>

              <div
                className={cn(
                  "flex shrink-0 gap-0.5 transition-opacity",
                  editingId === bm.id
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                {editingId === bm.id ? (
                  <>
                    <button
                      onClick={() => handleSaveLabel(bm.id)}
                      className="rounded p-1 text-success hover:bg-glass-hover cursor-pointer"
                      aria-label={t("reader.bookmarks.save")}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
                      aria-label={t("reader.bookmarks.cancel")}
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingId(bm.id);
                        setEditLabel(bm.label);
                      }}
                      className="rounded p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      aria-label={t("reader.bookmarks.rename")}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => removeBookmark(bm.id)}
                      className="rounded p-1 text-text-muted hover:bg-glass-hover hover:text-danger cursor-pointer"
                      aria-label={t("reader.bookmarks.delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
