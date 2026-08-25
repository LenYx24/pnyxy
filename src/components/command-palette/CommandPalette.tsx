import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Keyboard, Search, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { useLibraryStore } from "@/stores/library-store";
import { useAuthStore } from "@/stores/auth-store";
import { useFeatures } from "@/lib/use-features";
import { useReaderStore } from "@/stores/reader-store";
import { useShortcutsSheet } from "@/components/ui/shortcuts-sheet-store";

interface PaletteCommand {
  id: string;
  label: string;
  /** Optional secondary text shown right after the label (e.g.
   *  author for books). Search matches against `label + sublabel`. */
  sublabel?: string;
  icon: LucideIcon;
  category: "navigate" | "book" | "command";
  run: () => void;
}

/**
 * Cmd/Ctrl+K command palette. Searches navigation destinations and
 * the user's uploaded books, runs the selected command on Enter.
 * VSCode/Obsidian-style: centered modal with a single input, list
 * below, ↑↓ to move, ↵ to run, Esc to close.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The row under the resting pointer must not steal the highlight the
  // moment the palette opens: hover-driven highlighting is ignored until
  // the pointer has actually moved (> 2 px) since opening.
  const pointerMoved = useRef(false);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const openShortcutsSheet = useShortcutsSheet((s) => s.setOpen);

  const isAdmin = useAuthStore((s) => s.profile?.role === "admin");
  const features = useFeatures();
  const hasActiveBook = useReaderStore(
    (s) => s.activeDocumentId !== null && s.documents.has(s.activeDocumentId),
  );
  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  // Lazy-load the library the first time the palette opens; if the
  // user hasn't visited /library yet there'd be nothing to search.
  useEffect(() => {
    if (open && books.length === 0) void fetchLibrary();
  }, [open, books.length, fetchLibrary]);

  useKeyboardShortcut({
    id: "app:command-palette",
    key: "k",
    ctrl: true,
    description: "Open command palette",
    handler: () => {
      pointerMoved.current = false;
      pointerOrigin.current = null;
      setOpen((v) => !v);
      setQuery("");
      setActiveIndex(0);
    },
  });

  const handlePointerMove = (e: React.MouseEvent) => {
    if (pointerMoved.current) return;
    if (!pointerOrigin.current) {
      pointerOrigin.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - pointerOrigin.current.x;
    const dy = e.clientY - pointerOrigin.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pointerMoved.current = true;
  };

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  // Build the full command list. Re-derived each render but the
  // input is small enough (~12 nav + N books) that memoization on
  // every keystroke would just be ceremony.
  const allCommands = useMemo<PaletteCommand[]>(() => {
    const visibleNav = NAV_ITEMS.filter((item) => {
      if (item.feature && !features[item.feature]) return false;
      if (item.visibleWhen === "isAdmin" && !isAdmin) return false;
      if (item.visibleWhen === "hasActiveBook" && !hasActiveBook) return false;
      return true;
    });
    const navCommands: PaletteCommand[] = visibleNav.map(
      (item: NavItem): PaletteCommand => ({
        id: `nav:${item.to}`,
        label: t(`sidebar.${item.key}`),
        icon: item.icon,
        category: "navigate",
        run: () => {
          navigate(item.to);
          close();
        },
      }),
    );
    // Only uploaded books, they have a real file to open. Catalog
    // entries route to `/books/<id>` (the metadata page) which we
    // can surface later as a separate "View" command.
    const bookCommands: PaletteCommand[] = books
      .filter((b) => b.source === "uploaded")
      .map((b) => {
        const uploaded = b as Extract<typeof b, { source: "uploaded" }>;
        return {
          id: `book:${uploaded.book.id}`,
          label: uploaded.book.title,
          sublabel: uploaded.book.author ?? undefined,
          icon: BookOpen,
          category: "book" as const,
          run: () => {
            navigate(`/reader/${uploaded.book.id}`);
            close();
          },
        };
      });
    const misc: PaletteCommand[] = [
      {
        id: "cmd:shortcuts-sheet",
        label: t("shortcuts.sheet.title"),
        icon: Keyboard,
        category: "command",
        run: () => {
          close();
          openShortcutsSheet(true);
        },
      },
    ];
    return [...navCommands, ...bookCommands, ...misc];
  }, [t, navigate, close, isAdmin, hasActiveBook, books, features, openShortcutsSheet]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    // Cheap fuzzy: every whitespace-split fragment must appear
    // somewhere in `label + sublabel`. Lets you type "linear alg
    // notes" and match a book titled "Notes on Linear Algebra".
    const fragments = q.split(/\s+/);
    return allCommands.filter((cmd) => {
      const haystack = `${cmd.label} ${cmd.sublabel ?? ""}`.toLowerCase();
      return fragments.every((f) => haystack.includes(f));
    });
  }, [query, allCommands]);

  // Clamp the highlighted row to the visible range. Cheaper and
  // safer than a setState-in-effect: we accept the underlying state
  // can be "ahead" of the list, and just normalize at read time.
  const safeActiveIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

  // Auto-focus the input on open. useLayoutEffect avoids a one-frame
  // flicker where the modal renders without focus.
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row scrolled into view when navigating with
  // arrow keys past the visible window.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-idx="${safeActiveIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) =>
        Math.min(filtered.length - 1, Math.max(0, i) + 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[safeActiveIndex];
      if (cmd) cmd.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  // Group filtered commands by category for the section headers.
  const grouped: Array<{ category: PaletteCommand["category"]; items: Array<PaletteCommand & { idx: number }> }> = [];
  filtered.forEach((cmd, idx) => {
    const tail = grouped[grouped.length - 1];
    if (tail && tail.category === cmd.category) {
      tail.items.push({ ...cmd, idx });
    } else {
      grouped.push({ category: cmd.category, items: [{ ...cmd, idx }] });
    }
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.openCommandPalette")}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-page bg-bg-tertiary shadow-page backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Search size={16} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("commandPalette.placeholder")}
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={close}
            aria-label={t("commandPalette.close")}
            className="rounded p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-1"
          onMouseMove={handlePointerMove}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">
              {t("commandPalette.empty")}
            </div>
          ) : (
            grouped.map((section) => (
              <div key={section.category} className="py-1">
                <div className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
                  {t(`commandPalette.section.${section.category}`)}
                </div>
                {section.items.map((cmd) => {
                  const Icon = cmd.icon;
                  const active = cmd.idx === safeActiveIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-cmd-idx={cmd.idx}
                      type="button"
                      onMouseEnter={() => {
                        if (pointerMoved.current) setActiveIndex(cmd.idx);
                      }}
                      onClick={cmd.run}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                        active
                          ? "bg-accent/15 text-accent"
                          : "text-text-secondary hover:bg-glass-hover",
                      )}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {cmd.label}
                      </span>
                      {cmd.sublabel && (
                        <span className="shrink-0 truncate text-xs text-text-muted">
                          {cmd.sublabel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-3 py-1.5 text-2xs text-text-muted">
          <span>
            <kbd className="rounded-md bg-surface-3 px-1">
              ↑↓
            </kbd>{" "}
            {t("commandPalette.hint.navigate")}
          </span>
          <span>
            <kbd className="rounded-md bg-surface-3 px-1">
              ↵
            </kbd>{" "}
            {t("commandPalette.hint.select")}
          </span>
          <span>
            <kbd className="rounded-md bg-surface-3 px-1">
              Esc
            </kbd>{" "}
            {t("commandPalette.hint.close")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
