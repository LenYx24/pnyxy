import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { registerFile } from "@/lib/file-store";
import { saveLastOpenedBook } from "@/lib/last-opened-book";
import { loadBookBlob, saveBookBlob } from "@/lib/offline-books";
import { logError } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import type { CatalogBook } from "@/types/catalog";

function guessExtension(url: string): "pdf" | "epub" | "txt" | "html" | "bin" {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".htm") || lower.endsWith(".html")) return "html";
  return "bin";
}

function mimeFor(ext: string): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "epub":
      return "application/epub+zip";
    case "txt":
      return "text/plain";
    case "html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

/**
 * Open a catalog book inside the Pnyxy reader. Two-step strategy:
 *
 *   1. Try a direct cross-origin `fetch(url)`. This is the fast path
 *      for hosts that send permissive CORS (Standard Ebooks, most of
 *      Gutenberg's EPUBs, archive.org).
 *
 *   2. On failure (CORS block, opaque response, network error), fall
 *      back to the `catalog-fetch` Supabase edge function, a
 *      whitelisted server-side proxy that strips CORS. Requires the
 *      user to be signed in (the edge function verifies their JWT).
 *
 *   3. If both fail and the user isn't signed in, open the URL in a
 *      new tab as a last resort.
 *
 * Cached in memory per book id so re-opens within the session are
 * instant (no re-download).
 */
const blobCache = new Map<string, File>();

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function fetchViaProxy(url: string): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not-authenticated");

  const fnUrl = `${SUPABASE_URL}/functions/v1/catalog-fetch?url=${encodeURIComponent(url)}`;
  const res = await fetch(fnUrl, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error(`proxy_${res.status}`);
  return res;
}

export function useOpenCatalogBook() {
  const navigate = useNavigate();
  const location = useLocation();
  // Snapshot the entry pathname so the reader's back arrow can return
  // to wherever the user opened from. Same trick as
  // useOpenUploadedDocument, see the comment there.
  const openedFrom = location.pathname + location.search;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCatalogBook = useCallback(
    async (book: CatalogBook): Promise<void> => {
      const url = book.download_url;
      if (!url) {
        setError("no-file");
        return;
      }

      setError(null);
      setLoading(true);
      try {
        // Re-use cached file if we've already downloaded in-session.
        const cached = blobCache.get(book.id);
        if (cached) {
          registerFile(book.id, cached);
          saveLastOpenedBook({ source: "catalog", id: book.id, title: book.title });
          navigate(`/reader/${book.id}`, { state: { from: openedFrom } });
          return;
        }

        // Persistent offline copy (survives restart) before hitting the network.
        const offline = await loadBookBlob(book.id);
        if (offline) {
          const ext = guessExtension(url);
          const filename = `${book.title.replace(/[^\w.-]+/g, "_")}.${ext}`;
          const offlineFile =
            offline instanceof File
              ? offline
              : new File([offline], filename, {
                  type: offline.type || mimeFor(ext),
                });
          blobCache.set(book.id, offlineFile);
          registerFile(book.id, offlineFile);
          saveLastOpenedBook({ source: "catalog", id: book.id, title: book.title });
          navigate(`/reader/${book.id}`, { state: { from: openedFrom } });
          return;
        }

        let res: Response;
        try {
          res = await fetch(url, { mode: "cors" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (directErr) {
          // Direct CORS failed, try the server-side proxy.
          logError("useOpenCatalogBook:direct", directErr);
          try {
            res = await fetchViaProxy(url);
          } catch (proxyErr) {
            // Proxy failed too, usually because the user isn't
            // signed in. Last-resort fallback: new tab.
            logError("useOpenCatalogBook:proxy", proxyErr);
            window.open(url, "_blank", "noopener,noreferrer");
            setError("cors-fallback");
            return;
          }
        }

        const blob = await res.blob();
        const ext = guessExtension(url);
        const filename = `${book.title.replace(/[^\w.-]+/g, "_")}.${ext}`;
        const file = new File([blob], filename, {
          type: blob.type || mimeFor(ext),
        });

        blobCache.set(book.id, file);
        // persist for offline re-opening
        void saveBookBlob(book.id, file);
        registerFile(book.id, file);
        saveLastOpenedBook({ source: "catalog", id: book.id, title: book.title });
        navigate(`/reader/${book.id}`, { state: { from: openedFrom } });
      } catch (err) {
        logError("useOpenCatalogBook", err);
        setError("fetch-failed");
      } finally {
        setLoading(false);
      }
    },
    [navigate, openedFrom],
  );

  return { openCatalogBook, loading, error };
}
