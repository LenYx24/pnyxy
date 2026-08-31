import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { getFile, registerFile } from "@/lib/file-store";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import { createAdapterForFile } from "../adapters";

/** Re-fetch a book's binary from Supabase after a refresh wipes the file-store. Returns null on failure. */
async function recoverBookFile(bookId: string): Promise<File | null> {
  // uploaded books, keyed by file_hash
  try {
    const { data: uploaded, error } = await supabase
      .from("books")
      .select("title, file_hash, book_files(storage_path, file_name)")
      .eq("file_hash", bookId)
      .limit(1)
      .maybeSingle();
    if (!error && uploaded) {
      const fileMeta = uploaded.book_files as
        | { storage_path: string; file_name: string }[]
        | { storage_path: string; file_name: string }
        | null;
      const first = Array.isArray(fileMeta) ? fileMeta[0] : fileMeta;
      if (first?.storage_path) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("book-files")
          .download(first.storage_path);
        if (!dlErr && blob) {
          return new File([blob], first.file_name ?? "document");
        }
      }
    }
  } catch (err) {
    logError("reader:recover:uploaded", err);
  }

  // catalog books, by id. Direct fetch, fall back to edge function for CORS-blocked hosts.
  try {
    const { data: catalog, error } = await supabase
      .from("catalog_books")
      .select("title, download_url")
      .eq("id", bookId)
      .limit(1)
      .maybeSingle();
    if (error || !catalog?.download_url) return null;
    const url = catalog.download_url as string;
    let res: Response;
    try {
      res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (directErr) {
      logError("reader:recover:catalog:direct", directErr);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) return null;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-fetch?url=${encodeURIComponent(url)}`;
      try {
        res = await fetch(fnUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (!res.ok) return null;
      } catch (proxyErr) {
        logError("reader:recover:catalog:proxy", proxyErr);
        return null;
      }
    }
    const blob = await res.blob();
    // filename from the URL; adapter only needs bytes + extension
    const urlPath = url.toLowerCase().split("?")[0];
    const ext = urlPath.endsWith(".epub")
      ? ".epub"
      : urlPath.endsWith(".pdf")
        ? ".pdf"
        : urlPath.endsWith(".txt")
          ? ".txt"
          : "";
    const filename =
      ((catalog.title as string | null) ?? "document").replace(
        /[^\w.-]+/g,
        "_",
      ) + ext;
    return new File([blob], filename, { type: blob.type });
  } catch (err) {
    logError("reader:recover:catalog", err);
    return null;
  }
}

/**
 * Loads the route's document from the in-memory registry, or re-fetches it
 * from Supabase if a refresh wiped it.
 */
export function useReaderDocumentLoad(
  bookId: string | undefined,
  bookDocumentLoaded: boolean,
): void {
  const { t } = useTranslation();
  const addDocument = useReaderStore((s) => s.addDocument);
  // Bumped per cold-path recovery; the async finally only clears the spinner
  // when the token still matches, so mid-recovery navigation keeps the newer state.
  const loadingTokenRef = useRef(0);

  useEffect(() => {
    if (!bookId || bookDocumentLoaded) return;
    let cancelled = false;
    const file = getFile(bookId);
    if (file) {
      // hot path: file already in memory
      const adapter = createAdapterForFile(file);
      void addDocument(adapter, file).catch((error) => {
        if (cancelled) return;
        logError("addDocument", error);
        showToast(t("reader.openFailed"), "error");
      });
      return;
    }
    // cold path: post-refresh recovery. `cancelled` gates applying the doc so a
    // fast bookId change can't race two opens; the spinner uses loadingTokenRef.
    const setLoading = useUIStore.getState().setLoading;
    const token = ++loadingTokenRef.current;
    setLoading(true, t("reader.page.loadingDocumentMessage"));
    void (async () => {
      try {
        const recovered = await recoverBookFile(bookId);
        if (cancelled) return;
        if (!recovered) {
          // recoverBookFile already logged the underlying cause; the user
          // just needs to know the open failed, same toast as the hot path.
          showToast(t("reader.openFailed"), "error");
          return;
        }
        registerFile(bookId, recovered);
        const adapter = createAdapterForFile(recovered);
        await addDocument(adapter, recovered);
      } catch (error) {
        if (!cancelled) {
          logError("addDocument", error);
          showToast(t("reader.openFailed"), "error");
        }
      } finally {
        if (loadingTokenRef.current === token) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, bookDocumentLoaded, addDocument, t]);
}
