import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Upload, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUploadStore } from "@/stores/upload-store";
import { useLibraryStore } from "@/stores/library-store";
import { StorageUsageBar } from "./StorageUsageBar";

interface UploadPdfModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Pick-a-PDF modal. The actual upload runs in the background — on
 * Upload click we enqueue and close immediately, and the user
 * watches per-file progress on a ghost card in the library grid.
 * Only the synchronous gate (storage-limit pre-check) stays in the
 * modal so the user gets the over-budget warning *before* the file
 * disappears from view.
 */
export function UploadPdfModal({ open, onClose }: UploadPdfModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const enqueueUpload = useUploadStore((s) => s.enqueueUpload);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);

  useEffect(() => {
    if (open) {
      fetchStorageUsage();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local state when the modal is opened
      setSelectedFile(null);
    }
  }, [open, fetchStorageUsage]);

  const handleFileSelect = useCallback((file: File) => {
    if (file.type !== "application/pdf") {
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
      e.target.value = "";
    },
    [handleFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleUpload = () => {
    if (!selectedFile) return;
    enqueueUpload(selectedFile, currentFolderId);
    setSelectedFile(null);
    onClose();
  };

  const handleClose = () => {
    setSelectedFile(null);
    onClose();
  };

  if (!open) return null;

  const wouldExceed =
    storageUsage &&
    selectedFile &&
    storageUsage.usedBytes + selectedFile.size > storageUsage.limitBytes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("library.uploadModal.title")}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {/* Drop zone / file picker */}
          {!selectedFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
                dragOver
                  ? "border-accent-purple bg-accent-purple/10"
                  : "border-glass-border hover:border-accent-purple/50",
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={32} className="text-text-muted" />
              <p className="text-sm text-text-primary">
                {t("library.uploadModal.dropZone")}
              </p>
              <p className="text-xs text-text-muted">
                {t("library.uploadModal.pdfOnly")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center gap-3 rounded-lg border border-glass-border p-3">
                <FileText size={24} className="shrink-0 text-accent-purple" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(selectedFile.size)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Storage warning — synchronous pre-check so the user
                  sees this *here*, not on a doomed ghost card. */}
              {wouldExceed && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <p className="text-xs text-red-400">
                    {t("library.uploadModal.wouldExceed")}
                  </p>
                </div>
              )}

              {/* Storage usage bar */}
              {storageUsage && (
                <StorageUsageBar
                  usedBytes={storageUsage.usedBytes}
                  limitBytes={storageUsage.limitBytes}
                  tier={storageUsage.tier}
                />
              )}
            </div>
          )}

          {/* Actions */}
          {selectedFile && (
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleUpload} disabled={!!wouldExceed}>
                <Upload size={16} />
                {t("library.uploadModal.upload")}
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}
