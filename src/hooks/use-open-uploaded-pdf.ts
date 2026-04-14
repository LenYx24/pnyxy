import { useCallback } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { createPdfAdapter } from "@/features/reader/adapters/pdf-adapter";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";
import type { UploadedLibraryItem } from "@/types/catalog";

// Module-level cache: once downloaded, re-opening is instant within session
const blobCache = new Map<string, Blob>();

export function useOpenUploadedPdf() {
  const navigate = useNavigate();

  const openUploadedBook = useCallback(
    async (entry: UploadedLibraryItem) => {
      const { setLoading } = useUIStore.getState();
      setLoading(true, "Downloading PDF...");

      try {
        const { storage_path, file_name } = entry.book;

        // Check cache first
        let blob = blobCache.get(storage_path);

        if (!blob) {
          const { data, error } = await supabase.storage
            .from("book-files")
            .download(storage_path);

          if (error || !data) {
            throw new Error(error?.message ?? "Failed to download file");
          }

          blob = data;
          blobCache.set(storage_path, blob);
        }

        setLoading(true, "Loading document...");

        // Convert to File for the adapter pipeline
        const file = new File([blob], file_name, { type: "application/pdf" });

        const adapter = createPdfAdapter();
        setLoading(true, "Extracting table of contents...");
        const docId = await useReaderStore.getState().addDocument(adapter, file);

        registerFile(docId, file);
        navigate(`/app/reader/${docId}`);
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  return { openUploadedBook };
}
