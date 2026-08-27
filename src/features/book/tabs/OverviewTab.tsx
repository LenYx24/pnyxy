import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Check,
  Loader2,
  BookOpen,
  FileX2,
  Paperclip,
  Trash2,
  PenLine,
  Sparkles,
  ScrollText,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Button,
  CategoryChip,
  FloatingMenu,
  StarRatingDisplay,
  StarRatingInput,
} from "@/components/ui";
import { fetchResumeState, saveResumeState } from "@/lib/resume-state";
import {
  getCatalogBookDownloadActions,
  getDownloadActions,
} from "@/lib/library/download-entry";
import { useBrowseStore } from "@/stores/browse-store";
import { useAuthStore } from "@/stores/auth-store";
import { useRatingStore } from "@/stores/rating-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useUploadStore } from "@/stores/upload-store";
import { bookIdSegment } from "@/lib/slugify";
import { logError } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import {
  useOpenUploadedDocument,
  prefetchBookBlob,
} from "@/hooks/use-open-uploaded-document";
import { useConfirm } from "@/hooks/use-confirm";
import type { CatalogBook, UploadedLibraryItem } from "@/types/catalog";
import type { Book, Category } from "@/types/database";
import { useBook } from "../BookPageContext";
import { RelatedToBook } from "../RelatedToBook";
import { BookStatusPicker } from "../BookStatusPicker";
import { BookCategoryEditor } from "../BookCategoryEditor";
import { AttachFileButton } from "../AttachFileButton";
import { DownloadButton } from "../DownloadButton";

// Creates an empty quiz tied to this book, opens editor with AI panel pre-expanded.
function GenerateQuizFromBookButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useBook();
  const createQuiz = useQuizStore((s) => s.createQuiz);
  const [creating, setCreating] = useState(false);

  const handleClick = async () => {
    if (creating) return;
    setCreating(true);
    const isUploaded = data.source === "uploaded";
    const bookTitle = isUploaded ? data.book.title : data.book.title;
    const id = await createQuiz({
      title: bookTitle
        ? t("book.overview.generate.defaultTitle", { book: bookTitle })
        : t("book.overview.generate.defaultTitleNoBook"),
      description: null,
      visibility: "private",
      uploaded_book_id: isUploaded ? data.book.id : null,
      catalog_book_id: !isUploaded ? data.book.id : null,
      questions: [],
    });
    setCreating(false);
    if (id) navigate(`/quizzes/${id}/edit?aiOpen=1`);
  };

  return (
    <Button onClick={handleClick} variant="secondary" disabled={creating}>
      {creating ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <>
          <Sparkles size={16} />
          {t("book.overview.generate.quiz")}
        </>
      )}
    </Button>
  );
}

// Like the quiz button but forces short-answer mode (Q/A pairs, not multi-choice).
function GenerateFlashcardsFromBookButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useBook();
  const createQuiz = useQuizStore((s) => s.createQuiz);
  const [creating, setCreating] = useState(false);

  const handleClick = async () => {
    if (creating) return;
    setCreating(true);
    const isUploaded = data.source === "uploaded";
    const bookTitle = data.book.title;
    const id = await createQuiz({
      title: bookTitle
        ? t("book.overview.generate.defaultFlashTitle", { book: bookTitle })
        : t("book.overview.generate.defaultFlashTitleNoBook"),
      description: null,
      visibility: "private",
      uploaded_book_id: isUploaded ? data.book.id : null,
      catalog_book_id: !isUploaded ? data.book.id : null,
      questions: [],
    });
    setCreating(false);
    if (id) navigate(`/quizzes/${id}/edit?aiOpen=1&kind=short_answer`);
  };

  return (
    <Button onClick={handleClick} variant="secondary" disabled={creating}>
      {creating ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <>
          <Sparkles size={16} />
          {t("book.overview.generate.flashcards")}
        </>
      )}
    </Button>
  );
}

function GenerateExamFromBookButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useBook();
  const handleClick = () => {
    navigate(`/books/${data.book.id}/exams`);
  };
  return (
    <Button onClick={handleClick} variant="secondary">
      <ScrollText size={16} />
      {t("book.overview.generate.exam")}
    </Button>
  );
}

function CreateWhiteboardButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handle = () => {
    const id = useWhiteboardStore.getState().createWhiteboard();
    navigate(`/whiteboards/${id}`);
  };
  return (
    <Button variant="secondary" onClick={handle}>
      <PenLine size={16} />
      {t("book.overview.newWhiteboard")}
    </Button>
  );
}

// Collapses the four "generate study material" buttons behind one
// dropdown so the action row stays focused on the primary Open button.
function StudyToolsDropdown() {
  const { t } = useTranslation();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={btnRef} className="inline-flex">
        <Button
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Sparkles size={16} />
          {t("book.overview.studyTools")}
          <ChevronDown size={14} className="opacity-70" />
        </Button>
      </span>
      <FloatingMenu
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        className="min-w-[15rem] p-1"
      >
        {/* the existing button components keep their own create/navigate
            logic; clicking any of them closes the menu (bubbles up). */}
        <div
          className="flex flex-col gap-1 [&_button]:w-full [&_button]:justify-start"
          onClick={() => setOpen(false)}
        >
          <CreateWhiteboardButton />
          <GenerateQuizFromBookButton />
          <GenerateFlashcardsFromBookButton />
          <GenerateExamFromBookButton />
        </div>
      </FloatingMenu>
    </>
  );
}

// "Page X of N" reading progress, shown as the value of the Pages meta
// row and editable on double-click (or the pencil). Persists to the same
// book_resume_state row the reader syncs to, replaces the old sidebar
// PageTracker.
function ReadingProgressValue({
  docId,
  pageCount,
}: {
  docId: string;
  pageCount: number | null;
}) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // reset on docId change without a setState-in-effect (React in-render guard)
  const [snapshot, setSnapshot] = useState(docId);
  if (snapshot !== docId) {
    setSnapshot(docId);
    setLoading(true);
    setCurrentPage(null);
    setEditing(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchResumeState(docId).then((row) => {
      if (cancelled) return;
      setCurrentPage(row?.page ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const startEdit = () => {
    setDraft(String(currentPage ?? ""));
    setEditing(true);
  };

  const save = async () => {
    const parsed = parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setEditing(false);
      return;
    }
    const clamped = pageCount ? Math.min(parsed, pageCount) : parsed;
    setSaving(true);
    await saveResumeState(docId, { page: clamped });
    setCurrentPage(clamped);
    setSaving(false);
    setEditing(false);
  };

  if (loading) return <p className="text-text-primary">-</p>;

  if (editing) {
    return (
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          type="number"
          min={1}
          max={pageCount ?? undefined}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-16 rounded border border-glass-border bg-bg-primary px-1.5 py-0.5 text-sm text-text-primary outline-none focus:border-accent"
        />
        {pageCount != null && (
          <span className="text-text-muted">/ {pageCount}</span>
        )}
      </span>
    );
  }

  const label =
    currentPage === null
      ? pageCount != null
        ? t("book.pageTracker.notStartedOf", {
            total: pageCount,
          })
        : t("book.pageTracker.notStarted")
      : pageCount != null
        ? t("book.pageTracker.progress", {
            current: currentPage,
            total: pageCount,
          })
        : t("book.pageTracker.currentOnly", { current: currentPage });

  return (
    <button
      type="button"
      onDoubleClick={startEdit}
      title={t("book.pageTracker.editTitle")}
      className="group flex items-center gap-1.5 text-left text-text-primary transition-colors hover:text-accent cursor-text"
    >
      <span className="tabular-nums">{label}</span>
      <Pencil
        size={11}
        onClick={(e) => {
          // single-click affordance for discoverability (double-click also works)
          e.stopPropagation();
          startEdit();
        }}
        className="shrink-0 opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-60"
      />
    </button>
  );
}

export function OverviewTab() {
  const data = useBook();
  return (
    <div className="space-y-6">
      {data.source === "catalog" ? (
        <CatalogOverview book={data.book} categories={data.categories} />
      ) : (
        <UploadedOverview
          book={data.book}
          storagePath={data.storagePath}
          fileName={data.fileName}
          sizeBytes={data.sizeBytes}
          categories={data.categories}
        />
      )}
      {/* library items about this book, regardless of folder placement */}
      <RelatedToBook />
    </div>
  );
}

function CatalogOverview({
  book,
  categories,
}: {
  book: CatalogBook;
  categories: Category[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const {
    userLibraryIds,
    addToUserLibrary,
    removeFromUserLibrary,
    checkUserLibrary,
  } = useBrowseStore();
  const {
    openCatalogBook,
    loading: readLoading,
    error: readError,
  } = useOpenCatalogBook();
  const [libraryLoading, setLibraryLoading] = useState(false);
  const inLibrary = userLibraryIds.has(book.id);

  // local aggregate so rating actions update the UI without a refetch
  const [ratingAgg, setRatingAgg] = useState({
    avg: book.rating_avg,
    count: book.rating_count,
  });
  const myRating = useRatingStore((s) => s.myRatings.get(book.id));
  const rateBook = useRatingStore((s) => s.rateBook);
  const clearRating = useRatingStore((s) => s.clearRating);
  const fetchMyRatings = useRatingStore((s) => s.fetchMyRatings);

  useEffect(() => {
    checkUserLibrary();
  }, [checkUserLibrary]);

  useEffect(() => {
    setRatingAgg({ avg: book.rating_avg, count: book.rating_count });
  }, [book.id, book.rating_avg, book.rating_count]);

  useEffect(() => {
    if (user) fetchMyRatings();
  }, [user, fetchMyRatings]);

  const handleRate = async (stars: number) => {
    const updated = await rateBook(book.id, stars);
    if (updated) {
      setRatingAgg({ avg: updated.rating_avg, count: updated.rating_count });
    }
  };
  const handleClearRating = async () => {
    const updated = await clearRating(book.id);
    if (updated) {
      setRatingAgg({ avg: updated.rating_avg, count: updated.rating_count });
    }
  };

  // IA scans expose PDF/EPUB/TXT, catalog download_url exposes one, commercial rows none.
  const downloadActions = getCatalogBookDownloadActions(book);

  const handleAddToLibrary = async () => {
    if (!user) return;
    setLibraryLoading(true);
    try {
      await addToUserLibrary(book.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const { confirm, ConfirmModalElement } = useConfirm();

  const handleRemoveFromLibrary = async () => {
    if (!user) return;
    const ok = await confirm({
      title: t("book.overview.removeConfirmTitle"),
      body: t("book.overview.removeConfirmBody"),
      confirmLabel: t("library.confirm.removeAction"),
      danger: true,
    });
    if (!ok) return;
    setLibraryLoading(true);
    try {
      await removeFromUserLibrary(book.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const hasReadable = !!(book.download_url || book.ia_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {/* streams the remote URL into the reader, falls back to new-tab download on CORS block */}
        {hasReadable && (
          <Button
            variant="primary"
            onClick={() => openCatalogBook(book)}
            disabled={readLoading}
          >
            {readLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <BookOpen size={16} />
            )}
            {t("book.overview.read")}
          </Button>
        )}

        {/* separate Add vs Open/Remove buttons */}
        {user && !inLibrary && (
          <Button
            variant="secondary"
            onClick={handleAddToLibrary}
            disabled={libraryLoading}
            aria-label={t("book.overview.addToLibraryAria")}
          >
            {libraryLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {t("book.overview.addToLibrary")}
          </Button>
        )}
        {user && inLibrary && (
          <>
            <Button variant="secondary" onClick={() => navigate("/library")}>
              <Check size={16} className="text-success" />
              {t("book.overview.inYourLibraryOpen")}
            </Button>
            <Button
              variant="ghost"
              onClick={handleRemoveFromLibrary}
              disabled={libraryLoading}
              aria-label={t("book.overview.removeFromLibraryAria")}
              className="hover:text-danger"
            >
              {libraryLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {t("book.overview.removeFromLibrary")}
            </Button>
          </>
        )}

        {/* study-tool generators require the book to be in the user's
            library, don't spawn quizzes/whiteboards/exams for a catalog
            book that hasn't been added yet */}
        {inLibrary && <StudyToolsDropdown />}

        <DownloadButton actions={downloadActions} />
      </div>

      {!hasReadable && (
        <div className="space-y-2">
          <NoFileBanner />
          {/* catalog book has no downloadable file: let them upload their own PDF */}
          {user && inLibrary && (
            <CatalogUploadOwnCopyButton
              catalogBookId={book.id}
              fallbackTitle={book.title}
              fallbackAuthor={book.authors[0]}
              onUploaded={() => removeFromUserLibrary(book.id)}
            />
          )}
        </div>
      )}

      {/* reading status only makes sense once the book is in the library;
          before that the only relevant action is "Add to library" */}
      {user && inLibrary && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BookStatusPicker />
        </div>
      )}

      {readError === "cors-fallback" && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          {t("book.overview.readCorsFallback")}
        </p>
      )}

      {book.ia_id && (
        <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
          {t("book.overview.publicDomainHint")}
        </p>
      )}

      {book.description && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            {t("book.overview.description")}
          </h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
            {book.description}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-glass-border bg-glass-bg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t("ratings.blockTitle")}
            </h3>
            <StarRatingDisplay
              avg={ratingAgg.avg}
              count={ratingAgg.count}
              size={14}
              className="mt-1"
            />
          </div>
          {!user ? (
            <Link to="/auth" className="text-xs text-accent hover:underline">
              {t("ratings.signInToRate")}
            </Link>
          ) : inLibrary ? (
            <div className="flex items-center gap-3">
              <StarRatingInput
                value={myRating}
                onChange={handleRate}
                onClear={handleClearRating}
                size={24}
              />
              {myRating != null && (
                <span className="text-xs text-text-muted">
                  {t("ratings.yourRating", { stars: myRating })}
                </span>
              )}
            </div>
          ) : (
            // rating is a library-only action, a catalog book you're merely
            // previewing can't be rated until you add it
            <span className="text-xs text-text-muted">
              {t("ratings.addToLibraryToRate")}
            </span>
          )}
        </div>
      </div>

      <MetaGrid
        entries={[
          { label: t("book.overview.meta.publisher"), value: book.publisher },
          {
            label: t("book.overview.meta.published"),
            value: book.published_date,
          },
          {
            label: t("book.overview.meta.pages"),
            // once in the library, the pages row doubles as editable
            // reading progress; otherwise just the static page count
            node: inLibrary ? (
              <ReadingProgressValue
                docId={book.id}
                pageCount={book.page_count ?? null}
              />
            ) : undefined,
            value: book.page_count ? String(book.page_count) : null,
          },
          { label: t("book.overview.meta.language"), value: book.language },
          { label: t("book.overview.meta.isbn13"), value: book.isbn_13 },
          { label: t("book.overview.meta.isbn10"), value: book.isbn_10 },
        ]}
      />

      {(categories.length > 0 || book.categories.length > 0) && (
        <div>
          <span className="text-sm text-text-muted">
            {t("book.overview.categories")}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.length > 0
              ? categories.map((cat) => (
                  <CategoryChip key={cat.id} category={cat} />
                ))
              : book.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                  >
                    {cat}
                  </span>
                ))}
          </div>
        </div>
      )}
      {ConfirmModalElement}
    </div>
  );
}

function UploadedOverview({
  book,
  storagePath,
  fileName,
  sizeBytes,
  categories,
}: {
  book: Book;
  storagePath: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  categories: Category[];
}) {
  const { t } = useTranslation();
  const { openUploadedBook } = useOpenUploadedDocument();
  const [loading, setLoading] = useState(false);

  // warm the blob cache so "Open in Reader" skips the network round-trip
  useEffect(() => {
    if (!storagePath) return;
    return prefetchBookBlob(storagePath, { sizeBytes });
  }, [storagePath, sizeBytes]);

  // synthesise the UploadedLibraryItem shape openUploadedBook/getDownloadActions expect
  const uploadedEntry: UploadedLibraryItem | null =
    storagePath && fileName
      ? {
          source: "uploaded",
          id: book.id,
          folder_id: book.folder_id,
          added_at: book.created_at,
          book: {
            id: book.id,
            title: book.title,
            authors: book.authors,
            author: book.author,
            cover_url: book.cover_url,
            page_count: book.page_count,
            format: book.format,
            file_hash: book.file_hash,
            storage_path: storagePath,
            size_bytes: sizeBytes,
            file_name: fileName,
          },
        }
      : null;
  const downloadActions = uploadedEntry
    ? getDownloadActions(uploadedEntry)
    : [];

  const handleOpen = async () => {
    if (!uploadedEntry) return;
    setLoading(true);
    try {
      await openUploadedBook(uploadedEntry);
    } finally {
      setLoading(false);
    }
  };

  // `?open=reader` (set by course-file copies, see space-files.ts
  // routeForCopy) auto-triggers the same "Open in Reader" action so a
  // course file lands straight in the reading view instead of the book
  // Overview page. Strip the param right away so a later back-navigation
  // to this URL doesn't re-trigger it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("open") !== "reader" || !uploadedEntry) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
    void handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, uploadedEntry]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {storagePath && (
          <Button variant="primary" onClick={handleOpen} disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <BookOpen size={16} />
                {t("book.overview.openInReader")}
              </>
            )}
          </Button>
        )}
        <StudyToolsDropdown />
        <DownloadButton actions={downloadActions} />
      </div>

      {!storagePath && (
        <div className="space-y-2">
          <NoFileBanner />
          <AttachFileButton bookId={book.id} />
        </div>
      )}

      {/* compact metadata: status + category side by side, no heavy box */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BookStatusPicker />
        <BookCategoryEditor bookId={book.id} initialCategories={categories} />
      </div>

      <MetaGrid
        entries={[
          {
            label: t("book.overview.meta.pages"),
            node: (
              <ReadingProgressValue
                docId={book.id}
                pageCount={book.page_count ?? null}
              />
            ),
          },
          {
            label: t("book.overview.meta.format"),
            value: book.format ? book.format.toUpperCase() : null,
          },
          {
            label: t("book.overview.meta.size"),
            value: sizeBytes ? formatBytes(sizeBytes) : null,
          },
          {
            label: t("book.overview.meta.fileName"),
            value: fileName,
            wide: true,
          },
        ]}
      />
    </div>
  );
}

function MetaGrid({
  entries,
}: {
  entries: Array<{
    label: string;
    value?: string | null;
    /** Custom value node (e.g. the editable reading-progress). Takes
     *  precedence over `value`; the row shows whenever a node is set. */
    node?: ReactNode;
    wide?: boolean;
  }>;
}) {
  const visible = entries.filter((e) => e.node != null || e.value);
  if (visible.length === 0) return null;
  // Compact single-line-ish metadata row, takes far less space than the
  // old two-column grid.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
      {visible.map((e) => (
        <span key={e.label} className="flex min-w-0 items-center gap-1.5">
          <span>{e.label}:</span>
          {e.node != null ? (
            e.node
          ) : (
            <span className="truncate text-text-secondary">{e.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Runs the normal uploadPdf flow, then patches title/author from catalog metadata
// (PDF metadata for scanned textbooks is usually blank/wrong). On success removes
// the catalog row and navigates to the new uploaded book.
function CatalogUploadOwnCopyButton({
  fallbackTitle,
  fallbackAuthor,
  onUploaded,
}: {
  catalogBookId: string;
  fallbackTitle: string;
  fallbackAuthor?: string;
  onUploaded: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const uploadPdf = useUploadStore((s) => s.uploadPdf);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError(t("book.attach.errorPdfOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { bookId, error: uploadError } = await uploadPdf(file);
      if (uploadError || !bookId) {
        setError(uploadError ?? t("book.attach.failed"));
        setBusy(false);
        return;
      }
      // patch title/author to avoid "untitled.pdf". failure here doesn't roll back the upload.
      try {
        const patch: Record<string, unknown> = { title: fallbackTitle };
        if (fallbackAuthor) {
          patch.author = fallbackAuthor;
          patch.authors = [fallbackAuthor];
        }
        await supabase.from("books").update(patch).eq("id", bookId);
      } catch (err) {
        logError("CatalogUploadOwnCopyButton:patch", err);
      }
      // drop the catalog placeholder now that a real file exists
      try {
        onUploaded();
      } catch (err) {
        logError("CatalogUploadOwnCopyButton:onUploaded", err);
      }
      navigate(`/books/${bookIdSegment(bookId, fallbackTitle)}`);
    } catch (err) {
      logError("CatalogUploadOwnCopyButton:handleFile", err);
      setError(err instanceof Error ? err.message : t("book.attach.failed"));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" onClick={handlePick} disabled={busy}>
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Paperclip size={14} />
        )}
        {t("book.attach.uploadOwnCopy")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  );
}

function NoFileBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
      <FileX2 size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-text-primary">
          {t("book.overview.noFile.title")}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {t("book.overview.noFile.body")}
        </p>
      </div>
    </div>
  );
}
