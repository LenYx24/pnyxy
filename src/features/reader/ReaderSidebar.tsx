import { useCallback, useMemo, useRef, useState } from "react";
import { FilePlus, FileText, StickyNote, PenTool, List, LayoutGrid, Trash2 } from "lucide-react";
import { ThumbnailToc } from "./ThumbnailToc";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useNoteStore } from "@/stores/note-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { TocItem } from "@/types/document";

const EMPTY_TOC: TocItem[] = [];

type SidebarTab = "contents" | "notes" | "whiteboards";

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
  onDeleteNote?: (noteId: string) => void;
  onDeleteWhiteboard?: (whiteboardId: string) => void;
}

/** Inner content component used by Dockview panel (no outer sizing wrapper) */
export function ReaderSidebarContent({
  onOpenFile,
  onOpenNote,
  onCreateNote,
  onOpenWhiteboard,
  onCreateWhiteboard,
  onDeleteNote,
  onDeleteWhiteboard,
}: ReaderSidebarContentProps) {
  const activeDoc = useActiveDocument();
  const documents = useReaderStore((s) => s.documents);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const setActiveDocument = useReaderStore((s) => s.setActiveDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);

  const notes = useNoteStore((s) => s.notes);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const allowWhiteboardForAll = useSettingsStore(
    (s) => s.experimental_allowWhiteboardForAllFormats,
  );
  // Whiteboards are a paginated-format concept (they anchor to PDF pages).
  // Disable the "new whiteboard" button when the active doc can't host one,
  // unless the developer toggle is flipped.
  const whiteboardCreationAllowed =
    !activeDoc ||
    activeDoc.meta.capabilities.paginated ||
    allowWhiteboardForAll;

  const meta = activeDoc?.meta ?? null;
  const toc = activeDoc?.toc ?? EMPTY_TOC;
  const currentPage = activeDoc?.currentPage ?? 1;
  const totalPages = activeDoc?.totalPages ?? 0;

  // Range-based active TOC entry
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
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("contents");

  // Selection state for notes and whiteboards
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [selectedWhiteboardIds, setSelectedWhiteboardIds] = useState<Set<string>>(new Set());
  const lastClickedNoteIndexRef = useRef<number | null>(null);
  const lastClickedWhiteboardIndexRef = useRef<number | null>(null);

  const noteSelectionActive = selectedNoteIds.size > 0;
  const whiteboardSelectionActive = selectedWhiteboardIds.size > 0;

  const handleNoteClick = useCallback((noteId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedNoteIndexRef.current !== null) {
      // Range selection
      const start = Math.min(lastClickedNoteIndexRef.current, index);
      const end = Math.max(lastClickedNoteIndexRef.current, index);
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        const currentNotes = useNoteStore.getState().notes;
        for (let i = start; i <= end; i++) {
          if (currentNotes[i]) next.add(currentNotes[i].id);
        }
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle single
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(noteId)) next.delete(noteId);
        else next.add(noteId);
        return next;
      });
    } else if (noteSelectionActive) {
      // Click during active selection toggles
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(noteId)) next.delete(noteId);
        else next.add(noteId);
        return next;
      });
    } else {
      // Normal click — open note
      onOpenNote?.(noteId);
      lastClickedNoteIndexRef.current = index;
      return;
    }
    lastClickedNoteIndexRef.current = index;
  }, [noteSelectionActive, onOpenNote]);

  const handleWhiteboardClick = useCallback((wbId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedWhiteboardIndexRef.current !== null) {
      const start = Math.min(lastClickedWhiteboardIndexRef.current, index);
      const end = Math.max(lastClickedWhiteboardIndexRef.current, index);
      setSelectedWhiteboardIds((prev) => {
        const next = new Set(prev);
        const currentWbs = useWhiteboardStore.getState().whiteboards;
        for (let i = start; i <= end; i++) {
          if (currentWbs[i]) next.add(currentWbs[i].id);
        }
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedWhiteboardIds((prev) => {
        const next = new Set(prev);
        if (next.has(wbId)) next.delete(wbId);
        else next.add(wbId);
        return next;
      });
    } else if (whiteboardSelectionActive) {
      setSelectedWhiteboardIds((prev) => {
        const next = new Set(prev);
        if (next.has(wbId)) next.delete(wbId);
        else next.add(wbId);
        return next;
      });
    } else {
      onOpenWhiteboard?.(wbId);
      lastClickedWhiteboardIndexRef.current = index;
      return;
    }
    lastClickedWhiteboardIndexRef.current = index;
  }, [whiteboardSelectionActive, onOpenWhiteboard]);

  const handleToggleNoteCheckbox = useCallback((noteId: string, index: number) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
    lastClickedNoteIndexRef.current = index;
  }, []);

  const handleToggleWhiteboardCheckbox = useCallback((wbId: string, index: number) => {
    setSelectedWhiteboardIds((prev) => {
      const next = new Set(prev);
      if (next.has(wbId)) next.delete(wbId);
      else next.add(wbId);
      return next;
    });
    lastClickedWhiteboardIndexRef.current = index;
  }, []);

  const handleDeleteSelectedNotes = useCallback(() => {
    for (const id of selectedNoteIds) {
      useNoteStore.getState().deleteNote(id);
      onDeleteNote?.(id);
    }
    setSelectedNoteIds(new Set());
    lastClickedNoteIndexRef.current = null;
  }, [selectedNoteIds, onDeleteNote]);

  const handleDeleteSelectedWhiteboards = useCallback(() => {
    for (const id of selectedWhiteboardIds) {
      useWhiteboardStore.getState().deleteWhiteboard(id);
      onDeleteWhiteboard?.(id);
    }
    setSelectedWhiteboardIds(new Set());
    lastClickedWhiteboardIndexRef.current = null;
  }, [selectedWhiteboardIds, onDeleteWhiteboard]);

  const docEntries = Array.from(documents.entries());

  const tabItems: { key: SidebarTab; icon: typeof List; label: string }[] = [
    { key: "contents", icon: tocViewMode === "thumbnail" ? LayoutGrid : List, label: "Contents" },
    { key: "notes", icon: StickyNote, label: "Notes" },
    { key: "whiteboards", icon: PenTool, label: "Whiteboards" },
  ];

  return (
    <div className="h-full flex flex-col bg-bg-secondary/50">
      {/* Header */}
      <div className="p-4 border-b border-glass-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
          {meta ? "Reader" : "Reader"}
        </h3>
        <div className="flex items-center gap-1">
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

      {/* Tab bar */}
      <div className="border-b border-glass-border px-2 py-1.5 flex items-center gap-1 overflow-x-auto">
        {tabItems.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setSidebarTab(key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              sidebarTab === key
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
            title={label}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Contextual actions for the active tab — on their own row so
          they're always accessible regardless of panel width. */}
      <div className="border-b border-glass-border px-2 py-1 flex items-center gap-1 overflow-x-auto">
        {sidebarTab === "contents" && meta && (
          <>
            <button
              onClick={() => setTocViewMode("outline")}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer",
                tocViewMode === "outline"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title="Outline view"
            >
              <List size={14} />
              <span>Outline</span>
            </button>
            <button
              onClick={() => setTocViewMode("thumbnail")}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer",
                tocViewMode === "thumbnail"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title="Thumbnail view"
            >
              <LayoutGrid size={14} />
              <span>Thumbnails</span>
            </button>
          </>
        )}
        {sidebarTab === "contents" && !meta && (
          <span className="px-1 py-0.5 text-xs text-text-muted/60">
            No document open
          </span>
        )}
        {sidebarTab === "notes" && onCreateNote && (
          <button
            onClick={onCreateNote}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            title="New note"
          >
            <StickyNote size={14} />
            <span>New note</span>
          </button>
        )}
        {sidebarTab === "whiteboards" && onCreateWhiteboard && (
          <button
            onClick={onCreateWhiteboard}
            disabled={!whiteboardCreationAllowed}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
              whiteboardCreationAllowed
                ? "text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                : "text-text-muted/40 cursor-not-allowed",
            )}
            title={
              whiteboardCreationAllowed
                ? "New whiteboard"
                : "Whiteboards are only available for paginated formats"
            }
          >
            <PenTool size={14} />
            <span>New whiteboard</span>
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {/* Contents tab */}
        {sidebarTab === "contents" && (
          <>
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
          </>
        )}

        {/* Notes tab */}
        {sidebarTab === "notes" && (
          <>
            {notes.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-muted">No notes yet</p>
            ) : (
              notes.map((note, index) => (
                <div
                  key={note.id}
                  onClick={(e) => handleNoteClick(note.id, index, e)}
                  className="group flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
                >
                  {/* Checkbox */}
                  <div
                    className={cn(
                      "shrink-0 transition-opacity",
                      noteSelectionActive || selectedNoteIds.has(note.id)
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleNoteCheckbox(note.id, index);
                    }}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded border transition-colors",
                        selectedNoteIds.has(note.id)
                          ? "border-accent-purple bg-accent-purple"
                          : "border-text-muted/40 hover:border-text-primary",
                      )}
                    >
                      {selectedNoteIds.has(note.id) && (
                        <svg viewBox="0 0 16 16" className="h-4 w-4 text-white">
                          <path
                            d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2.5-2.5a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                  <StickyNote size={14} className="shrink-0" />
                  <span className="min-w-0 truncate flex-1">{note.title || "Untitled Note"}</span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title="Delete note"
                    onClick={(e) => {
                      e.stopPropagation();
                      useNoteStore.getState().deleteNote(note.id);
                      onDeleteNote?.(note.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </>
        )}

        {/* Whiteboards tab */}
        {sidebarTab === "whiteboards" && (
          <>
            {whiteboards.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-muted">No whiteboards yet</p>
            ) : (
              whiteboards.map((wb, index) => (
                <div
                  key={wb.id}
                  onClick={(e) => handleWhiteboardClick(wb.id, index, e)}
                  className="group flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
                >
                  {/* Checkbox */}
                  <div
                    className={cn(
                      "shrink-0 transition-opacity",
                      whiteboardSelectionActive || selectedWhiteboardIds.has(wb.id)
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleWhiteboardCheckbox(wb.id, index);
                    }}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded border transition-colors",
                        selectedWhiteboardIds.has(wb.id)
                          ? "border-accent-purple bg-accent-purple"
                          : "border-text-muted/40 hover:border-text-primary",
                      )}
                    >
                      {selectedWhiteboardIds.has(wb.id) && (
                        <svg viewBox="0 0 16 16" className="h-4 w-4 text-white">
                          <path
                            d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2.5-2.5a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                  <PenTool size={14} className="shrink-0" />
                  <span className="min-w-0 truncate flex-1">{wb.title || "Untitled Whiteboard"}</span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title="Delete whiteboard"
                    onClick={(e) => {
                      e.stopPropagation();
                      useWhiteboardStore.getState().deleteWhiteboard(wb.id);
                      onDeleteWhiteboard?.(wb.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Selection action bar */}
      {sidebarTab === "notes" && noteSelectionActive && (
        <div className="border-t border-glass-border p-2 flex items-center justify-between">
          <span className="text-xs text-text-muted px-2">
            {selectedNoteIds.size} selected
          </span>
          <button
            onClick={handleDeleteSelectedNotes}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
      {sidebarTab === "whiteboards" && whiteboardSelectionActive && (
        <div className="border-t border-glass-border p-2 flex items-center justify-between">
          <span className="text-xs text-text-muted px-2">
            {selectedWhiteboardIds.size} selected
          </span>
          <button
            onClick={handleDeleteSelectedWhiteboards}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
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
