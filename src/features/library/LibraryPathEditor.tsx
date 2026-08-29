import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, Folder as FolderIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Folder } from "@/types/database";

const SEP = "/";
const MAX_SUGGESTIONS = 8;

/** "IT/cloudflare" for every folder, walking parent_id up to the root. */
function buildFolderPaths(folders: Folder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();
  const pathOf = (f: Folder, depth = 0): string => {
    const hit = cache.get(f.id);
    if (hit !== undefined) return hit;
    // depth guard against a corrupt parent cycle
    const parent = f.parent_id && depth < 64 ? byId.get(f.parent_id) : undefined;
    const path = parent ? `${pathOf(parent, depth + 1)}${SEP}${f.name}` : f.name;
    cache.set(f.id, path);
    return path;
  };
  for (const f of folders) pathOf(f);
  return cache;
}

interface LibraryPathEditorProps {
  folders: Folder[];
  /** Root → current folder. */
  folderPath: Folder[];
  onNavigate: (folderId: string | null) => void;
  onClose: () => void;
}

/**
 * File-manager style path box that replaces the breadcrumb while open
 * (Ctrl+Shift+L or a click on the trail; plain Ctrl+L is reserved by
 * Chromium for the address bar). Type a path like "IT/cloudflare",
 * pick from the autocomplete (↑/↓, Tab fills, Enter goes), Esc or blur
 * cancels. Matching is case-insensitive on the full path; an empty box
 * means the root ("All files").
 */
export function LibraryPathEditor({
  folders,
  folderPath,
  onNavigate,
  onClose,
}: LibraryPathEditorProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = folderPath.map((f) => f.name).join(SEP);
  const [value, setValue] = useState(initial);
  const [selected, setSelected] = useState(0);

  const paths = useMemo(() => buildFolderPaths(folders), [folders]);
  const entries = useMemo(
    () =>
      Array.from(paths.entries())
        .map(([id, path]) => ({ id, path }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [paths],
  );

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return entries.slice(0, MAX_SUGGESTIONS);
    // prefix hits first (what a file manager completes to), then substring
    const prefix = entries.filter((e) => e.path.toLowerCase().startsWith(q));
    const rest = entries.filter(
      (e) => !e.path.toLowerCase().startsWith(q) && e.path.toLowerCase().includes(q),
    );
    return [...prefix, ...rest].slice(0, MAX_SUGGESTIONS);
  }, [entries, value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  /** Exact (case-insensitive) match of the typed path, or null for root,
   *  or undefined when nothing matches. */
  const resolve = useCallback(
    (raw: string): string | null | undefined => {
      const q = raw.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
      if (!q) return null;
      const hit = entries.find((e) => e.path.toLowerCase() === q);
      return hit ? hit.id : undefined;
    },
    [entries],
  );

  const go = useCallback(
    (target: string | null) => {
      onNavigate(target);
      onClose();
    },
    [onNavigate, onClose],
  );

  const submit = useCallback(() => {
    const exact = resolve(value);
    if (exact !== undefined) {
      go(exact);
      return;
    }
    const pick = suggestions[selected];
    if (pick) go(pick.id);
  }, [resolve, value, suggestions, selected, go]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (suggestions.length ? (s + 1) % suggestions.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) =>
        suggestions.length ? (s - 1 + suggestions.length) % suggestions.length : 0,
      );
    } else if (e.key === "Tab") {
      // shell-style completion: fill the highlighted suggestion, stay open
      const pick = suggestions[selected];
      if (pick) {
        e.preventDefault();
        setValue(pick.path);
        setSelected(0);
      }
    }
  };

  return (
    // mobile: the toolbar row is too tight to share, so the box overlays
    // the whole row (the toolbar row is position: relative); desktop keeps
    // it inline where the breadcrumb was
    <div className="absolute inset-0 z-30 flex min-w-0 flex-col justify-center bg-bg-primary sm:relative sm:inset-auto sm:flex-1 sm:bg-transparent">
      <div className="field flex items-center gap-2 py-1">
        <FolderIcon size={14} strokeWidth={1.5} className="shrink-0 text-text-muted" />
        <span className="shrink-0 text-xs text-text-muted-2">
          {t("library.list.breadcrumb.allFiles")}
          {SEP}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          // blur = cancel, but let a click on a suggestion land first
          onBlur={() => setTimeout(onClose, 120)}
          placeholder={t("library.pathEditor.placeholder")}
          aria-label={t("library.pathEditor.label")}
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-muted-2"
        />
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded bg-surface-3 px-1 text-2xs text-text-muted sm:inline-flex">
          <CornerDownLeft size={10} strokeWidth={1.5} />
        </kbd>
      </div>
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-panel bg-bg-tertiary py-1 shadow-page"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => {
                // mousedown beats the input blur
                e.preventDefault();
                go(s.id);
              }}
              onMouseEnter={() => setSelected(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                i === selected
                  ? "bg-surface-3 text-text-primary"
                  : "text-text-secondary",
              )}
            >
              <FolderIcon size={13} strokeWidth={1.5} className="shrink-0 text-text-muted" />
              <span className="truncate font-mono text-xs">{s.path}</span>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length === 0 && value.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-panel bg-bg-tertiary px-3 py-2 text-xs text-text-muted shadow-page">
          {t("library.pathEditor.noMatch")}
        </div>
      )}
    </div>
  );
}
