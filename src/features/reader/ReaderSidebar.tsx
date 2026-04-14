import { useMemo, useState } from "react";
import { FilePlus, FileText, StickyNote, PenTool, List, LayoutGrid } from "lucide-react";
import { ThumbnailToc } from "./ThumbnailToc";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { TocItem } from "@/types/document";

/** Flatten TOC into ordered list of page numbers for range-based active detection */
function flattenTocPages(items: TocItem[]): number[] {
  const pages: number[] = [];
  for (const item of items) {
    pages.push(item.pageIndex + 1);
    if (item.children.length > 0) {
      pages.push(...flattenTocPages(item.children));
    }
  }
  return pages;
}

function TocEntry({
  item,
  depth,
  currentPage,
  activePage,
  onNavigate,
}: {
  item: TocItem;
  depth: number;
  currentPage: number;
  activePage: number | null;
  onNavigate: (page: number) => void;
}) {
  const page = item.pageIndex + 1;
  const isActive = activePage === page;

  return (
    <>
      <button
        onClick={() => onNavigate(page)}
        className={cn(
          "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors cursor-pointer",
          isActive
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
          depth === 1 && "pl-6 text-xs",
          depth >= 2 && "pl-9 text-xs",
        )}
      >
        {item.title}
      </button>
      {item.children.map((child, i) => (
        <TocEntry
          key={i}
          item={child}
          depth={depth + 1}
          currentPage={currentPage}
          activePage={activePage}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

interface ReaderSidebarContentProps {
  onOpenFile?: () => void;
  onOpenNote?: (noteId: string) => void;
  onCreateNote?: () => void;
  onOpenWhiteboard?: (whiteboardId: string) => void;
  onCreateWhiteboard?: () => void;
}

/** Inner content component used by Dockview panel (no outer sizing wrapper) */
export function ReaderSidebarContent({
  onOpenFile,
  onOpenNote,
  onCreateNote,
  onOpenWhiteboard,
  onCreateWhiteboard,
}: ReaderSidebarContentProps) {
  const activeDoc = useActiveDocument();
  const documents = useReaderStore((s) => s.documents);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const setActiveDocument = useReaderStore((s) => s.setActiveDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);

  const notes = useNoteStore((s) => s.notes);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);

  const meta = activeDoc?.meta ?? null;
  const toc = activeDoc?.toc ?? [];
  const currentPage = activeDoc?.currentPage ?? 1;
  const totalPages = activeDoc?.totalPages ?? 0;

  // Range-based active TOC entry: find the TOC entry whose page is <= currentPage
  // and the next entry's page is > currentPage
  const activeTocPage = useMemo(() => {
    if (toc.length === 0) return null;
    const sortedPages = [...new Set(flattenTocPages(toc))].sort(
      (a, b) => a - b,
    );
    let active: number | null = null;
    for (const page of sortedPages) {
      if (page <= currentPage) {
        active = page;
      } else {
        break;
      }
    }
    return active;
  }, [toc, currentPage]);

  const [tocViewMode, setTocViewMode] = useState<"outline" | "thumbnail">("outline");
  const docEntries = Array.from(documents.entries());

  return (
    <div className="h-full flex flex-col bg-bg-secondary/50">
      {/* Header with view mode toggle and + button */}
      <div className="p-4 border-b border-glass-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
          {meta ? "Contents" : "Reader"}
        </h3>
        <div className="flex items-center gap-1">
          {meta && (
            <>
              <button
                onClick={() => setTocViewMode("outline")}
                className={cn(
                  "rounded-md p-1 transition-colors cursor-pointer",
                  tocViewMode === "outline"
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
                )}
                title="Outline view"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setTocViewMode("thumbnail")}
                className={cn(
                  "rounded-md p-1 transition-colors cursor-pointer",
                  tocViewMode === "thumbnail"
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
                )}
                title="Thumbnail view"
              >
                <LayoutGrid size={16} />
              </button>
            </>
          )}
          {onOpenFile && (
            <button
              onClick={onOpenFile}
              className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              title="Open another PDF"
            >
              <FilePlus size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Open documents list */}
      {docEntries.length > 1 && (
        <div className="border-b border-glass-border p-2 space-y-0.5">
          <p className="px-3 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Open Documents
          </p>
          {docEntries.map(([id, _doc]) => (
            <button
              key={id}
              onClick={() => setActiveDocument(id)}
              className={cn(
                "flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors cursor-pointer",
                activeDocumentId === id
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate">
                {getDisplayTitle(id)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* TOC for active document */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {!meta && (
          <p className="px-3 py-2 text-sm text-text-muted">
            Open a document to see its contents.
          </p>
        )}

        {meta && tocViewMode === "thumbnail" && <ThumbnailToc />}

        {meta &&
          tocViewMode === "outline" &&
          toc.length > 0 &&
          toc.map((item, i) => (
            <TocEntry
              key={i}
              item={item}
              depth={0}
              currentPage={currentPage}
              activePage={activeTocPage}
              onNavigate={goToPage}
            />
          ))}

        {meta &&
          tocViewMode === "outline" &&
          toc.length === 0 &&
          Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => goToPage(i + 1)}
              className={cn(
                "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors cursor-pointer",
                currentPage === i + 1
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              Page {i + 1}
            </button>
          ))}
      </nav>

      {/* Notes section */}
      <div className="border-t border-glass-border p-2">
        <div className="flex items-center justify-between px-3 py-1">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Notes
          </p>
          {onCreateNote && (
            <button
              onClick={onCreateNote}
              className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              title="New note"
            >
              <StickyNote size={14} />
            </button>
          )}
        </div>
        {notes.length === 0 ? (
          <p className="px-3 py-1 text-xs text-text-muted">No notes yet</p>
        ) : (
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => onOpenNote?.(note.id)}
                className="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              >
                <StickyNote size={14} className="shrink-0" />
                <span className="truncate">{note.title || "Untitled Note"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Whiteboards section */}
      <div className="border-t border-glass-border p-2">
        <div className="flex items-center justify-between px-3 py-1">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Whiteboards
          </p>
          {onCreateWhiteboard && (
            <button
              onClick={onCreateWhiteboard}
              className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              title="New whiteboard"
            >
              <PenTool size={14} />
            </button>
          )}
        </div>
        {whiteboards.length === 0 ? (
          <p className="px-3 py-1 text-xs text-text-muted">No whiteboards yet</p>
        ) : (
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {whiteboards.map((wb) => (
              <button
                key={wb.id}
                onClick={() => onOpenWhiteboard?.(wb.id)}
                className="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              >
                <PenTool size={14} className="shrink-0" />
                <span className="truncate">{wb.title || "Untitled Whiteboard"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Full sidebar component with sizing wrapper (for non-dockview use) */
export function ReaderSidebar() {
  return (
    <div className="h-full w-64 shrink-0 border-r border-glass-border">
      <ReaderSidebarContent />
    </div>
  );
}
