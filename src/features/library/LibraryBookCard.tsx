import { useMemo, useRef, useState } from "react";
import {
  MoreVertical,
  FolderInput,
  Trash2,
  Upload,
  Tag,
  Share2,
  Info,
  Heart,
  BookOpen,
  Download,
  Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, FloatingMenu, PromptModal, TagBadge } from "@/components/ui";
import {
  canDownloadEntry,
  getDownloadActions,
  type DownloadAction,
} from "@/lib/library/download-entry";
import { containsProfanity } from "@/lib/profanity-filter";
import { logError } from "@/lib/logger";
import { PdfCoverThumbnail } from "@/components/ui/PdfCoverThumbnail";
import { useLibraryStore } from "@/stores/library-store";
import { useTagStore, bookKey } from "@/stores/tag-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { bookIdSegment } from "@/lib/slugify";
import { TagPickerDropdown } from "./TagPickerDropdown";
import { ShareBookModal } from "./modals/ShareBookModal";
import { BookInfoModal } from "./modals/BookInfoModal";
import { cn } from "@/lib/cn";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface LibraryBookCardProps {
  entry: UnifiedLibraryItem;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  sortableId?: string;
}

export function LibraryBookCard({
  entry,
  onMove,
  onRemove,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  sortableId,
}: LibraryBookCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { openUploadedBook } = useOpenUploadedDocument();
  // Surface a small "Reading" pill on books the user has any saved
  // resume position for. Reads from the library store's set of
  // in-progress doc ids — populated once on Library mount, free to
  // read per-card.
  const isInProgress = useLibraryStore((s) =>
    s.inProgressDocIds.has(entry.source === "catalog" ? entry.catalog_book_id : entry.book.id),
  );

  const sortable = useSortable({ id: sortableId ?? entry.id, disabled: !sortableId });
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const style = sortableId
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Download options: one item for uploaded books, up to three for
  // public-domain catalog scans. Memoised so the menu doesn't
  // rebuild closures on every hover.
  const downloadActions: DownloadAction[] = useMemo(
    () => (canDownloadEntry(entry) ? getDownloadActions(entry) : []),
    [entry],
  );
  const downloadLabel = (action: DownloadAction): string => {
    if (action.format === "original") {
      return t("library.actions.download", { defaultValue: "Download" });
    }
    return t("library.actions.downloadFormat", {
      defaultValue: "Download {{format}}",
      format: action.format.toUpperCase(),
    });
  };
  const runDownload = async (action: DownloadAction) => {
    setMenuOpen(false);
    try {
      await action.run();
    } catch (err) {
      logError("library:downloadAction", err);
    }
  };
  const key = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(key)) ?? [];
  const customTags = useTagStore((s) => s.customTagsByBook.get(key)) ?? [];
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);
  const isFavorite = tags.includes("favorites");

  const toggleFavorite = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isFavorite) removeTag(entry, "favorites");
    else addTag(entry, "favorites");
  };

  const title =
    entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
  const author =
    entry.source === "catalog"
      ? entry.catalog_book.authors?.join(", ") || "Unknown author"
      : entry.book.author || "Unknown author";
  const coverUrl =
    entry.source === "catalog" ? entry.catalog_book.cover_url : entry.book.cover_url;

  const selKey = `book:${entry.id}`;
  const compact = coverHeight < 100;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    // Pre-bake the slug into the URL so first-click navigation
    // skips the canonical-redirect bounce on the BookPage.
    if (entry.source === "catalog") {
      navigate(
        `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
      );
    } else {
      navigate(`/books/${bookIdSegment(entry.book.id, entry.book.title)}`);
    }
  };

  // content-visibility: auto lets the browser skip layout/paint
  // for offscreen cards entirely — same DOM, but rendering only
  // happens once the card scrolls near the viewport. contain-
  // intrinsic-size gives the browser a placeholder dimension so the
  // scrollbar doesn't jump as cards materialize. The numbers come
  // from coverHeight (aspect 5/7 → coverHeight × 7/5 wide) plus
  // ~80px for the title/author block underneath. Cheap polyfill
  // for true virtualization that keeps DnD + grid layout working.
  const intrinsicHeight = coverHeight + 80;
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${intrinsicHeight}px`,
      }}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent-purple rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div
          onClick={handleClick}
          title={`${title}${author ? " — " + author : ""}`}
          className="cursor-pointer"
        >
          {/* Cover — fixed 2:3 aspect so every library card is the
              same visual size regardless of the actual cover image.
              The tinted bg + soft border + shadow make the cover area
              read as an intentional card even when a thumbnail
              doesn't fill it (e.g. shorter PDF page rendered as a
              cover). */}
          <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md border border-glass-border bg-bg-tertiary shadow-sm transition-shadow group-hover:shadow-md">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                // loading=lazy: a 200-book library used to fire ~200
                // simultaneous cover fetches the moment /library
                // mounted, queue-blocking the above-the-fold ones.
                // Now off-screen covers wait until the user scrolls
                // them close. decoding=async keeps the decode off
                // the main thread so even visible covers don't jank
                // the scroll.
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
              />
            ) : entry.source === "uploaded" ? (
              // Thumbnail fills the aspect-[5/7] parent — that's what
              // makes uploaded covers actually cover the card on
              // mobile, instead of a small block stranded at the top.
              <PdfCoverThumbnail
                storagePath={entry.book.storage_path}
                fallbackLetter={title.charAt(0)}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-accent-purple/25 to-accent-blue/25">
                <span
                  className={cn(
                    "font-bold text-white/20",
                    compact ? "text-2xl" : "text-4xl",
                  )}
                >
                  {title.charAt(0)}
                </span>
              </div>
            )}

            {/* Selection checkbox — sits on the cover so it's visible
                on dark covers too. */}
            {onToggleSelect && (
              <div
                className={cn(
                  "absolute left-1.5 top-1.5 z-10 transition-opacity",
                  selectionActive || selected
                    ? "opacity-100"
                    : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onChange={() => onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })}
                />
              </div>
            )}

            {/* Subtle uploaded-source indicator. The full badge has
                been downgraded to a corner glyph to match the catalog
                card's metadata-only icon. */}
            {entry.source === "uploaded" && (
              <span
                className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-accent-purple backdrop-blur-sm"
                title="Uploaded file"
              >
                <Upload size={10} />
              </span>
            )}

            {/* "Reading" pill — visible signal that the user has
                already started this book. Top-left corner; hides
                during selection mode so it doesn't overlap with
                the always-visible checkbox at the same spot. */}
            {isInProgress && !selectionActive && !selected && (
              <span
                className="absolute left-1.5 top-1.5 rounded-full bg-accent-purple/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm backdrop-blur-sm sm:opacity-100 sm:group-hover:opacity-0"
                title={t("library.reading")}
              >
                {t("library.reading")}
              </span>
            )}

            {/* Quick "Open in reader" — only on uploaded books (the
                only source with a file to render). One click straight
                to the reader instead of the two-click default
                (card → book page → Read). */}
            {entry.source === "uploaded" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void openUploadedBook(entry);
                }}
                aria-label={t("library.actions.openInReader")}
                title={t("library.actions.openInReader")}
                className="absolute bottom-1.5 right-1.5 z-10 rounded-lg bg-accent-purple/90 p-1.5 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-accent-purple cursor-pointer"
              >
                <BookOpen size={14} />
              </button>
            )}

            {/* Favorite toggle — hover-reveal on desktop unless set. */}
            <button
              onClick={toggleFavorite}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={cn(
                "absolute right-1.5 top-10 z-10 rounded-lg p-1.5 backdrop-blur-sm transition-colors cursor-pointer",
                isFavorite
                  ? "bg-pink-500/80 text-white hover:bg-pink-500"
                  : "bg-black/40 text-white/70 hover:bg-black/60 hover:text-white",
                isFavorite
                  ? "opacity-100"
                  : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
              )}
            >
              <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          </div>

          {/* Info — plain text below the cover, no card padding. */}
          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-[10px]" : "text-xs",
              )}
            >
              {author}
            </p>
            {(tags.length > 0 || customTags.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag} tag={tag} size="sm" />
                ))}
                {customTags.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full border border-glass-border bg-glass-bg px-1.5 py-0.5 text-[10px] text-text-secondary"
                    title={label}
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3-dot menu — positioned over the cover. The dropdown
            itself is portal-rendered via FloatingMenu so it can't be
            clipped by the card / grid container. */}
        <div className="absolute right-1.5 top-1.5">
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors cursor-pointer",
              "bg-black/40 text-white/70 hover:bg-black/60 hover:text-white",
              menuOpen
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
            )}
          >
            <MoreVertical size={16} />
          </button>

          <FloatingMenu
            open={menuOpen}
            anchorRef={triggerRef}
            onClose={() => setMenuOpen(false)}
            className="w-48"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setInfoOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Info size={14} />
              File Info
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setTagPickerOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Tag size={14} />
              Manage Tags
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onMove(entry);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderInput size={14} />
              Move to Folder
            </button>
            {entry.source === "uploaded" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setRenameOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Pencil size={14} />
                {t("library.actions.rename", { defaultValue: "Rename" })}
              </button>
            )}
            {downloadActions.map((action) => (
              <button
                key={action.key}
                onClick={(e) => {
                  e.stopPropagation();
                  void runDownload(action);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Download size={14} />
                {downloadLabel(action)}
              </button>
            ))}
            {entry.source === "uploaded" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setShareOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Share2 size={14} />
                Share with community
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onRemove(entry);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              {entry.source === "uploaded" ? "Delete" : "Remove from Library"}
            </button>
          </FloatingMenu>
          {tagPickerOpen && (
            <TagPickerDropdown
              item={entry}
              anchorRef={triggerRef}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </div>
      </div>

      {entry.source === "uploaded" && (
        <ShareBookModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          entry={entry}
        />
      )}
      <BookInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        entry={entry}
      />
      {entry.source === "uploaded" && (
        <PromptModal
          open={renameOpen}
          title={t("library.actions.renameBookTitle", {
            defaultValue: "Rename book",
          })}
          defaultValue={entry.book.title}
          validate={(value) => {
            // PromptModal trims + rejects empty before this runs.
            // Length & profanity are surfaced inline so the user
            // can fix without losing the modal context. The store
            // re-validates as defence in depth.
            if (value.length > 200) {
              return t("library.actions.renameTooLong", {
                defaultValue: "Title is too long (max 200 characters).",
              });
            }
            if (containsProfanity(value)) {
              return t("library.actions.renameProfanity", {
                defaultValue: "Title contains disallowed language.",
              });
            }
            return null;
          }}
          onClose={() => setRenameOpen(false)}
          onSubmit={(value) => {
            void useLibraryStore
              .getState()
              .renameBook(entry, value)
              .catch((err) => logError("library:renameBook", err));
          }}
        />
      )}
    </div>
  );
}
