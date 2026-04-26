import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Upload, FileText, Check, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUploadStore } from "@/stores/upload-store";
import { useLibraryStore } from "@/stores/library-store";
import { StorageUsageBar } from "./StorageUsageBar";

interface UploadPdfModalProps {
  open: boolean;
  onClose: () => void;
}

export function UploadPdfModal({ open, onClose }: UploadPdfModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploading = useUploadStore((s) => s.isUploading);
  const uploadProgress = useUploadStore((s) => s.uploadProgress);
  const error = useUploadStore((s) => s.error);
  const storageUsage = useUploadStore((s) => s.storageUsage);
  const uploadPdf = useUploadStore((s) => s.uploadPdf);
  const clearError = useUploadStore((s) => s.clearError);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);

  useEffect(() => {
    if (open) {
      fetchStorageUsage();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local state when the modal is opened
      setSelectedFile(null);
      setSuccess(false);
      clearError();
    }
  }, [open, fetchStorageUsage, clearError]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (file.type !== "application/pdf") {
        return;
      }
      clearError();
      setSelectedFile(file);
    },
    [clearError],
  );

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

  const handleUpload = async () => {
    if (!selectedFile) return;
    const bookId = await uploadPdf(selectedFile, currentFolderId);
    if (bookId) {
      setSuccess(true);
      await fetchLibrary();
    }
  };

  const handleClose = () => {
    if (isUploading) return;
    setSelectedFile(null);
    setSuccess(false);
    clearError();
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
            disabled={isUploading}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
                <Check size={24} className="text-green-400" />
              </div>
              <p className="text-center text-sm text-text-primary">
                {t("library.uploadModal.successTitle")}
              </p>
              <p className="text-center text-xs text-text-muted">
                {t("library.uploadModal.successBody")}
              </p>
              <Button variant="secondary" onClick={handleClose}>
                {t("common.close")}
              </Button>
            </div>
          ) : (
            <>
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
                    {!isUploading && (
                      <button
                        onClick={() => {
                          setSelectedFile(null);
                          clearError();
                        }}
                        className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Storage warning */}
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

                  {/* Upload progress */}
                  {isUploading && (
                    <div className="space-y-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-glass-border">
                        <div
                          className="h-full rounded-full bg-accent-purple transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-center text-xs text-text-muted">
                        {t("library.uploadModal.uploading", {
                          pct: uploadProgress,
                        })}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </p>
              )}

              {/* Actions */}
              {selectedFile && !isUploading && (
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={handleClose}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={handleUpload} disabled={!!wouldExceed}>
                    {isUploading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <Upload size={16} />
                        {t("library.uploadModal.upload")}
                      </>
                    )}
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
            </>
          )}
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
