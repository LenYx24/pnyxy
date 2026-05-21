import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Download,
  FolderInput,
  GripVertical,
  Info,
  Pencil,
  Share2,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, PromptModal, TagBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { bookKey, useTagStore } from "@/stores/tag-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { bookIdSegment } from "@/lib/slugify";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { UnifiedLibraryItem } from "@/types/catalog";
import {
  canDownloadEntry,
  getDownloadActions,
  type DownloadAction,
} from "@/lib/library/download-entry";
import { containsProfanity } from "@/lib/profanity-filter";
import { logError } from "@/lib/logger";
import { TagPickerDropdown } from "../TagPickerDropdown";
import { BookInfoModal } from "../modals/BookInfoModal";
import { ShareBookModal } from "../modals/ShareBookModal";
import {
  DEFAULT_LIST_COLUMN_WIDTHS,
  type ListColumnWidths,
} from "../useLibraryPrefs";
import { ContextMenu, MenuItem } from "./MenuButton";
import {
  formatDate,
  getAuthor,
  getFileSize,
  getTitle,
  type RowDensity,
} from "./helpers";

interface BookRowProps {
  entry: UnifiedLibraryItem;
  depth?: number;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
  density?: RowDensity;
  sortableId?: string;
  columnWidths?: ListColumnWidths;
}

export function BookRow({
  entry,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  onMove,
  onRemove,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
}: BookRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { openUploadedBook } = useOpenUploadedDocument();
  // Same in-progress check as the grid view; library-store hydrates
  // the set on Library mount.
  const isInProgress = useLibraryStore((s) =>
    s.inProgressDocIds.has(
      entry.source === "catalog" ? entry.catalog_book_id : entry.book.id,
    ),
  );

  const isTopLevel = depth === 0;
  // Top-level: sortable (sibling reorder + drag). Nested: draggable
  // only — same drag UX, just not part of any sortable list.
  const sortable = useSortable({
    id: sortableId ?? `book:${entry.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `book:${entry.id}`,
    disabled: isTopLevel,
  });
  const setNodeRef = isTopLevel ? sortable.setNodeRef : draggable.setNodeRef;
  const attributes = isTopLevel ? sortable.attributes : draggable.attributes;
  const listeners = isTopLevel ? sortable.listeners : draggable.listeners;
  const isDragging = isTopLevel ? sortable.isDragging : draggable.isDragging;
  const transform = isTopLevel ? sortable.transform : draggable.transform;
  const transition = isTopLevel ? sortable.transition : undefined;

  // Apply the drag transform regardless of nesting so the row visibly
  // follows the cursor while being dragged.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  // Download options for this row — single item for uploaded books,
  // up to three for public-domain catalog scans (PDF / EPUB / TXT).
  // Empty array when the catalog entry has no downloadable artifact
  // (commercial-only metadata).
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
  // Anchor for the tag picker. Wraps the ContextMenu's button area so
  // the picker pops near the 3-dots (which is the "Manage tags" entry
  // they just clicked from). The 3-dots button itself is owned by
  // ContextMenu so we can't ref it directly — wrapping is simpler.
  const tagAnchorRef = useRef<HTMLDivElement>(null);
  const tagKey = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const customTags = useTagStore((s) => s.customTagsByBook.get(tagKey)) ?? [];
  const selKey = `book:${entry.id}`;
  const title = getTitle(entry);
  const author = getAuthor(entry);
  const coverUrl =
    entry.source === "catalog"
      ? entry.catalog_book.cover_url
      : entry.book.cover_url;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    // Pre-bake slug — same reasoning as the grid card.
    if (entry.source === "catalog") {
      navigate(
        `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
      );
    } else {
      navigate(`/books/${bookIdSegment(entry.book.id, entry.book.title)}`);
    }
  };

  const indent = Math.min(depth * 20, 80);

  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: "Open",
        icon: BookOpen,
        onClick: () => {
          if (entry.source === "catalog") {
            navigate(
              `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
            );
          } else {
            navigate(
              `/books/${bookIdSegment(entry.book.id, entry.book.title)}`,
            );
          }
        },
      },
      {
        id: "info",
        label: "File info",
        icon: Info,
        onClick: () => setInfoOpen(true),
      },
      {
        id: "tags",
        label: "Manage tags",
        icon: Tag,
        onClick: () => setTagPickerOpen(true),
      },
      {
        id: "move",
        label: "Move to folder…",
        icon: FolderInput,
        onClick: () => onMove(entry),
      },
    ];
    if (entry.source === "uploaded") {
      items.push({
        id: "rename",
        label: t("library.actions.rename", { defaultValue: "Rename" }),
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
        label: "Share with community",
        icon: Share2,
        onClick: () => setShareOpen(true),
      });
    }
    items.push({ id: "div-1", divider: true });
    items.push({
      id: "remove",
      label: entry.source === "uploaded" ? "Delete" : "Remove from library",
      icon: Trash2,
      danger: true,
      onClick: () => onRemove(entry),
    });
    return items;
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 48px",
      }}
      {...attributes}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          "group flex select-none items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Drag handle — visual cue; the entire row is draggable. */}
        <div className="mr-1 shrink-0 text-text-muted/50" aria-hidden="true">
          <GripVertical size={14} />
        </div>

        {/* Checkbox */}
        <div
          className={cn(
            "mr-1.5 flex shrink-0 items-center transition-opacity sm:mr-2",
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

        {/* Spacer matching chevron in folder rows */}
        <div className="mr-1 hidden w-[26px] sm:block" />

        {/* Cover thumbnail — 5:7 mini-cover. Falls back to a gradient
            tile with the first letter when no cover is available. */}
        <div className="mr-2.5 aspect-[5/7] h-8 shrink-0 overflow-hidden rounded-sm bg-glass-bg sm:h-9">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/25 to-accent-blue/25">
              <span className="text-xs font-bold text-white/30">
                {title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Title */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-text-primary",
            density.text,
          )}
          title={`${title}${author ? " — " + author : ""}`}
        >
          {title}
        </span>

        {/* Tag badges */}
        {(tags.length > 0 || customTags.length > 0) && (
          <div className="mr-2 hidden shrink-0 items-center gap-1 sm:flex">
            {tags.slice(0, 2).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
            {customTags.slice(0, 2).map((label) => (
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

        {isInProgress && (
          <span className="mr-2 hidden items-center gap-1 rounded bg-accent-purple/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white sm:inline-flex">
            {t("library.reading")}
          </span>
        )}

        {entry.source === "uploaded" && (
          <span className="mr-2 hidden items-center gap-1 rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple sm:inline-flex">
            <Upload size={9} />
            Uploaded
          </span>
        )}

        {/* Author */}
        <span
          className="mr-4 hidden shrink-0 truncate text-xs text-text-muted md:block"
          style={{ width: columnWidths.author }}
        >
          {author}
        </span>

        {/* Size */}
        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.size }}
        >
          {getFileSize(entry) ?? "—"}
        </span>

        {/* Date */}
        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(entry.added_at)}
        </span>

        {entry.source === "uploaded" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void openUploadedBook(entry);
            }}
            aria-label={t("library.actions.openInReader")}
            title={t("library.actions.openInReader")}
            className="mr-1.5 shrink-0 rounded-md bg-accent-purple/15 p-1.5 text-accent-purple transition-colors hover:bg-accent-purple/25 cursor-pointer"
          >
            <BookOpen size={14} />
          </button>
        )}

        {/* Menu */}
        <div ref={tagAnchorRef} className="relative">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={Info}
              label="File Info"
              onClick={() => {
                setMenuOpen(false);
                setInfoOpen(true);
              }}
            />
            <MenuItem
              icon={Tag}
              label="Manage Tags"
              onClick={() => {
                setMenuOpen(false);
                setTagPickerOpen(true);
              }}
            />
            <MenuItem
              icon={FolderInput}
              label="Move to Folder"
              onClick={() => {
                setMenuOpen(false);
                onMove(entry);
              }}
            />
            {entry.source === "uploaded" && (
              <MenuItem
                icon={Pencil}
                label={t("library.actions.rename", { defaultValue: "Rename" })}
                onClick={() => {
                  setMenuOpen(false);
                  setRenameOpen(true);
                }}
              />
            )}
            {downloadActions.map((action) => (
              <MenuItem
                key={action.key}
                icon={Download}
                label={downloadLabel(action)}
                onClick={() => void runDownload(action)}
              />
            ))}
            {entry.source === "uploaded" && (
              <MenuItem
                icon={Share2}
                label="Share with community"
                onClick={() => {
                  setMenuOpen(false);
                  setShareOpen(true);
                }}
              />
            )}
            <MenuItem
              icon={Trash2}
              label={
                entry.source === "uploaded" ? "Delete" : "Remove from Library"
              }
              danger
              onClick={() => {
                setMenuOpen(false);
                onRemove(entry);
              }}
            />
          </ContextMenu>
          {tagPickerOpen && (
            <TagPickerDropdown
              item={entry}
              anchorRef={tagAnchorRef}
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
