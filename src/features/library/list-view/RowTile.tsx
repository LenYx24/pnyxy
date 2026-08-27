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
  /** Kept in the prop contract for callers; covers only show in the
   *  expanded detail panel now (Nextcloud-flat rows). */
  coverUrl?: string | null;
  className?: string;
}

/**
 * Small inline type glyph at the start of a list row (Nextcloud-style
 * flat rows). Books render nothing: their name IS the identity and the
 * cover lives in the expanded detail. Folders keep the filled folder
 * shape, other entities a tinted glyph.
 */
export function RowTile({ kind, className }: RowTileProps) {
  if (kind === "book") return null;

  if (kind === "folder") {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className={cn("shrink-0", className)}
      >
        <path
          d="M0 7a3 3 0 0 1 3-3h9l3 3h14a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3z"
          fill="#0e7490"
        />
        <rect x="0" y="11" width="32" height="18" rx="3" fill="#0891b2" />
      </svg>
    );
  }

  const { Icon, tint } = TILE_GLYPHS[kind];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0", tint, className)}
    >
      <Icon size={18} strokeWidth={1.5} />
    </span>
  );
}

const TILE_GLYPHS: Record<
  Exclude<RowTileKind, "folder" | "book">,
  { Icon: typeof BookOpen; tint: string }
> = {
  resource: { Icon: LinkIcon, tint: "text-accent-blue" },
  youtube: { Icon: Video, tint: "text-danger" },
  chat: { Icon: MessageSquare, tint: "text-accent" },
  note: { Icon: FileText, tint: "text-accent-blue" },
  quiz: { Icon: ListChecks, tint: "text-warning" },
  whiteboard: { Icon: Shapes, tint: "text-success" },
};
