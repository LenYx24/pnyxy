import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  FolderSearch,
  FileText,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUploadStore } from "@/stores/upload-store";
import { useLibraryStore } from "@/stores/library-store";
import { StorageUsageBar } from "./StorageUsageBar";

interface DeviceBookScanModalProps {
  open: boolean;
  onClose: () => void;
}

interface ScannedFile {
  file: File;
  relativePath: string;
  id: string; // synthetic key: path + size for stable React keys
  status: "pending" | "uploading" | "done" | "skipped" | "error";
  message?: string;
}

const PDF_EXT = /\.pdf$/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/**
 * Scans a directory selected by the user for book files (PDFs) and lets
 * the user pick which to upload to their cloud library. Uses the
 * non-standard but widely supported `webkitdirectory` attribute so we
 * don't need any native (Tauri) bridge — works in both the browser and
 * Tauri's webview.
 */
export function DeviceBookScanModal({ open, onClose }: DeviceBookScanModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanned, setScanned] = useState<ScannedFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const uploadPdf = useUploadStore((s) => s.uploadPdf);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  useEffect(() => {
    if (open) {
      fetchStorageUsage();
      setScanned([]);
      setSelected(new Set());
      setIsScanning(false);
      setImporting(false);
      setImportDone(false);
      setScanError(null);
    }
  }, [open, fetchStorageUsage]);

  const triggerScan = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = ""; // reset so re-scanning the same dir fires change
    if (!files || files.length === 0) return;

    setIsScanning(true);
    setScanError(null);

    const results: ScannedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!PDF_EXT.test(f.name)) continue;
      const rel =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      results.push({
        file: f,
        relativePath: rel,
        id: `${rel}::${f.size}::${f.lastModified}`,
        status: "pending",
      });
    }

    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    setScanned(results);
    // Default: all selected
    setSelected(new Set(results.map((r) => r.id)));
    setIsScanning(false);

    if (results.length === 0) {
      setScanError("No PDF files were found in that folder.");
    }
  }, []);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(scanned.map((s) => s.id)));
  }, [scanned]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedFiles = scanned.filter((s) => selected.has(s.id));
  const selectedBytes = selectedFiles.reduce((sum, f) => sum + f.file.size, 0);
  const remainingBytes = storageUsage
    ? storageUsage.limitBytes - storageUsage.usedBytes
    : Infinity;
  const wouldExceed = selectedBytes > remainingBytes;

  const startImport = useCallback(async () => {
    if (selectedFiles.length === 0 || wouldExceed) return;
    setImporting(true);

    // Capture a mutable working list we can update as we go.
    const working: ScannedFile[] = scanned.map((s) =>
      selected.has(s.id) ? { ...s, status: "pending" } : s,
    );
    setScanned(working);

    for (const item of working) {
      if (!selected.has(item.id)) continue;

      // Mark uploading
      setScanned((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, status: "uploading" } : s)),
      );

      try {
        const bookId = await uploadPdf(item.file);
        if (bookId) {
          setScanned((prev) =>
            prev.map((s) => (s.id === item.id ? { ...s, status: "done" } : s)),
          );
        } else {
          // uploadPdf handles its own error state; inspect it
          const err = useUploadStore.getState().error;
          setScanned((prev) =>
            prev.map((s) =>
              s.id === item.id
                ? {
                    ...s,
                    status: err?.toLowerCase().includes("already")
                      ? "skipped"
                      : "error",
                    message: err ?? "Upload failed",
                  }
                : s,
            ),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setScanned((prev) =>
          prev.map((s) =>
            s.id === item.id ? { ...s, status: "error", message: msg } : s,
          ),
        );
      }
    }

    await fetchLibrary();
    await fetchStorageUsage();
    setImporting(false);
    setImportDone(true);
  }, [
    scanned,
    selected,
    selectedFiles.length,
    wouldExceed,
    uploadPdf,
    fetchLibrary,
    fetchStorageUsage,
  ]);

  const handleClose = useCallback(() => {
    if (importing) return;
    onClose();
  }, [importing, onClose]);

  if (!open) return null;

  const successCount = scanned.filter((s) => s.status === "done").length;
  const skippedCount = scanned.filter((s) => s.status === "skipped").length;
  const errorCount = scanned.filter((s) => s.status === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Scan device for books
          </h2>
          <button
            onClick={handleClose}
            disabled={importing}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {scanned.length === 0 ? (
            <div
              onClick={isScanning ? undefined : triggerScan}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-glass-border p-10 transition-colors hover:border-accent-purple/50",
                isScanning && "cursor-wait",
              )}
            >
              <FolderSearch size={32} className="text-text-muted" />
              <p className="text-sm text-text-primary">
                Pick a folder to scan for PDFs
              </p>
              <p className="text-center text-xs text-text-muted">
                Your browser will list every PDF found inside the folder (and
                its subfolders). Nothing is uploaded until you confirm.
              </p>
              {scanError && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
                  {scanError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Selection summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
                <div>
                  Found <strong>{scanned.length}</strong>{" "}
                  {scanned.length === 1 ? "file" : "files"} ·{" "}
                  <strong>{selected.size}</strong> selected (
                  {formatBytes(selectedBytes)})
                </div>
                {!importing && !importDone && (
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={selectAll}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Select all
                    </button>
                    <button
                      onClick={selectNone}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Select none
                    </button>
                    <button
                      onClick={triggerScan}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Rescan
                    </button>
                  </div>
                )}
              </div>

              {/* Storage warning */}
              {wouldExceed && !importing && !importDone && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <p className="text-xs text-red-400">
                    The selected files exceed your remaining storage (
                    {storageUsage ? formatBytes(remainingBytes) : "—"} left).
                    Uncheck some files or upgrade to Premium.
                  </p>
                </div>
              )}

              {/* Storage bar */}
              {storageUsage && (
                <StorageUsageBar
                  usedBytes={storageUsage.usedBytes}
                  limitBytes={storageUsage.limitBytes}
                  tier={storageUsage.tier}
                />
              )}

              {/* File list */}
              <ul className="divide-y divide-glass-border overflow-hidden rounded-lg border border-glass-border">
                {scanned.map((item) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                        item.status === "done" && "bg-green-500/5",
                        item.status === "error" && "bg-red-500/5",
                        item.status === "skipped" && "bg-amber-500/5",
                      )}
                    >
                      {!importing && !importDone && (
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleOne(item.id)}
                        />
                      )}
                      <FileText
                        size={16}
                        className="shrink-0 text-accent-purple"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-text-primary">
                          {item.file.name}
                        </p>
                        <p className="truncate text-xs text-text-muted">
                          {item.relativePath} · {formatBytes(item.file.size)}
                        </p>
                      </div>
                      <StatusBadge item={item} />
                    </li>
                  );
                })}
              </ul>

              {/* Import summary after run */}
              {importDone && (
                <div className="rounded-lg border border-glass-border bg-glass-bg/50 p-3 text-sm">
                  <p className="text-text-primary">
                    Imported <strong>{successCount}</strong>, skipped{" "}
                    <strong>{skippedCount}</strong> (already in library),
                    failed <strong>{errorCount}</strong>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-glass-border p-4">
          {importDone ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={handleClose}
                disabled={importing}
              >
                Cancel
              </Button>
              {scanned.length > 0 && (
                <Button
                  onClick={startImport}
                  disabled={
                    importing || selected.size === 0 || wouldExceed
                  }
                >
                  {importing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Import {selected.size}{" "}
                      {selected.size === 1 ? "file" : "files"}
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Hidden directory input */}
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error: `webkitdirectory` is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
    </div>
  );
}

function StatusBadge({ item }: { item: ScannedFile }) {
  switch (item.status) {
    case "uploading":
      return (
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          Uploading
        </span>
      );
    case "done":
      return (
        <span className="flex items-center gap-1 text-xs text-green-400">
          <Check size={12} />
          Imported
        </span>
      );
    case "skipped":
      return (
        <span
          className="text-xs text-amber-400"
          title={item.message}
        >
          Skipped
        </span>
      );
    case "error":
      return (
        <span
          className="flex items-center gap-1 text-xs text-red-400"
          title={item.message}
        >
          <AlertTriangle size={12} />
          Failed
        </span>
      );
    default:
      return null;
  }
}
