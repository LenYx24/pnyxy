import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Download,
  FolderInput,
  Info,
  Pencil,
  Share2,
  Tag,
  Trash2,
} from "lucide-react";
import { useDndContext, useDraggable } from "@dnd-kit/core";
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
import { ContextMenu, MenuItem } from "./MenuButton";
import { RowTile } from "./RowTile";
import { BookDetailPanel, BookProgressCell } from "./BookDetailPanel";
import {
  LIST_GRID_CLASS,
  formatRelative,
  getAuthor,
  getCoverUrl,
  getTitle,
  getTypeLabel,
  handleRowKeyDown,
} from "./helpers";

interface BookRowProps {
  entry: UnifiedLibraryItem;
  depth?: number;
  selected: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
  /** Whether this row's inline detail panel is open. */
  expanded?: boolean;
  /** Plain click on the row: the list decides which row expands. */
  onActivate?: (selKey: string) => void;
  sortableId?: string;
}

export function BookRow({
  entry,
  depth = 0,
  selected,
  onToggleSelect,
  onMove,
  onRemove,
  expanded = false,
  onActivate,
  sortableId,
}: BookRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { openUploadedBook } = useOpenUploadedDocument();

  const isTopLevel = depth === 0;
  // Top-level: sortable (sibling reorder + drag). Nested: draggable
  // only, same drag UX, just not part of any sortable list.
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

  // content-visibility:auto skips off-screen rows for scroll perf, but
  // it collapses their measured rects, which breaks dnd-kit's collision
  // detection during a drag (the drop target resolves to the dragged row
  // itself, so nothing reorders). Disable it while any drag is in flight
  // and while the detail panel is open (its height is not the row's).
  const dragActive = useDndContext().active != null;
  const cvStyle =
    dragActive || expanded
      ? null
      : { contentVisibility: "auto" as const, containIntrinsicSize: "auto 58px" };

  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  // Download options for this row, single item for uploaded books,
  // up to three for public-domain catalog scans (PDF / EPUB / TXT).
  // Empty array when the catalog entry has no downloadable artifact
  // (commercial-only metadata).
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
  // Anchor for the tag picker. Wraps the ContextMenu's button area so
  // the picker pops near the 3-dots (which is the "Manage tags" entry
  // they just clicked from).
  const tagAnchorRef = useRef<HTMLDivElement>(null);
  const tagKey = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const customTags = useTagStore((s) => s.customTagsByBook.get(tagKey)) ?? [];
  const selKey = `book:${entry.id}`;
  const title = getTitle(entry);
  const author = getAuthor(entry);
  const coverUrl = getCoverUrl(entry);

  const openBookPage = () => {
    // Pre-bake slug, same reasoning as the grid card.
    if (entry.source === "catalog") {
      navigate(
        `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
      );
    } else {
      navigate(`/books/${bookIdSegment(entry.book.id, entry.book.title)}`);
    }
  };

  const toggle = (e?: { ctrlKey: boolean; shiftKey: boolean }) =>
    onToggleSelect(selKey, e ?? { ctrlKey: false, shiftKey: false });

  // Plain click expands the inline detail (and selects); modifier
  // clicks only toggle selection; double-click goes straight to the
  // book page.
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggle({ ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    if (onActivate) {
      onActivate(selKey);
      if (!expanded && !selected) toggle();
      return;
    }
    openBookPage();
  };

  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: t("library.actions.open"),
        icon: BookOpen,
        onClick: openBookPage,
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

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...cvStyle,
      }}
      {...attributes}
      data-list-row=""
      onKeyDown={(e) =>
        handleRowKeyDown(e, {
          onOpen: () => (onActivate ? onActivate(selKey) : openBookPage()),
          onToggleSelect: () => toggle(),
        })
      }
      className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          LIST_GRID_CLASS,
          "group h-[58px] select-none border-b border-glass-border text-sm transition-colors hover:bg-glass-hover cursor-pointer",
          (selected || expanded) && "bg-accent/10",
          expanded && "border-b-0",
          isDragging && "opacity-50",
        )}
        onClick={handleClick}
        onDoubleClick={openBookPage}
        aria-expanded={onActivate ? expanded : undefined}
      >
        {/* Checkbox */}
        <div
          className={cn(
            "flex items-center transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} onChange={() => toggle()} />
        </div>

        <RowTile kind="book" coverUrl={coverUrl} />

        {/* Title + author, tags trail the title on wider screens. */}
        <div
          className="flex min-w-0 flex-col gap-0.5"
          title={`${title}${author ? " - " + author : ""}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-text-primary">
              {title}
            </span>
            {(tags.length > 0 || customTags.length > 0) && (
              <span className="hidden shrink-0 items-center gap-1 sm:flex">
                {tags.slice(0, 2).map((tag) => (
                  <TagBadge key={tag} tag={tag} size="sm" />
                ))}
                {customTags.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full border border-glass-border bg-glass-bg px-1.5 py-0.5 text-2xs text-text-secondary"
                    title={label}
                  >
                    {label}
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-text-muted">{author}</span>
        </div>

        {/* Type */}
        <span className="hidden truncate text-text-muted md:block">
          {getTypeLabel(entry, t)}
        </span>

        {/* Progress */}
        <div className="hidden min-w-0 md:block">
          <BookProgressCell entry={entry} />
        </div>

        {/* Modified */}
        <span className="hidden truncate text-text-muted md:block">
          {formatRelative(entry.added_at, t)}
        </span>

        {/* Menu */}
        <div ref={tagAnchorRef} className="relative flex justify-end">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={BookOpen}
              label={t("library.actions.open")}
              onClick={() => {
                setMenuOpen(false);
                openBookPage();
              }}
            />
            {entry.source === "uploaded" && entry.book.storage_path && (
              <MenuItem
                icon={BookOpen}
                label={t("library.actions.openInReader")}
                onClick={() => {
                  setMenuOpen(false);
                  void openUploadedBook(entry);
                }}
              />
            )}
            <MenuItem
              icon={Info}
              label={t("library.actions.fileInfo")}
              onClick={() => {
                setMenuOpen(false);
                setInfoOpen(true);
              }}
            />
            <MenuItem
              icon={Tag}
              label={t("library.actions.manageTags")}
              onClick={() => {
                setMenuOpen(false);
                setTagPickerOpen(true);
              }}
            />
            <MenuItem
              icon={FolderInput}
              label={t("library.actions.moveToFolder")}
              onClick={() => {
                setMenuOpen(false);
                onMove(entry);
              }}
            />
            {entry.source === "uploaded" && (
              <MenuItem
                icon={Pencil}
                label={t("library.actions.rename")}
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
                label={t("library.actions.shareToCommunity")}
                onClick={() => {
                  setMenuOpen(false);
                  setShareOpen(true);
                }}
              />
            )}
            <MenuItem
              icon={Trash2}
              label={
                entry.source === "uploaded"
                  ? t("common.delete")
                  : t("library.confirm.removeAction")
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

      {expanded && <BookDetailPanel entry={entry} />}

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
