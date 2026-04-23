import { useState, useRef, useEffect } from "react";
import {
  MoreVertical,
  FolderInput,
  Trash2,
  Upload,
  Tag,
  Share2,
  Info,
  Heart,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, GlassCard, TagBadge } from "@/components/ui";
import { PdfCoverThumbnail } from "@/components/ui/PdfCoverThumbnail";
import { useTagStore, bookKey } from "@/stores/tag-store";
import { TagPickerDropdown } from "./TagPickerDropdown";
import { ShareBookModal } from "./ShareBookModal";
import { BookInfoModal } from "./BookInfoModal";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const key = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(key)) ?? [];
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

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

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
    if (entry.source === "catalog") {
      navigate(`/books/${entry.catalog_book_id}`);
    } else {
      navigate(`/books/${entry.book.id}`);
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <GlassCard
        className={cn(
          "group relative cursor-pointer",
          selected && "ring-2 ring-accent-purple bg-accent-purple/5",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick}>
          {/* Selection checkbox */}
          {onToggleSelect && (
            <div
              className={cn(
                "absolute left-2 top-2 z-10 transition-opacity",
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

          {/* Cover */}
          <div className="w-full overflow-hidden rounded-t-xl" style={{ height: coverHeight }}>
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                className="h-full w-full object-cover"
              />
            ) : entry.source === "uploaded" ? (
              <PdfCoverThumbnail
                storagePath={entry.book.storage_path}
                fallbackLetter={title.charAt(0)}
                height={coverHeight}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30">
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
          </div>

          {/* "Uploaded" badge */}
          {entry.source === "uploaded" && (
            <span
              className={cn(
                "absolute top-2 flex items-center gap-1 rounded-md bg-accent-purple/80 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm",
                onToggleSelect ? "left-8" : "left-2",
              )}
            >
              <Upload size={10} />
              Uploaded
            </span>
          )}

          {/* Favorite toggle — always visible on mobile, hover on desktop
              when not already set. Positioned below the menu button. */}
          <button
            onClick={toggleFavorite}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            className={cn(
              "absolute right-2 top-11 z-10 rounded-lg p-1.5 backdrop-blur-sm transition-colors cursor-pointer",
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

          {/* Info */}
          <div className={cn("p-3", compact && "p-2")}>
            <h3
              className={cn(
                "mb-0.5 truncate font-semibold text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate text-text-muted",
                compact ? "text-[10px]" : "text-xs",
              )}
            >
              {author}
            </p>
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag} tag={tag} size="sm" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} className="absolute right-2 top-2">
          <button
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

          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl">
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
            </div>
          )}
          {tagPickerOpen && (
            <TagPickerDropdown
              item={entry}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </div>
      </GlassCard>

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
    </div>
  );
}
