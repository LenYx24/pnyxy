import {
  BookOpen,
  FileText,
  Link as LinkIcon,
  ListChecks,
  MessageSquare,
  Shapes,
  Video,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type RowTileKind =
  | "book"
  | "folder"
  | "resource"
  | "youtube"
  | "chat"
  | "note"
  | "quiz"
  | "whiteboard";

interface RowTileProps {
  kind: RowTileKind;
  /** Book cover; when present it fills the whole tile. */
  coverUrl?: string | null;
  className?: string;
}

/**
 * The fixed 32x44 slot at the start of every list row. Books show their
 * cover (or a neutral tile with a book glyph), folders a filled folder
 * shape, every other entity a tinted tile with its type glyph, so the
 * name column lines up across types.
 */
export function RowTile({ kind, coverUrl, className }: RowTileProps) {
  if (kind === "folder") {
    return (
      <svg
        width="32"
        height="44"
        viewBox="0 0 32 44"
        fill="none"
        aria-hidden="true"
        className={cn("shrink-0", className)}
      >
        <path
          d="M0 9a3 3 0 0 1 3-3h9l3 3h14a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3z"
          fill="#0e7490"
        />
        <rect x="0" y="15" width="32" height="24" rx="3" fill="#0891b2" />
      </svg>
    );
  }

  if (kind === "book" && coverUrl) {
    return (
      <img
        src={coverUrl}
        alt=""
        aria-hidden="true"
        // Native image drag hijacks the pointer stream and breaks
        // dnd-kit dragging (see LibraryBookCard).
        draggable={false}
        loading="lazy"
        className={cn(
          "h-11 w-8 shrink-0 rounded-[3px] object-cover shadow-sm shadow-black/20",
          className,
        )}
      />
    );
  }

  const { Icon, tint } = TILE_GLYPHS[kind];
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-11 w-8 shrink-0 items-center justify-center rounded-[3px] shadow-sm shadow-black/20",
        tint,
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} />
    </div>
  );
}

const TILE_GLYPHS: Record<
  Exclude<RowTileKind, "folder">,
  { Icon: typeof BookOpen; tint: string }
> = {
  book: { Icon: BookOpen, tint: "bg-bg-tertiary text-text-muted" },
  resource: { Icon: LinkIcon, tint: "bg-accent-blue/80 text-white" },
  youtube: { Icon: Video, tint: "bg-danger/80 text-white" },
  chat: { Icon: MessageSquare, tint: "bg-accent/80 text-white" },
  note: { Icon: FileText, tint: "bg-accent-blue/70 text-white" },
  quiz: { Icon: ListChecks, tint: "bg-warning/80 text-white" },
  whiteboard: { Icon: Shapes, tint: "bg-success/70 text-white" },
};
