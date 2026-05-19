import { useCallback, useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { useSearchStore } from "@/stores/search-store";
import { useActiveDocument } from "@/stores/reader-store";
import { cn } from "@/lib/cn";

/**
 * Floating VSCode-style find/replace overlay. Mounted once inside the
 * viewer area. Coordinates all format-specific rendering through the
 * `search-store` — no format-specific code lives here.
 */
export function SearchOverlay() {
  const isOpen = useSearchStore((s) => s.isOpen);
  const mode = useSearchStore((s) => s.mode);
  const query = useSearchStore((s) => s.query);
  const replacement = useSearchStore((s) => s.replacement);
  const options = useSearchStore((s) => s.options);
  const matches = useSearchStore((s) => s.matches);
  const currentIdx = useSearchStore((s) => s.currentIdx);
  const error = useSearchStore((s) => s.error);

  const setQuery = useSearchStore((s) => s.setQuery);
  const setReplacement = useSearchStore((s) => s.setReplacement);
  const setOptions = useSearchStore((s) => s.setOptions);
  const setMode = useSearchStore((s) => s.setMode);
  const close = useSearchStore((s) => s.close);
  const next = useSearchStore((s) => s.next);
  const prev = useSearchStore((s) => s.prev);
  const replaceCurrent = useSearchStore((s) => s.replaceCurrent);
  const replaceAll = useSearchStore((s) => s.replaceAll);

  const doc = useActiveDocument();
  const canReplace = !!doc?.meta.capabilities.editable;

  const findRef = useRef<HTMLInputElement>(null);

  // Auto-focus the find input whenever we open or switch mode.
  useEffect(() => {
    if (isOpen) findRef.current?.focus();
  }, [isOpen, mode]);

  // If the active doc isn't editable, coerce to find mode.
  useEffect(() => {
    if (!canReplace && mode === "replace") {
      setMode("find");
    }
  }, [canReplace, mode, setMode]);

  const handleFindKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [next, prev, close],
  );

  const handleReplaceKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) void replaceAll();
        else void replaceCurrent();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [replaceAll, replaceCurrent, close],
  );

  if (!isOpen) return null;

  const counter =
    matches.length === 0
      ? query
        ? "No results"
        : ""
      : `${currentIdx + 1}/${matches.length}`;

  return (
    <div
      className="pointer-events-auto absolute left-2 right-2 top-3 z-50 flex flex-col gap-1 rounded-md border border-glass-border bg-bg-secondary/95 px-2 py-2 shadow-lg backdrop-blur-xl sm:left-auto sm:right-4 sm:min-w-[22rem]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Search size={14} className="text-text-muted" />
        <input
          ref={findRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleFindKey}
          placeholder="Find"
          className="min-w-0 flex-1 rounded border border-glass-border bg-glass-bg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
        />
        <OptionButton
          label="Match case"
          active={options.caseSensitive}
          onClick={() =>
            setOptions({ caseSensitive: !options.caseSensitive })
          }
        >
          <CaseSensitive size={14} />
        </OptionButton>
        <OptionButton
          label="Match whole word"
          active={options.wholeWord}
          onClick={() => setOptions({ wholeWord: !options.wholeWord })}
        >
          <WholeWord size={14} />
        </OptionButton>
        <OptionButton
          label="Use regular expression"
          active={options.regex}
          onClick={() => setOptions({ regex: !options.regex })}
        >
          <Regex size={14} />
        </OptionButton>
        <span
          className={cn(
            "mx-1 min-w-[4rem] text-right font-mono text-xs",
            error ? "text-red-400" : "text-text-muted",
          )}
        >
          {error ?? counter}
        </span>
        <IconButton label="Previous match (Shift+Enter)" onClick={prev}>
          <ArrowUp size={14} />
        </IconButton>
        <IconButton label="Next match (Enter)" onClick={next}>
          <ArrowDown size={14} />
        </IconButton>
        <IconButton label="Close (Esc)" onClick={close}>
          <X size={14} />
        </IconButton>
      </div>
      {mode === "replace" && canReplace && (
        <div className="flex items-center gap-1">
          <Replace size={14} className="text-text-muted" />
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleReplaceKey}
            placeholder="Replace"
            className="min-w-0 flex-1 rounded border border-glass-border bg-glass-bg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
          />
          <IconButton
            label="Replace (Enter)"
            onClick={() => void replaceCurrent()}
          >
            <Replace size={14} />
          </IconButton>
          <IconButton
            label="Replace all (Ctrl+Enter)"
            onClick={() => void replaceAll()}
          >
            <ReplaceAll size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded p-1 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      {children}
    </button>
  );
}

function OptionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded p-1 transition-colors cursor-pointer",
        active
          ? "bg-accent-purple/20 text-accent-purple"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
