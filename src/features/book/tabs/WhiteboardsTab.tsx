import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { useBook } from "../BookPageContext";
import { useWhiteboardStore } from "@/stores/whiteboard-store";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Lists whiteboards tied to the current book and lets the user
 * create a new empty one (no PDF page underneath — pure scratch
 * canvas). The reader's draw-tool auto-create path leaves bookId
 * undefined, so those don't show up here; only whiteboards
 * deliberately associated with this book are listed.
 */
export function WhiteboardsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const book = useBook();
  const bookId = book.book.id;

  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const loadWhiteboards = useWhiteboardStore((s) => s.loadWhiteboards);
  const createWhiteboard = useWhiteboardStore((s) => s.createWhiteboard);

  useEffect(() => {
    void loadWhiteboards();
  }, [loadWhiteboards]);

  const tied = useMemo(
    () =>
      whiteboards
        .filter((w) => w.bookId === bookId)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [whiteboards, bookId],
  );

  const handleCreate = () => {
    const id = createWhiteboard({
      bookId,
      title: t("book.whiteboards.defaultTitle", { book: book.book.title }),
    });
    navigate(`/whiteboards/${id}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t("book.whiteboards.heading")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("book.whiteboards.description")}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleCreate}
          className="px-3 py-1.5 text-xs sm:text-sm"
        >
          <Plus size={14} />
          {t("book.whiteboards.newEmpty")}
        </Button>
      </div>

      {tied.length === 0 ? (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
          <Pencil size={28} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.whiteboards.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.whiteboards.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tied.map((wb) => (
            <button
              key={wb.id}
              onClick={() => navigate(`/whiteboards/${wb.id}`)}
              className="flex items-center justify-between gap-3 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-glass-hover cursor-pointer"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Pencil size={14} className="shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {wb.title || t("book.whiteboards.untitled")}
                  </p>
                  <p className="text-2xs text-text-muted">
                    {t("book.whiteboards.updated", {
                      date: formatDate(wb.updatedAt),
                    })}
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                {wb.elements.length}{" "}
                {t("book.whiteboards.itemCount", { count: wb.elements.length })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
