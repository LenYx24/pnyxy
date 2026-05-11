import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FilePlus, FileText, Library, StickyNote, PenTool, List, LayoutGrid, Trash2, Bookmark } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { ThumbnailToc } from "./ThumbnailToc";
import { BookmarksPanel } from "./BookmarksPanel";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useNoteStore } from "@/stores/note-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useConfirm } from "@/hooks/use-confirm";
import type { TocItem } from "@/types/document";

const EMPTY_TOC: TocItem[] = [];

type SidebarTab = "contents" | "bookmarks" | "notes" | "whiteboards";

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

type TocReadState = "read" | "in-progress" | "unread";

/**
 * Map each TOC entry → read state, given the watermark `progressPage`
 * (furthest page the user has reached, tracker-maintained).
 *
 * A chapter's "end page" is the page of the next item in flattened
 * depth-first order minus 1; the last item ends at `totalPages`.
 * From there:
 *   read         — end page ≤ watermark   (chapter fully behind)
 *   in-progress  — chapter contains the watermark
 *   unread       — chapter starts past the watermark
 */
function buildTocReadState(
  items: TocItem[],
  progressPage: number,
  totalPages: number,
): Map<TocItem, TocReadState> {
  const flat: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    for (const it of list) {
      flat.push(it);
      walk(it.children);
    }
  };
  walk(items);

  const result = new Map<TocItem, TocReadState>();
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    const startPage = item.pageIndex + 1;
    const next = flat[i + 1];
    const endPage = next ? next.pageIndex : totalPages - 1; // 0-indexed inclusive
    // Convert to 1-indexed inclusive for comparison with progressPage.
    const endPage1 = endPage + 1;

    if (progressPage <= 0 || startPage > progressPage) {
      result.set(item, "unread");
    } else if (endPage1 <= progressPage) {
      result.set(item, "read");
    } else {
      result.set(item, "in-progress");
    }
  }
  return result;
}

/** Tiny visual cue beside each TOC entry. Filled circle for read,
 *  hollow ring for in-progress, empty placeholder (preserves
 *  alignment) for unread. Color matches the global active-accent
 *  so the indicator reads as the same family as the active-row
 *  highlight without competing with it. */
function TocReadDot({ state }: { state: TocReadState }) {
  if (state === "read") {
    return (
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-purple"
      />
    );
  }
  if (state === "in-progress") {
    return (
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full border border-accent-purple"
      />
    );
  }
  // Unread: take the same 1.5 × 1.5 footprint so the title text
  // doesn't shift when a chapter transitions states.
  return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0" />;
}

function TocEntry({
  item,
  depth,
  currentPage,
  activePage,
  readState,
  onNavigate,
}: {
  item: TocItem;
  depth: number;
  currentPage: number;
  activePage: number | null;
  /** Map from TOC item → reading watermark state, computed at the
   *  top of the TOC render so every TocEntry can look itself up. */
  readState: Map<TocItem, TocReadState>;
  onNavigate: (page: number) => void;
}) {
  const page = item.pageIndex + 1;
  const isActive = activePage === page;
  const state = readState.get(item) ?? "unread";
  const hasChildren = item.children.length > 0;
  // Default-expand the top level so the user sees the table of
  // contents at a glance; deeper levels collapse by default to keep
  // long TOCs scannable. Toggling overrides this for that node.
  const [expanded, setExpanded] = useState(depth === 0);
  // Indent grows with depth — keep arithmetic in one spot so the
  // chevron and the row text stay aligned.
  const indentPx = depth * 12;

  return (
    <>
      <div
        className={cn(
          "flex w-full items-center gap-0.5 rounded-md transition-colors",
          isActive
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )}
        style={{ paddingLeft: indentPx }}
      >
        {/* Chevron toggle — only rendered when there are children
            so leaf rows stay flush with the row text instead of
            getting an empty-icon gap. */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
          >
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform duration-150",
                !expanded && "-rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          onClick={() => onNavigate(page)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-3 text-left transition-colors cursor-pointer",
            depth === 0 ? "text-sm" : "text-xs",
            // Subtle fade for chapters fully behind the watermark —
            // keeps them readable but visually "done" so the eye is
            // drawn to the in-progress / unread entries ahead.
            state === "read" && !isActive && "opacity-60",
          )}
          title={item.title}
        >
          <TocReadDot state={state} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </button>
      </div>
      {hasChildren && expanded && (
        <>
          {item.children.map((child, i) => (
            <TocEntry
              key={i}
              item={child}
              depth={depth + 1}
              currentPage={currentPage}
              activePage={activePage}
              readState={readState}
              onNavigate={onNavigate}
            />
          ))}
        </>
      )}
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
  const { t } = useTranslation();
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
  const progressPage = activeDoc?.progressPage ?? 0;

  // Re-compute only when the TOC shape OR the watermark changes —
  // both are cheap enough to redo even on every page change, but a
  // big TOC + a steadily-incrementing watermark gets called a lot.
  const tocReadState = useMemo(
    () => buildTocReadState(toc, progressPage, totalPages),
    [toc, progressPage, totalPages],
  );

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

  // Register the cross-component opener so the AI chat panel can
  // surface a "Customize context" button without coupling to the
  // sidebar's internal tab/view state. The opener flips this
  // sidebar to the thumbnail TOC and enables page-selection mode;
  // ThumbnailToc itself auto-fills the surrounding-pages default
  // when selection mode is entered with nothing selected.
  useEffect(() => {
    const open = () => {
      useUIStore.getState().setReaderSidebarCollapsed(false);
      useUIStore.getState().setMobileReaderPanel("toc");
      setSidebarTab("contents");
      setTocViewMode("thumbnail");
      useUIStore.getState().setAiContextSelectionMode(true);
    };
    useUIStore.getState().setOpenAiContextEditor(open);
    return () => {
      useUIStore.getState().setOpenAiContextEditor(null);
    };
  }, []);

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

  const { confirm, ConfirmModalElement } = useConfirm();

  const handleDeleteSelectedNotes = useCallback(async () => {
    const count = selectedNoteIds.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t("reader.sidebar.bulkDeleteNotesTitle", { count }),
      body: t("reader.sidebar.bulkDeleteBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    for (const id of selectedNoteIds) {
      useNoteStore.getState().deleteNote(id);
      onDeleteNote?.(id);
    }
    setSelectedNoteIds(new Set());
    lastClickedNoteIndexRef.current = null;
  }, [selectedNoteIds, onDeleteNote, confirm, t]);

  const handleDeleteSelectedWhiteboards = useCallback(async () => {
    const count = selectedWhiteboardIds.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t("reader.sidebar.bulkDeleteWhiteboardsTitle", { count }),
      body: t("reader.sidebar.bulkDeleteBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    for (const id of selectedWhiteboardIds) {
      useWhiteboardStore.getState().deleteWhiteboard(id);
      onDeleteWhiteboard?.(id);
    }
    setSelectedWhiteboardIds(new Set());
    lastClickedWhiteboardIndexRef.current = null;
  }, [selectedWhiteboardIds, onDeleteWhiteboard, confirm, t]);

  const docEntries = Array.from(documents.entries());

  const tabItems: { key: SidebarTab; icon: typeof List; label: string }[] = [
    { key: "contents", icon: tocViewMode === "thumbnail" ? LayoutGrid : List, label: t("reader.sidebar.tabContents") },
    { key: "bookmarks", icon: Bookmark, label: t("reader.sidebar.tabBookmarks") },
    { key: "notes", icon: StickyNote, label: t("reader.sidebar.tabNotes") },
    { key: "whiteboards", icon: PenTool, label: t("reader.sidebar.tabWhiteboards") },
  ];

  return (
    <div className="h-full flex flex-col bg-bg-secondary/50">
      {/* Header. Extra left padding on the heading clears the toolbar's
          sidebar-toggle hamburger that sits directly above this row when
          the global app sidebar is collapsed — without it the two
          stacked vertically and looked glued together. */}
      <div className="p-4 border-b border-glass-border flex items-center justify-between">
        <h3 className="pl-10 text-sm font-semibold text-text-muted uppercase tracking-wider">
          {t("reader.sidebar.readerHeading")}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => useUIStore.getState().setLibraryPickerOpen(true)}
            className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            title={t("reader.sidebar.openFromLibrary")}
            aria-label={t("reader.sidebar.openFromLibrary")}
          >
            <Library size={16} />
          </button>
          {onOpenFile && (
            <button
              onClick={onOpenFile}
              className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              title={t("reader.sidebar.openAnotherPdf")}
              aria-label={t("reader.sidebar.openAnotherPdf")}
            >
              <FilePlus size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Open documents list — always rendered (even with 1 doc)
          so the user discovers they can keep multiple books loaded
          and switch between them. The "Open another" button at the
          bottom lets them add a sibling book without leaving the
          reader. */}
      {docEntries.length > 0 && (
        <div className="border-b border-glass-border p-2 space-y-0.5">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {t("reader.sidebar.openDocuments")}
          </p>
          {docEntries.map(([id, _doc]) => (
            <button
              key={id}
              onClick={() => setActiveDocument(id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors cursor-pointer",
                activeDocumentId === id
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate">{getDisplayTitle(id)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tab bar — icon-only with tooltip on hover */}
      <div className="border-b border-glass-border px-2 py-1.5 flex items-center gap-1 overflow-x-auto">
        {tabItems.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setSidebarTab(key)}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md p-2 transition-colors cursor-pointer",
              sidebarTab === key
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
            title={label}
            aria-label={label}
          >
            <Icon size={16} />
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
                "flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors cursor-pointer",
                tocViewMode === "outline"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("reader.sidebar.outlineTitle")}
              aria-label={t("reader.sidebar.outline")}
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setTocViewMode("thumbnail")}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors cursor-pointer",
                tocViewMode === "thumbnail"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("reader.sidebar.thumbnailsTitle")}
              aria-label={t("reader.sidebar.thumbnails")}
            >
              <LayoutGrid size={14} />
            </button>
          </>
        )}
        {sidebarTab === "contents" && !meta && (
          <span className="px-1 py-0.5 text-xs text-text-muted/60">
            {t("reader.sidebar.noDocumentOpen")}
          </span>
        )}
        {sidebarTab === "notes" && onCreateNote && (
          <button
            onClick={onCreateNote}
            className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            title={t("reader.sidebar.newNote")}
            aria-label={t("reader.sidebar.newNote")}
          >
            <StickyNote size={14} />
          </button>
        )}
        {sidebarTab === "whiteboards" && onCreateWhiteboard && (
          <button
            onClick={onCreateWhiteboard}
            disabled={!whiteboardCreationAllowed}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors",
              whiteboardCreationAllowed
                ? "text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                : "text-text-muted/40 cursor-not-allowed",
            )}
            title={
              whiteboardCreationAllowed
                ? t("reader.sidebar.newWhiteboard")
                : t("reader.sidebar.whiteboardsGated")
            }
            aria-label={t("reader.sidebar.newWhiteboard")}
          >
            <PenTool size={14} />
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
                {t("reader.sidebar.openToSeeContents")}
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
                  readState={tocReadState}
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
                  {t("reader.sidebar.page", { n: i + 1 })}
                </button>
              ))}
          </>
        )}

        {/* Bookmarks tab */}
        {sidebarTab === "bookmarks" && (
          <div className="px-3 py-2">
            <BookmarksPanel />
          </div>
        )}

        {/* Notes tab */}
        {sidebarTab === "notes" && (
          <>
            {notes.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-muted">
                {t("reader.sidebar.noNotes")}
              </p>
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
                  <span className="min-w-0 truncate flex-1">
                    {note.title || t("reader.sidebar.untitledNote")}
                  </span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title={t("reader.sidebar.deleteNote")}
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
              <p className="px-3 py-2 text-sm text-text-muted">
                {t("reader.sidebar.noWhiteboards")}
              </p>
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
                  <span className="min-w-0 truncate flex-1">
                    {wb.title || t("reader.sidebar.untitledWhiteboard")}
                  </span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title={t("reader.sidebar.deleteWhiteboard")}
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
            {t("reader.sidebar.countSelected", { count: selectedNoteIds.size })}
          </span>
          <button
            onClick={handleDeleteSelectedNotes}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            {t("reader.sidebar.delete")}
          </button>
        </div>
      )}
      {sidebarTab === "whiteboards" && whiteboardSelectionActive && (
        <div className="border-t border-glass-border p-2 flex items-center justify-between">
          <span className="text-xs text-text-muted px-2">
            {t("reader.sidebar.countSelected", { count: selectedWhiteboardIds.size })}
          </span>
          <button
            onClick={handleDeleteSelectedWhiteboards}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            {t("reader.sidebar.delete")}
          </button>
        </div>
      )}
      {ConfirmModalElement}
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
