import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Check,
  Download,
  Loader2,
  ExternalLink,
  BookOpen,
  FileText,
  FileX2,
  Trash2,
  PenLine,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import {
  Button,
  CategoryChip,
  StarRatingDisplay,
  StarRatingInput,
} from "@/components/ui";
import { getDownloadOptions } from "@/lib/open-library";
import { useBrowseStore } from "@/stores/browse-store";
import { useAuthStore } from "@/stores/auth-store";
import { useRatingStore } from "@/stores/rating-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import {
  useOpenUploadedDocument,
  prefetchBookBlob,
} from "@/hooks/use-open-uploaded-document";
import { useConfirm } from "@/hooks/use-confirm";
import type {
  CatalogBook,
  DownloadOption,
  UploadedLibraryItem,
} from "@/types/catalog";
import type { Book, Category } from "@/types/database";
import { useBook } from "../BookPageContext";

/**
 * Button that creates a standalone whiteboard and navigates to it.
 * Works for any book — file-backed or shell. For shell books this is
 * the primary way users can use the whiteboard feature at all,
 * since the reader can't open them.
 */
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
  if (data.source === "catalog") {
    return <CatalogOverview book={data.book} categories={data.categories} />;
  }
  return (
    <UploadedOverview
      book={data.book}
      storagePath={data.storagePath}
      fileName={data.fileName}
      sizeBytes={data.sizeBytes}
      categories={data.categories}
    />
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

  let downloads: DownloadOption[] = [];
  if (book.ia_id) {
    downloads = getDownloadOptions(book.ia_id);
  } else if (book.download_url) {
    const ext = book.download_url.split(".").pop()?.toLowerCase();
    const format = ext === "epub" ? "epub" : ext === "txt" ? "txt" : "pdf";
    downloads = [
      { format, url: book.download_url, label: format.toUpperCase() },
    ];
  }

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
  const primaryDownload = downloads[0];

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

        {/* Keep one download fallback for users who want the file
            offline or in a different reader. Single link, not the
            format matrix that was here before. */}
        {primaryDownload && (
          <a
            href={primaryDownload.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-5 py-2.5 text-sm font-medium text-text-primary backdrop-blur-md transition-all duration-200 hover:bg-glass-hover"
          >
            <Download size={16} />
            {t("book.overview.download")}
            <ExternalLink size={12} className="text-text-muted" />
          </a>
        )}
      </div>

      {!hasReadable && <NoFileBanner />}

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

  const handleOpen = async () => {
    if (!storagePath || !fileName) return;
    setLoading(true);
    try {
      const entry: UploadedLibraryItem = {
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
      };
      await openUploadedBook(entry);
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
      </div>

      {!storagePath && <NoFileBanner />}

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

      {categories.length > 0 && (
        <div>
          <span className="text-sm text-text-muted">
            {t("book.overview.categories")}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <CategoryChip key={cat.id} category={cat} />
            ))}
          </div>
        </div>
      )}
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
