import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { useReaderStore } from "@/stores/reader-store";
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

/** Inner content component used by Dockview panel (no outer sizing wrapper) */
export function ReaderSidebarContent() {
  const meta = useReaderStore((s) => s.meta);
  const toc = useReaderStore((s) => s.toc);
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const goToPage = useReaderStore((s) => s.goToPage);

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

  return (
    <div className="h-full flex flex-col bg-bg-secondary/50">
      <div className="p-4 border-b border-glass-border">
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
          {meta ? "Table of Contents" : "Reader"}
        </h3>
        {meta && (
          <p className="mt-1 text-xs text-text-secondary truncate">
            {meta.title}
          </p>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {!meta && (
          <p className="px-3 py-2 text-sm text-text-muted">
            Open a document to see its contents.
          </p>
        )}

        {meta &&
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
