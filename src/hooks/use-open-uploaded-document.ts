import { useCallback } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { createAdapterForFile } from "@/features/reader/adapters";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";
import type { UploadedLibraryItem } from "@/types/catalog";

// Module-level cache: once downloaded, re-opening is instant within session
const blobCache = new Map<string, Blob>();

export function useOpenUploadedDocument() {
  const navigate = useNavigate();

  const openUploadedBook = useCallback(
    async (entry: UploadedLibraryItem) => {
      const { setLoading } = useUIStore.getState();
      setLoading(true, "Downloading file...");

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

        // Convert to File so the adapter pipeline can pick the right format.
        const file = new File([blob], file_name);

        const adapter = createAdapterForFile(file);
        setLoading(true, "Extracting table of contents...");
        const docId = await useReaderStore.getState().addDocument(adapter, file);

        registerFile(docId, file);
        navigate(`/reader/${docId}`);
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  return { openUploadedBook };
}
