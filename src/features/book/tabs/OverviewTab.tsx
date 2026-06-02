import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Check,
  Loader2,
  BookOpen,
  FileText,
  FileX2,
  Paperclip,
  Trash2,
  PenLine,
  Sparkles,
  ScrollText,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import {
  Button,
  CategoryChip,
  StarRatingDisplay,
  StarRatingInput,
} from "@/components/ui";
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
import type {
  CatalogBook,
  UploadedLibraryItem,
} from "@/types/catalog";
import type { Book, Category } from "@/types/database";
import { useBook } from "../BookPageContext";
import { RelatedToBook } from "../RelatedToBook";
import { BookStatusPicker } from "../BookStatusPicker";
import { BookCategoryEditor } from "../BookCategoryEditor";
import { AttachFileButton } from "../AttachFileButton";
import { DownloadButton } from "../DownloadButton";
import { ReadingSessionCard } from "../ReadingSessionCard";

/**
 * Button that creates a standalone whiteboard and navigates to it.
 * Works for any book — file-backed or shell. For shell books this is
 * the primary way users can use the whiteboard feature at all,
 * since the reader can't open them.
 */
/**
 * One-click entry into the AI quiz generator for the current book.
 * Creates an empty quiz row tied to this book and navigates to its
 * editor with the AI generate panel pre-expanded — so the user lands
 * directly on "From book: pages X–Y, count N, Generate" instead of
 * having to: (1) open the quizzes list, (2) "New quiz", (3) find the
 * AI panel, (4) toggle to "From book". Half the clicks become zero.
 */
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

/**
 * Shortcut to the flashcards generator. Same pattern as the quiz
 * shortcut: pre-create the row tied to this book, navigate to the
 * editor with the AI panel auto-expanded AND in short-answer mode
 * (so the panel generates Q/A pairs instead of multi-choice).
 */
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

/**
 * Shortcut to the book's exams tab. Past papers live under there with
 * their own AI flows (extract topics, generate similar quiz, practice
 * mode). Surfacing this on the Overview saves the user a sidebar
 * click — the most-frequent ask from study sessions is "what's been
 * on past exams", so it's worth the prime real estate.
 */
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
      {/* Second grouping axis: everything in the user's library that's
          ABOUT this book (quizzes/chats/whiteboards/flashcards),
          independent of filetree folder placement. */}
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

  // Local copy of the aggregate so a rating action updates the UI
  // without needing to re-fetch the book through useBookData.
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

  // Licensing-gated downloads. Public-domain IA scans expose three
  // formats (PDF / EPUB / TXT); explicit catalog `download_url`
  // entries expose one. Commercial catalog rows have neither and
  // DownloadButton renders nothing.
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
        {/* Read — primary CTA when the book has an attached file.
            Streams the remote URL into the reader; falls back to a
            new-tab download when CORS blocks the fetch. */}
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

        {/* Library: separate Add vs (Open/Remove) buttons so clicks
            never surprise the user. When in library: "Open library"
            is primary, "Remove" is an unobtrusive ghost beside it. */}
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
              <Check size={16} className="text-green-400" />
              {t("book.overview.inYourLibraryOpen")}
            </Button>
            <Button
              variant="ghost"
              onClick={handleRemoveFromLibrary}
              disabled={libraryLoading}
              aria-label={t("book.overview.removeFromLibraryAria")}
              className="hover:text-red-400"
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

        {/* Works for every book — file-backed or shell. Placed next
            to the Library buttons since it's a "study tool" entry
            point the same way. */}
        <CreateWhiteboardButton />
        <GenerateQuizFromBookButton />
        <GenerateFlashcardsFromBookButton />
        <GenerateExamFromBookButton />

        {/* Download dropdown (PDF / EPUB / TXT for IA scans, single
            link for catalog rows with a direct download_url). Renders
            nothing for commercial-only entries — same licensing gate
            the library cards use. */}
        <DownloadButton actions={downloadActions} />
      </div>

      {!hasReadable && (
        <div className="space-y-2">
          <NoFileBanner />
          {/* User added this catalog book to their library but the
              catalog doesn't ship with a downloadable file. Let them
              upload their own PDF so they can actually read it —
              otherwise the library entry is dead weight. The upload
              creates a normal "uploaded book" with the catalog
              metadata pre-filled and removes the catalog entry from
              the user's library so they end up with a single, useful
              row instead of two confusing ones. */}
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

      {/* Status picker is the lightest "make this book yours"
          control — useful even before / without opening the book. */}
      {user && (
        <div className="rounded-lg border border-glass-border bg-glass-bg p-4">
          <BookStatusPicker />
        </div>
      )}

      {/* Reading session + per-book stats. Only shown once the book
          is in the user's library — sessions live on a per-doc
          basis and a not-yet-added catalog book has no stats to
          accumulate against. */}
      {user && inLibrary && (
        <ReadingSessionCard docId={book.id} pageCount={book.page_count ?? null} />
      )}

      {readError === "cors-fallback" && (
        <p className="rounded-lg bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          {t("book.overview.readCorsFallback")}
        </p>
      )}

      {book.ia_id && (
        <p className="rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">
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
          {user ? (
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
            <Link
              to="/auth"
              className="text-xs text-accent-purple hover:underline"
            >
              {t("ratings.signInToRate")}
            </Link>
          )}
        </div>
      </div>

      <MetaGrid
        entries={[
          { label: t("book.overview.meta.publisher"), value: book.publisher },
          { label: t("book.overview.meta.published"), value: book.published_date },
          {
            label: t("book.overview.meta.pages"),
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
                    className="rounded-full bg-accent-purple/10 px-3 py-1 text-xs font-medium text-accent-purple"
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

  // Warm the blob cache in the background so clicking "Open in Reader"
  // skips the network round-trip. Skipped on low-end devices and large
  // files inside prefetchBookBlob; cancelled if the user navigates
  // away before it finishes.
  useEffect(() => {
    if (!storagePath) return;
    return prefetchBookBlob(storagePath, { sizeBytes });
  }, [storagePath, sizeBytes]);

  // Built once and reused by both "Open in reader" and the Download
  // button. Synthesising the UploadedLibraryItem here matches the
  // shape every downstream consumer already expects (openUploadedBook,
  // getDownloadActions), keeping this page from drifting away from
  // the library card surfaces.
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
  const downloadActions = uploadedEntry ? getDownloadActions(uploadedEntry) : [];

  const handleOpen = async () => {
    if (!uploadedEntry) return;
    setLoading(true);
    try {
      await openUploadedBook(uploadedEntry);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {storagePath && (
          <Button
            variant="primary"
            onClick={handleOpen}
            disabled={loading}
          >
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
        <CreateWhiteboardButton />
        <GenerateQuizFromBookButton />
        <GenerateFlashcardsFromBookButton />
        <GenerateExamFromBookButton />
        <DownloadButton actions={downloadActions} />
      </div>

      {!storagePath && (
        <div className="space-y-2">
          <NoFileBanner />
          <AttachFileButton bookId={book.id} />
        </div>
      )}

      <div className="rounded-lg border border-glass-border bg-glass-bg p-4 space-y-4">
        <BookStatusPicker />
        <BookCategoryEditor
          bookId={book.id}
          initialCategories={categories}
        />
      </div>

      {/* Per-book reading session timer + derived stats (streak,
          pace, finish-date). docId mirrors what PageTracker uses. */}
      <ReadingSessionCard docId={book.id} pageCount={book.page_count ?? null} />

      {storagePath && (
        <div className="rounded-lg border border-glass-border bg-glass-bg/50 p-4 text-sm">
          <p className="mb-1 flex items-center gap-1.5 text-text-muted">
            <FileText size={14} />
            {t("book.overview.uploadedFile")}
          </p>
          <p className="text-xs text-text-secondary">
            {t("book.overview.uploadedHint")}
          </p>
        </div>
      )}

      <MetaGrid
        entries={[
          {
            label: t("book.overview.meta.pages"),
            value: book.page_count ? String(book.page_count) : null,
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
  entries: Array<{ label: string; value: string | null; wide?: boolean }>;
}) {
  const visible = entries.filter((e) => e.value);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      {visible.map((e) => (
        <div key={e.label} className={e.wide ? "sm:col-span-2" : undefined}>
          <span className="text-text-muted">{e.label}</span>
          <p className="truncate text-text-primary">{e.value}</p>
        </div>
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

/**
 * Banner shown when the book has no readable file attached. Catalog
 * books without a download URL and shell uploaded books with no
 * storage_path land here. Lets the reader know notes/whiteboards/forum
 * still work — their attempt to open the book wasn't a bug.
 */
/**
 * "Upload your own copy" — sibling to the catalog metadata Open
 * Library couldn't link a file for. Runs the normal uploadPdf flow
 * so storage limits / progress / dedup all still work, then patches
 * the book row with the catalog's title/author so the new entry
 * doesn't fall back to whatever the PDF metadata happens to claim
 * (which for scanned textbooks is usually blank or wrong).
 *
 * On success the catalog row is removed from the user's library
 * (via `onUploaded`) and the page navigates to the new uploaded
 * book so the user lands somewhere they can actually open.
 */
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
      setError(
        t("book.attach.errorPdfOnly", {
          defaultValue: "Only PDF files are supported.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { bookId, error: uploadError } = await uploadPdf(file);
      if (uploadError || !bookId) {
        setError(
          uploadError ??
            t("book.attach.failed", { defaultValue: "Upload failed." }),
        );
        setBusy(false);
        return;
      }
      // Patch the new books row with the catalog's title/author so we
      // don't end up with "untitled.pdf" when the PDF metadata is
      // missing. Best-effort: a failure here doesn't roll back the
      // upload — the file is already attached and openable.
      try {
        const patch: Record<string, string> = { title: fallbackTitle };
        if (fallbackAuthor) patch.author = fallbackAuthor;
        await supabase.from("books").update(patch).eq("id", bookId);
      } catch (err) {
        logError("CatalogUploadOwnCopyButton:patch", err);
      }
      // Free the catalog row from the user's library — they now own
      // the real file, so the placeholder is just noise.
      try {
        onUploaded();
      } catch (err) {
        logError("CatalogUploadOwnCopyButton:onUploaded", err);
      }
      navigate(`/books/${bookIdSegment(bookId, fallbackTitle)}`);
    } catch (err) {
      logError("CatalogUploadOwnCopyButton:handleFile", err);
      setError(
        err instanceof Error
          ? err.message
          : t("book.attach.failed", { defaultValue: "Upload failed." }),
      );
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
        {t("book.attach.uploadOwnCopy", {
          defaultValue: "Upload your own PDF",
        })}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function NoFileBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
      <FileX2 size={18} className="mt-0.5 shrink-0 text-yellow-400" />
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
