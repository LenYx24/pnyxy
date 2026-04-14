import { useState, useRef, useEffect } from "react";
import { MoreVertical, FolderInput, Trash2, Upload } from "lucide-react";
import { useNavigate } from "react-router";
import { GlassCard } from "@/components/ui";
import { useOpenUploadedPdf } from "@/hooks/use-open-uploaded-pdf";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface LibraryBookCardProps {
  entry: UnifiedLibraryItem;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
}

export function LibraryBookCard({ entry, onMove, onRemove }: LibraryBookCardProps) {
  const navigate = useNavigate();
  const { openUploadedBook } = useOpenUploadedPdf();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Derive display data from discriminated union
  const title =
    entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
  const author =
    entry.source === "catalog"
      ? entry.catalog_book.authors?.join(", ") || "Unknown author"
      : entry.book.author || "Unknown author";
  const coverUrl =
    entry.source === "catalog" ? entry.catalog_book.cover_url : entry.book.cover_url;

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

  const handleClick = () => {
    if (entry.source === "catalog") {
      navigate(`/app/browse/${entry.catalog_book_id}`);
    } else {
      openUploadedBook(entry);
    }
  };

  return (
    <GlassCard
      className="relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      {/* Cover */}
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={title}
          className="h-48 w-full object-cover"
        />
      ) : (
        <div className="flex h-48 items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30">
          <span className="text-4xl font-bold text-white/20">
            {title.charAt(0)}
          </span>
        </div>
      )}

      {/* "Uploaded" badge */}
      {entry.source === "uploaded" && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-accent-purple/80 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          <Upload size={10} />
          Uploaded
        </span>
      )}

      {/* Info */}
      <div className="p-4">
        <h3 className="mb-1 truncate text-sm font-semibold text-text-primary">
          {title}
        </h3>
        <p className="truncate text-xs text-text-muted">{author}</p>
      </div>

      {/* 3-dot menu */}
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-lg bg-black/40 p-1 text-white/70 transition-colors hover:bg-black/60 hover:text-white cursor-pointer"
        >
          <MoreVertical size={16} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl">
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
      </div>
    </GlassCard>
  );
}
