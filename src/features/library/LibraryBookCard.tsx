import { useMemo, useRef, useState, useEffect } from "react";
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
  GraduationCap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useSortable } from "@dnd-kit/sortable";
import { useDropIntent } from "./drag-intent";
import { DropIndicator } from "./DropIndicator";
import { CSS } from "@dnd-kit/utilities";
import {
  Checkbox,
  CustomTagBadge,
  FloatingMenu,
  PromptModal,
  TagBadge,
} from "@/components/ui";
import {
  canDownloadEntry,
  getDownloadActions,
  type DownloadAction,
} from "@/lib/library/download-entry";
import { containsProfanity } from "@/lib/profanity-filter";
import { logError } from "@/lib/logger";
import { PdfCoverThumbnail } from "@/components/ui/PdfCoverThumbnail";
import { useLibraryStore } from "@/stores/library-store";
import { useSpaceStore } from "@/stores/space-store";
import { useTagStore, bookKey } from "@/stores/tag-store";
import {
  useOpenUploadedDocument,
  prefetchBookBlob,
} from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { bookIdSegment } from "@/lib/slugify";
import { TagPickerDropdown } from "./TagPickerDropdown";
import { ShareBookModal } from "./modals/ShareBookModal";
import { BookInfoModal } from "./modals/BookInfoModal";
import { cn } from "@/lib/cn";
import { prefetchBookPage } from "@/features/book/prefetch";
import { formatAuthors } from "@/lib/library/format-authors";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface LibraryBookCardProps {
  entry: UnifiedLibraryItem;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
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
  const { openCatalogBook } = useOpenCatalogBook();
  // "Reading" pill for books with a saved resume position
  const isInProgress = useLibraryStore((s) =>
    s.inProgressDocIds.has(
      entry.source === "catalog" ? entry.catalog_book_id : entry.book.id,
    ),
  );
  // Course provenance (books.source_space_id): show a course badge instead
  // of the generic "uploaded" glyph. The name comes from the user's joined
  // spaces when available, otherwise a generic label.
  const courseSpaceId =
    entry.source === "uploaded" ? entry.book.source_space_id : null;
  const courseName = useSpaceStore((s) =>
    courseSpaceId
      ? (s.mySpaces.find((sp) => sp.id === courseSpaceId)?.name ?? null)
      : null,
  );

  const sortable = useSortable({
    id: sortableId ?? entry.id,
    disabled: !sortableId,
  });
  const dropPosition = useDropIntent(sortableId);
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

  const downloadActions: DownloadAction[] = useMemo(
    () => (canDownloadEntry(entry) ? getDownloadActions(entry) : []),
    [entry],
  );
  const downloadLabel = (action: DownloadAction): string => {
    if (action.format === "original") {
      return t("library.actions.download");
    }
    return t("library.actions.downloadFormat", {
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
      ? formatAuthors(entry.catalog_book.authors) || "Unknown author"
      : formatAuthors(entry.book.authors, entry.book.author) ||
        "Unknown author";
  const coverUrl =
    entry.source === "catalog"
      ? entry.catalog_book.cover_url
      : entry.book.cover_url;

  const selKey = `book:${entry.id}`;
  const compact = coverHeight < 100;

  // A click opens the book straight into the reader (less friction); the
  // book's overview page is reachable via the corner button + context menu.
  // Falls back to the overview page when there's no readable file.
  // Hover-intent prefetch: after the cursor rests on the card for a
  // moment, warm the blob cache so the click opens from memory. The
  // timer keeps a fast sweep across the grid from downloading every book.
  const hoverTimerRef = useRef<number | null>(null);
  const cancelPrefetchRef = useRef<(() => void) | null>(null);
  const handleHoverStart = () => {
    prefetchBookPage();
    if (entry.source !== "uploaded" || !entry.book.storage_path) return;
    if (hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      cancelPrefetchRef.current = prefetchBookBlob(entry.book.storage_path!, {
        sizeBytes: entry.book.size_bytes,
      });
    }, 250);
  };
  const handleHoverEnd = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };
  useEffect(
    () => () => {
      handleHoverEnd();
      // an in-flight prefetch is left to finish: the cache is shared and
      // the user may still open the book from elsewhere
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openReader = () => {
    if (entry.source === "uploaded") {
      if (entry.book.storage_path) {
        void openUploadedBook(entry);
        return;
      }
    } else if (entry.catalog_book.download_url || entry.catalog_book.ia_id) {
      void openCatalogBook(entry.catalog_book);
      return;
    }
    openBook();
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    openReader();
  };

  const openBook = () => {
    if (entry.source === "catalog") {
      navigate(
        `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
      );
    } else {
      navigate(`/books/${bookIdSegment(entry.book.id, entry.book.title)}`);
    }
  };

  // Plain right-click (or long-press on touch) opens the same actions the
  // 3-dot menu exposes, so users don't have to hunt for the hover-only button.
  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: t("library.actions.openInReader"),
        icon: BookOpen,
        onClick: openReader,
      },
      {
        id: "book-page",
        label: t("book.overview.openBookPage"),
        icon: Info,
        onClick: openBook,
      },
      {
        id: "info",
        label: t("library.actions.fileInfo"),
        icon: Info,
        onClick: () => setInfoOpen(true),
      },
      {
        id: "tags",
        label: t("library.actions.manageTags"),
        icon: Tag,
        onClick: () => setTagPickerOpen(true),
      },
      {
        id: "move",
        label: t("library.actions.moveToFolder"),
        icon: FolderInput,
        onClick: () => onMove(entry),
      },
    ];
    if (entry.source === "uploaded") {
      items.push({
        id: "rename",
        label: t("library.actions.rename"),
        icon: Pencil,
        onClick: () => setRenameOpen(true),
      });
    }
    for (const action of downloadActions) {
      items.push({
        id: `download-${action.key}`,
        label: downloadLabel(action),
        icon: Download,
        onClick: () => void runDownload(action),
      });
    }
    if (entry.source === "uploaded") {
      items.push({
        id: "share",
        label: t("library.actions.shareToCommunity"),
        icon: Share2,
        onClick: () => setShareOpen(true),
      });
    }
    items.push({ id: "div-1", divider: true });
    items.push({
      id: "remove",
      label:
        entry.source === "uploaded"
          ? t("common.delete")
          : t("library.confirm.removeAction"),
      icon: Trash2,
      danger: true,
      onClick: () => onRemove(entry),
    });
    return items;
  });

  // content-visibility:auto skips offscreen paint; intrinsic-size keeps the
  // scrollbar stable. +80px is the title/author block under the cover.
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
        {...contextHandlers}
        className={cn(
          "group relative",
          selected && "rounded-md ring-2 ring-text-muted",
          isDragging && "opacity-40",
        )}
      >
        <DropIndicator position={dropPosition} orientation="card" />
        <div
          onClick={handleClick}
          onMouseEnter={handleHoverStart}
          onMouseLeave={handleHoverEnd}
          onPointerDown={prefetchBookPage}
          title={`${title}${author ? " - " + author : ""}`}
          className="cursor-pointer"
        >
          {/* Cover, fixed 2:3 aspect so all cards match size */}
          <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md bg-bg-tertiary shadow-page transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                // lazy so a big library doesn't fire all cover fetches at once
                loading="lazy"
                decoding="async"
                // native image drag hijacks the pointer stream and breaks dnd-kit
                draggable={false}
                className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
              />
            ) : entry.source === "uploaded" ? (
              // fills the aspect-[5/7] parent so uploaded covers cover the card
              <PdfCoverThumbnail
                storagePath={entry.book.storage_path}
                fallbackLetter={title.charAt(0)}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-bg-tertiary">
                <span
                  className={cn(
                    "font-display font-semibold text-text-muted-2",
                    compact ? "text-2xl" : "text-4xl",
                  )}
                >
                  {title.charAt(0)}
                </span>
              </div>
            )}

            {/* Selection checkbox */}
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
                  onChange={() =>
                    onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })
                  }
                />
              </div>
            )}

            {/* course-origin badge (books.source_space_id), else the
                generic uploaded-source glyph */}
            {courseSpaceId ? (
              <span
                className="absolute bottom-1.5 left-1.5 rounded bg-accent p-0.5 text-white backdrop-blur-sm"
                title={
                  courseName
                    ? t("library.fromCourse", { name: courseName })
                    : t("library.fromCourseGeneric")
                }
              >
                <GraduationCap size={10} />
              </span>
            ) : entry.source === "uploaded" ? (
              <span
                className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-text-secondary backdrop-blur-sm"
                title="Uploaded file"
              >
                <Upload size={10} />
              </span>
            ) : null}

            {/* "Reading" pill, hidden in selection mode so it doesn't
                overlap the checkbox in the same corner */}
            {isInProgress && !selectionActive && !selected && (
              <span
                className="absolute left-1.5 top-1.5 rounded-chip bg-bg-primary/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-primary backdrop-blur-sm sm:opacity-100 sm:group-hover:opacity-0"
                title={t("library.reading")}
              >
                {t("library.reading")}
              </span>
            )}

            {/* The card click opens the reader; this corner button opens the
                book's overview/description page instead (lower-friction split).
                Always visible on touch, hover-reveal on desktop. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                openBook();
              }}
              aria-label={t("book.overview.openBookPage")}
              title={t("book.overview.openBookPage")}
              className="absolute bottom-1.5 right-1.5 z-10 rounded-lg bg-bg-primary/80 p-1.5 text-text-secondary shadow-sm backdrop-blur-sm transition-all hover:bg-bg-primary hover:text-text-primary cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
            >
              <Info size={16} />
            </button>

            {/* Favorite toggle, hover-reveal on desktop unless set */}
            <button
              onClick={toggleFavorite}
              aria-label={
                isFavorite ? "Remove from favorites" : "Add to favorites"
              }
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

          {/* Info block below the cover */}
          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-medium leading-tight text-text-primary",
                compact ? "text-xs" : "text-[13px]",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-2xs" : "text-xs",
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
                  <CustomTagBadge key={label} label={label} title={label} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3-dot menu; dropdown is portal-rendered so the grid can't clip it */}
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
              >
                <Pencil size={14} />
                {t("library.actions.rename")}
              </button>
            )}
            {downloadActions.map((action) => (
              <button
                key={action.key}
                onClick={(e) => {
                  e.stopPropagation();
                  void runDownload(action);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-surface-3 cursor-pointer"
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
          title={t("library.actions.renameBookTitle")}
          defaultValue={entry.book.title}
          validate={(value) => {
            // PromptModal already trims + rejects empty; store re-validates too
            if (value.length > 200) {
              return t("library.actions.renameTooLong");
            }
            if (containsProfanity(value)) {
              return t("library.actions.renameProfanity");
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
