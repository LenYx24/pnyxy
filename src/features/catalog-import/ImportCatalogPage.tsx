import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Search,
  Loader2,
  Check,
  ArrowLeft,
  BookOpen,
  FileX2,
  Plus,
} from "lucide-react";
import { Button, Checkbox, GlassCard } from "@/components/ui";
import { useBrowseStore } from "@/stores/browse-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";
import {
  SOURCES,
  resultToCatalogInsert,
  type ImportResult,
  type ImportSourceId,
} from "./sources";
import { logError } from "@/lib/logger";

const DEFAULT_ENABLED: Record<ImportSourceId, boolean> = {
  open_library: true,
  project_gutenberg: true,
  standard_ebooks: false,
  mek: false,
};

const PER_SOURCE_LIMIT = 20;

interface SourceState {
  results: ImportResult[];
  loading: boolean;
  error: string | null;
}

/**
 * In-app catalog importer. Multi-source search across Open Library
 * and Project Gutenberg (the two sources whose public APIs are
 * CORS-friendly). Standard Ebooks and MEK are listed but disabled
 * with their reasons so the UI is honest about why they're offline.
 *
 * Results merge into one scrollable list with a source badge per
 * card. Clicking "Add" upserts into catalog_books (via the existing
 * addBookToCatalog flow) and then adds the book to the user's
 * library. Already-added books show a disabled checkmark so repeat
 * clicks are idempotent within the session.
 */
export function ImportCatalogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const addBookToCatalog = useBrowseStore((s) => s.addBookToCatalog);
  const addToUserLibrary = useBrowseStore((s) => s.addToUserLibrary);

  const [query, setQuery] = useState("");
  const [enabled, setEnabled] =
    useState<Record<ImportSourceId, boolean>>(DEFAULT_ENABLED);
  const [sourceState, setSourceState] = useState<
    Record<ImportSourceId, SourceState>
  >(() => {
    const initial = {} as Record<ImportSourceId, SourceState>;
    for (const s of SOURCES) {
      initial[s.id] = { results: [], loading: false, error: null };
    }
    return initial;
  });
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());

  // Debounce the query so every keystroke doesn't fire parallel
  // fetches to every source.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSourceState((prev) => {
          const next = { ...prev };
          for (const s of SOURCES) {
            next[s.id] = { ...next[s.id], results: [], error: null };
          }
          return next;
        });
        return;
      }
      // Kick off each enabled source in parallel. Each manages its
      // own slot in sourceState so one source's failure doesn't
      // block the others.
      await Promise.all(
        SOURCES.map(async (s) => {
          if (!enabled[s.id] || s.disabled) return;
          setSourceState((prev) => ({
            ...prev,
            [s.id]: { ...prev[s.id], loading: true, error: null },
          }));
          try {
            const results = await s.search(q.trim(), PER_SOURCE_LIMIT);
            setSourceState((prev) => ({
              ...prev,
              [s.id]: { results, loading: false, error: null },
            }));
          } catch (err) {
            logError(`ImportCatalog:${s.id}`, err);
            setSourceState((prev) => ({
              ...prev,
              [s.id]: {
                results: [],
                loading: false,
                error: err instanceof Error ? err.message : "unknown",
              },
            }));
          }
        }),
      );
    },
    [enabled],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 400);
  };

  // Re-run the search when the enabled-sources checkboxes change so
  // a newly-enabled source fetches its current-query results right
  // away.
  useEffect(() => {
    if (query.trim()) runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const handleAdd = async (result: ImportResult) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    const key = result.canonicalSourceId;
    if (added.has(key) || adding.has(key)) return;
    setAdding((prev) => new Set(prev).add(key));
    try {
      await addBookToCatalog(resultToCatalogInsert(result));
      // Now locate the newly inserted catalog row to add to user
      // library. addBookToCatalog doesn't return the id, so we fetch
      // by source_id. In practice the realtime subscription will
      // also update the list, but the explicit lookup keeps the
      // "Add to library" action snappy.
      const bookId = await lookupBookId(result.canonicalSourceId);
      if (bookId) await addToUserLibrary(bookId);
      setAdded((prev) => new Set(prev).add(key));
    } catch (err) {
      logError("ImportCatalog:add", err);
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Flatten all enabled sources' results for rendering. Keep source
  // tag attached so the badge renders from the merged list.
  const allResults = SOURCES.filter((s) => enabled[s.id] && !s.disabled).flatMap(
    (s) => sourceState[s.id].results,
  );
  const anyLoading = SOURCES.some(
    (s) => enabled[s.id] && sourceState[s.id].loading,
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-5 flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("/browse")}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-text-primary sm:text-2xl">
            {t("catalogImport.title")}
          </h1>
          <p className="text-xs text-text-secondary sm:text-sm">
            {t("catalogImport.subtitle")}
          </p>
        </div>
      </header>

      {/* Source picker */}
      <GlassCard className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          {t("catalogImport.searchIn")}
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => {
            const isDisabled = !!s.disabled;
            return (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border border-glass-border/60 bg-glass-bg/40 p-2.5",
                  isDisabled && "cursor-not-allowed opacity-50",
                )}
              >
                <Checkbox
                  checked={enabled[s.id] && !isDisabled}
                  onChange={() =>
                    !isDisabled &&
                    setEnabled((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                  }
                  disabled={isDisabled}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {t(s.nameKey)}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {isDisabled
                      ? t(`catalogImport.disabled.${s.disabled}`)
                      : t(s.hintKey)}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </GlassCard>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t("catalogImport.searchPlaceholder")}
          autoFocus
          className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 pl-9 text-sm text-text-primary backdrop-blur-md placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
        />
        {anyLoading && (
          <Loader2
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted"
          />
        )}
      </div>

      {/* Results */}
      {!query.trim() ? (
        <p className="py-12 text-center text-sm text-text-muted">
          {t("catalogImport.emptyQuery")}
        </p>
      ) : allResults.length === 0 && !anyLoading ? (
        <p className="py-12 text-center text-sm text-text-muted">
          {t("catalogImport.noResults")}
        </p>
      ) : (
        <ul className="space-y-2">
          {allResults.map((r) => (
            <ResultRow
              key={`${r.sourceId}:${r.canonicalSourceId}`}
              result={r}
              isAdded={added.has(r.canonicalSourceId)}
              isAdding={adding.has(r.canonicalSourceId)}
              onAdd={() => handleAdd(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

async function lookupBookId(sourceId: string): Promise<string | null> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("catalog_books")
    .select("id")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

function ResultRow({
  result,
  isAdded,
  isAdding,
  onAdd,
}: {
  result: ImportResult;
  isAdded: boolean;
  isAdding: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-3 rounded-lg border border-glass-border bg-glass-bg/30 p-3">
      <div className="relative aspect-[2/3] h-20 shrink-0 overflow-hidden rounded-md bg-glass-bg">
        {result.coverUrl ? (
          <img
            src={result.coverUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/25 to-accent-blue/25">
            <BookOpen size={20} className="text-white/25" />
          </div>
        )}
        {!result.downloadUrl && (
          <span
            className="absolute right-0.5 top-0.5 rounded bg-bg-primary/80 p-0.5 text-text-muted backdrop-blur-sm"
            title={t("catalogImport.metadataOnlyTooltip")}
          >
            <FileX2 size={8} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3
          className="truncate text-sm font-semibold text-text-primary"
          title={result.title}
        >
          {result.title}
        </h3>
        <p
          className="truncate text-xs text-text-muted"
          title={result.authors.join(", ")}
        >
          {result.authors.join(", ")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-accent-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-purple">
            {t(`catalogImport.sources.${camelSource(result.sourceId)}.name`)}
          </span>
          {result.downloadUrl ? (
            <span className="text-[10px] text-green-400">
              {t("catalogImport.hasFile")}
            </span>
          ) : (
            <span className="text-[10px] text-text-muted">
              {t("catalogImport.metadataOnly")}
            </span>
          )}
        </div>
      </div>
      <Button
        variant={isAdded ? "ghost" : "primary"}
        onClick={onAdd}
        disabled={isAdded || isAdding}
        className="shrink-0"
      >
        {isAdding ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isAdded ? (
          <>
            <Check size={14} />
            {t("catalogImport.added")}
          </>
        ) : (
          <>
            <Plus size={14} />
            {t("catalogImport.add")}
          </>
        )}
      </Button>
    </li>
  );
}

function camelSource(id: ImportSourceId): string {
  switch (id) {
    case "open_library":
      return "openLibrary";
    case "project_gutenberg":
      return "gutenberg";
    case "standard_ebooks":
      return "standardEbooks";
    case "mek":
      return "mek";
  }
}
