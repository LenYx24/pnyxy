import { useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { createPdfAdapter } from "@/features/reader/adapters/pdf-adapter";
import { useReaderStore } from "@/stores/reader-store";
import { registerFile } from "@/lib/file-store";

export function useOpenPdf() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const adapter = createPdfAdapter();
      const meta = await adapter.load(file);
      const toc = await adapter.extractToc();

      registerFile(meta.id, file);

      useReaderStore.setState({
        adapter,
        meta,
        toc,
        currentPage: 1,
        totalPages: meta.totalPages,
        zoomMode: "fit-width",
        zoomLevel: 100,
        scrollToPage: null,
      });

      navigate(`/app/reader/${meta.id}`);
      e.target.value = "";
    },
    [navigate],
  );

  return { fileInputRef, triggerFilePicker, handleFileSelect };
}
