import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FilePlus, FileText, Library, StickyNote, PenTool, List, LayoutGrid, Trash2, Bookmark } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { ThumbnailToc } from "./panels/ThumbnailToc";
import { BookmarksPanel } from "./panels/BookmarksPanel";
import { cn } from "@/lib/cn";
import {
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui/classes";
import { useFeatures } from "@/lib/use-features";
import { noteDisplayTitle, whiteboardDisplayTitle } from "@/lib/entity-title";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useNoteStore } from "@/stores/note-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useConfirm } from "@/hooks/use-confirm";
import type { TocItem } from "@/types/document";

const EMPTY_TOC: TocItem[] = [];

type SidebarTab = "contents" | "bookmarks" | "notes" | "whiteboards";

/** Flatten TOC into ordered list of page numbers. */
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
 * Read state per TOC entry. progressPage is the furthest page reached.
 * A chapter ends where the next flattened DFS item starts (minus 1); the
 * last chapter ends at totalPages.
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
    const endPage1 = endPage + 1; // 1-indexed to compare against progressPage

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

/** TOC read cue: filled dot = read, ring = in-progress, empty = unread. */
function TocReadDot({ state }: { state: TocReadState }) {
  if (state === "read") {
    return (
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted-2"
      />
    );
  }
  if (state === "in-progress") {
    return (
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full border border-text-muted-2"
      />
    );
  }
  // same footprint as the other states so titles don't shift
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
  readState: Map<TocItem, TocReadState>;
  onNavigate: (page: number) => void;
}) {
  const page = item.pageIndex + 1;
  const isActive = activePage === page;
  const state = readState.get(item) ?? "unread";
  const hasChildren = item.children.length > 0;
  // top level expanded by default, deeper levels collapsed
  const [expanded, setExpanded] = useState(depth === 0);
  const indentPx = depth * 12;

  return (
    <>
      <div
        className={cn(
          "flex w-full items-center gap-0.5 rounded-[8px] transition-colors",
          isActive
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-muted hover:bg-bg-secondary hover:text-text-primary",
        )}
        style={{ paddingLeft: indentPx }}
      >
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
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] py-1.5 pr-2.5 text-left text-[12.5px] transition-colors cursor-pointer",
            // fade already-read chapters
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

/** Sidebar body without the sizing wrapper (used by the Dockview panel). */
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
  // whiteboards tied to this doc, plus null-bookId ones so they aren't hidden
  const visibleWhiteboards = useMemo(
    () =>
      whiteboards.filter(
        (wb) =>
          !activeDocumentId || !wb.bookId || wb.bookId === activeDocumentId,
      ),
    [whiteboards, activeDocumentId],
  );
  // shift-click range-select reads the visible list through this ref
  const visibleWhiteboardsRef = useRef(visibleWhiteboards);
  useEffect(() => {
    visibleWhiteboardsRef.current = visibleWhiteboards;
  }, [visibleWhiteboards]);
  const allowWhiteboardForAll = useSettingsStore(
    (s) => s.experimental_allowWhiteboardForAllFormats,
  );
  // whiteboards anchor to PDF pages, so only allow them on paginated docs
  const whiteboardCreationAllowed =
    !activeDoc ||
    activeDoc.meta.capabilities.paginated ||
    allowWhiteboardForAll;

  const meta = activeDoc?.meta ?? null;
  const toc = activeDoc?.toc ?? EMPTY_TOC;
  const currentPage = activeDoc?.currentPage ?? 1;
  const totalPages = activeDoc?.totalPages ?? 0;
  const progressPage = activeDoc?.progressPage ?? 0;

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

  // expose an opener so the AI chat panel can jump into thumbnail page-selection
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
      // Normal click, open note
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
        // filtered list so indices match the rendered rows
        const currentWbs = visibleWhiteboardsRef.current;
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

  // Notes + Whiteboards moved to the right-hand tools panel; the left
  // sidebar keeps document structure (contents) and bookmarks.
  const features = useFeatures();
  const tabItems: { key: SidebarTab; icon: typeof List; label: string }[] = [
    { key: "contents", icon: tocViewMode === "thumbnail" ? LayoutGrid : List, label: t("reader.sidebar.tabContents") },
    ...(features.bookmarks
      ? [{ key: "bookmarks" as const, icon: Bookmark, label: t("reader.sidebar.tabBookmarks") }]
      : []),
    ...(features.notes && onOpenNote
      ? [{ key: "notes" as const, icon: StickyNote, label: t("reader.sidebar.tabNotes") }]
      : []),
    ...(features.whiteboard && onOpenWhiteboard
      ? [{ key: "whiteboards" as const, icon: PenTool, label: t("reader.sidebar.tabWhiteboards") }]
      : []),
  ];
  // the segmented control only appears when a flagged tab joins Contents
  const showTabs = tabItems.length > 1;
  const quietBtn =
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer";

  return (
    <div className="flex h-full flex-col">
      {/* Caption row: "Contents" + quiet actions (view toggle, open) */}
      <div className="flex items-center gap-0.5 px-3 pb-1 pt-3.5">
        <h3 className="min-w-0 flex-1 truncate pl-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
          {sidebarTab === "contents"
            ? t("reader.sidebar.tabContents")
            : tabItems.find((it) => it.key === sidebarTab)?.label}
        </h3>
        {sidebarTab === "contents" && meta && (
          <button
            onClick={() =>
              setTocViewMode(tocViewMode === "outline" ? "thumbnail" : "outline")
            }
            className={quietBtn}
            title={
              tocViewMode === "outline"
                ? t("reader.sidebar.thumbnailsTitle")
                : t("reader.sidebar.outlineTitle")
            }
            aria-label={
              tocViewMode === "outline"
                ? t("reader.sidebar.thumbnails")
                : t("reader.sidebar.outline")
            }
            aria-pressed={tocViewMode === "thumbnail"}
          >
            {tocViewMode === "outline" ? (
              <LayoutGrid size={16} strokeWidth={1.5} />
            ) : (
              <List size={16} strokeWidth={1.5} />
            )}
          </button>
        )}
        {sidebarTab === "notes" && onCreateNote && (
          <button
            onClick={onCreateNote}
            className={quietBtn}
            title={t("reader.sidebar.newNote")}
            aria-label={t("reader.sidebar.newNote")}
          >
            <StickyNote size={16} strokeWidth={1.5} />
          </button>
        )}
        {sidebarTab === "whiteboards" && onCreateWhiteboard && (
          <button
            onClick={onCreateWhiteboard}
            disabled={!whiteboardCreationAllowed}
            className={cn(quietBtn, !whiteboardCreationAllowed && "opacity-40 cursor-not-allowed")}
            title={
              whiteboardCreationAllowed
                ? t("reader.sidebar.newWhiteboard")
                : t("reader.sidebar.whiteboardsGated")
            }
            aria-label={t("reader.sidebar.newWhiteboard")}
          >
            <PenTool size={16} strokeWidth={1.5} />
          </button>
        )}
        <button
          onClick={() => useUIStore.getState().setLibraryPickerOpen(true)}
          className={quietBtn}
          title={t("reader.sidebar.openFromLibrary")}
          aria-label={t("reader.sidebar.openFromLibrary")}
        >
          <Library size={16} strokeWidth={1.5} />
        </button>
        {onOpenFile && (
          <button
            onClick={onOpenFile}
            className={quietBtn}
            title={t("reader.sidebar.openAnotherPdf")}
            aria-label={t("reader.sidebar.openAnotherPdf")}
          >
            <FilePlus size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Flagged tabs (bookmarks / notes / whiteboards) as a segmented control */}
      {showTabs && (
        <div className="px-4 pb-2 pt-1">
          <div className={cn(segmentedGroupClass, "w-full")}>
            {tabItems.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setSidebarTab(key)}
                className={cn(
                  segmentedItemClass,
                  "flex flex-1 items-center justify-center px-2",
                  sidebarTab === key && segmentedItemActiveClass,
                )}
                title={label}
                aria-label={label}
                aria-pressed={sidebarTab === key}
              >
                <Icon size={16} strokeWidth={1.5} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Open documents (multi-doc only) */}
      {docEntries.length > 1 && (
        <div className="space-y-0.5 px-3 pb-2">
          <p className="px-2 py-1 text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
            {t("reader.sidebar.openDocuments")}
          </p>
          {docEntries.map(([id, _doc]) => (
            <button
              key={id}
              onClick={() => setActiveDocument(id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors cursor-pointer",
                activeDocumentId === id
                  ? "bg-bg-tertiary text-text-primary"
                  : "text-text-muted hover:bg-bg-secondary hover:text-text-primary",
              )}
            >
              <FileText size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{getDisplayTitle(id)}</span>
            </button>
          ))}
        </div>
      )}

      {sidebarTab === "contents" && !meta && (
        <span className="px-5 py-1 text-xs text-text-muted-2">
          {t("reader.sidebar.noDocumentOpen")}
        </span>
      )}

      {/* Tab content */}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
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
                    "block w-full rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors cursor-pointer",
                    currentPage === i + 1
                      ? "bg-bg-tertiary text-text-primary"
                      : "text-text-muted hover:bg-bg-secondary hover:text-text-primary",
                  )}
                >
                  {t("reader.sidebar.page", { n: i + 1 })}
                </button>
              ))}
          </>
        )}

        {/* Bookmarks tab */}
        {sidebarTab === "bookmarks" && (
          <div className="px-1 py-1">
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
                  className="group flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
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
                        "h-4 w-4 rounded-[5px] transition-colors",
                        selectedNoteIds.has(note.id)
                          ? "bg-text-primary text-bg-primary"
                          : "bg-bg-tertiary hover:bg-surface-3",
                      )}
                    >
                      {selectedNoteIds.has(note.id) && (
                        <svg viewBox="0 0 16 16" className="h-4 w-4">
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
                    {noteDisplayTitle(note, t)}
                  </span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-danger hover:bg-danger/10 transition-all cursor-pointer"
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
            {visibleWhiteboards.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-muted">
                {t("reader.sidebar.noWhiteboards")}
              </p>
            ) : (
              visibleWhiteboards.map((wb, index) => (
                <div
                  key={wb.id}
                  onClick={(e) => handleWhiteboardClick(wb.id, index, e)}
                  className="group flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
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
                        "h-4 w-4 rounded-[5px] transition-colors",
                        selectedWhiteboardIds.has(wb.id)
                          ? "bg-text-primary text-bg-primary"
                          : "bg-bg-tertiary hover:bg-surface-3",
                      )}
                    >
                      {selectedWhiteboardIds.has(wb.id) && (
                        <svg viewBox="0 0 16 16" className="h-4 w-4">
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
                    {whiteboardDisplayTitle(wb, t)}
                  </span>
                  {/* Quick delete */}
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-text-muted hover:text-danger hover:bg-danger/10 transition-all cursor-pointer"
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
        <div className="flex items-center justify-between rounded-panel bg-bg-secondary p-2 mx-3 mb-3">
          <span className="text-xs text-text-muted px-2">
            {t("reader.sidebar.countSelected", { count: selectedNoteIds.size })}
          </span>
          <button
            onClick={handleDeleteSelectedNotes}
            className="flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10 cursor-pointer"
          >
            <Trash2 size={12} />
            {t("reader.sidebar.delete")}
          </button>
        </div>
      )}
      {sidebarTab === "whiteboards" && whiteboardSelectionActive && (
        <div className="flex items-center justify-between rounded-panel bg-bg-secondary p-2 mx-3 mb-3">
          <span className="text-xs text-text-muted px-2">
            {t("reader.sidebar.countSelected", { count: selectedWhiteboardIds.size })}
          </span>
          <button
            onClick={handleDeleteSelectedWhiteboards}
            className="flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10 cursor-pointer"
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

/** Standalone sidebar with its sizing wrapper (non-Dockview use). */
export function ReaderSidebar() {
  return (
    <div className="h-full w-60 shrink-0">
      <ReaderSidebarContent />
    </div>
  );
}
