import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLibraryStore } from "@/stores/library-store";

/**
 * Cover tint for the reader desk. The whole reader screen is the desk
 * colour; when the open book has a cover we mix its average colour into
 * the desk at 6% (`--reader-tint`), so each book gets a faint hue of its
 * own. The colour is sampled once per cover URL from a downscaled canvas
 * and cached for the session. Anything that fails (no cover, CORS, a
 * broken image) simply means no tint.
 *
 * The "Cover tint" preference lives in localStorage rather than the
 * settings store so the reader owns it end to end (default on).
 */

const PREF_KEY = "pnyxy-reader-cover-tint";
const listeners = new Set<() => void>();

function readPref(): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

let prefCache = readPref();

function setPref(next: boolean) {
  prefCache = next;
  try {
    localStorage.setItem(PREF_KEY, next ? "1" : "0");
  } catch {
    // ignore (private mode / quota)
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Whether the cover tint is enabled, plus a toggle. Shared across mounts. */
export function useCoverTintPref(): [boolean, () => void] {
  const enabled = useSyncExternalStore(subscribe, () => prefCache, () => true);
  const toggle = useCallback(() => setPref(!prefCache), []);
  return [enabled, toggle];
}

// url -> "r g b" (space separated so it drops straight into rgb()/color-mix)
const colorCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function sampleAverageColor(url: string): Promise<string | null> {
  const cached = colorCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = new Promise<string | null>((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 8) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (n === 0) return resolve(null);
        resolve(
          `${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`,
        );
      } catch {
        // tainted canvas (no CORS headers) or decode failure
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((result) => {
    colorCache.set(url, result);
    inflight.delete(url);
    return result;
  });
  inflight.set(url, p);
  return p;
}

/** Cover URL of a library book by the reader's document id (books row id
 *  for uploads, catalog book id or user_library row id for catalog books). */
function findCoverUrl(docId: string | null): string | null {
  if (!docId) return null;
  const items = useLibraryStore.getState().books;
  for (const item of items) {
    if (item.source === "catalog") {
      if (item.id === docId || item.catalog_book_id === docId) {
        return item.catalog_book.cover_url ?? null;
      }
    } else if (item.id === docId || item.book.id === docId) {
      return item.book.cover_url ?? null;
    }
  }
  return null;
}

/**
 * Returns the CSS value for `--reader-tint` (an `rgb(r g b)` string) or
 * null when no tint should apply. Pass the result as an inline CSS
 * variable on the reader shell; the stylesheet does the 6% mix.
 */
export function useReaderTint(docId: string | null): string | null {
  const [enabled] = useCoverTintPref();
  const books = useLibraryStore((s) => s.books);
  const [tint, setTint] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived reset when the pref flips off; cannot cascade
      setTint(null);
      return;
    }
    const url = findCoverUrl(docId);
    if (!url) {
      // no cover for this doc: clear any stale tint from the previous book
      setTint(null);
      return;
    }
    let cancelled = false;
    void sampleAverageColor(url).then((rgb) => {
      if (cancelled) return;
      setTint(rgb ? `rgb(${rgb})` : null);
    });
    return () => {
      cancelled = true;
    };
    // `books` is a dep so the tint appears once the library list loads.
  }, [docId, enabled, books]);

  return tint;
}
