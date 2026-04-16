import { useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { createAdapterForFile } from "@/features/reader/adapters";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";

export function useOpenDocument() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openFile = useCallback(
    async (file: File, shouldNavigate = true) => {
      const { setLoading } = useUIStore.getState();
      setLoading(true, "Loading document...");

      try {
        const adapter = createAdapterForFile(file);

        setLoading(true, "Extracting table of contents...");
        const docId = await useReaderStore.getState().addDocument(adapter, file);

        registerFile(docId, file);

        if (shouldNavigate) {
          navigate(`/reader/${docId}`);
        }

        return docId;
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await openFile(file);
      e.target.value = "";
    },
    [openFile],
  );

  return { fileInputRef, triggerFilePicker, handleFileSelect, openFile };
}
