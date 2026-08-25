import { useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { useUIStore } from "@/stores/ui-store";
import { openDocumentFromFile } from "@/lib/open-document";
import { logUploadAttempt } from "@/lib/upload-telemetry";

/** Open a local File (file picker / drag-drop) in the reader. */
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
        const docId = await openDocumentFromFile({
          file,
          navigate,
          shouldNavigate,
        });

        void logUploadAttempt({ file, status: "accepted" });

        return docId;
      } catch (err) {
        void logUploadAttempt({
          file,
          status: "parse_failed",
          failureReason:
            err instanceof Error ? err.message : "Adapter threw while loading.",
        });
        throw err;
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
