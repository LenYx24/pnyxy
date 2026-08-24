import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Upload, FileText, AlertTriangle, Files, Folder } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUploadStore } from "@/stores/upload-store";
import { useLibraryStore } from "@/stores/library-store";
import { fileExtension, logUploadAttempt } from "@/lib/upload-telemetry";
import { StorageUsageBar } from "../StorageUsageBar";

interface UploadPdfModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-stage these files when opened (e.g. a >10-file pick routed here
   *  for review instead of uploading silently). */
  initialFiles?: File[];
}

/** Hard cap on how many files a single staging session can hold, so a
 *  stray "select my whole drive" folder pick can't lock up the tab. */
const MAX_FILES = 1000;

/** How many folder levels below the picked root we descend. A file at
 *  `Root/file.pdf` is depth 0, `Root/Sub/file.pdf` is depth 1. Anything
 *  deeper is skipped for now (we may raise this later). */
const MAX_SUBFOLDER_DEPTH = 1;

interface StagedFile {
  /** Dedupe key, same file picked twice (or via folder + files) collapses. */
  key: string;
  file: File;
  /** Slash-separated folder path the book should land in, relative to the
   *  current library folder. Empty string = no folder (current folder). */
  dirPath: string;
}

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function stagedKey(dirPath: string, file: File): string {
  return `${dirPath}::${file.name}::${file.size}::${file.lastModified}`;
}

/**
 * Pick PDFs to upload, one file, several files, or a whole folder.
 *
 * Folders are scanned one level deep (see MAX_SUBFOLDER_DEPTH) and the
 * directory structure is recreated in the library: the picked folder
 * and its immediate subfolders become library folders, and each book
 * lands in the matching one. The actual byte upload runs in the
 * background via the upload store, on Upload we create the folders,
 * enqueue every file, and close immediately; per-file progress shows
 * on ghost cards in the library grid.
 */
export function UploadPdfModal({
  open,
  onClose,
  initialFiles,
}: UploadPdfModalProps) {
  const { t } = useTranslation();
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Extensions of explicitly-picked non-PDF files, shown under the drop
  // zone. Cleared on the next pick or on close.
  const [rejectedExts, setRejectedExts] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const enqueueUpload = useUploadStore((s) => s.enqueueUpload);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);
  const createFolderPath = useLibraryStore((s) => s.createFolderPath);

  useEffect(() => {
    if (open) {
      fetchStorageUsage();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local state when the modal is opened
      setStaged([]);
      setRejectedExts([]);
      setNotice(null);
    }
  }, [open, fetchStorageUsage]);

  // Merge new items into the staging list, de-duping by key and capping
  // at MAX_FILES. Returns whether the cap was hit so callers can notify.
  const addStaged = useCallback((additions: StagedFile[]): boolean => {
    let limitHit = false;
    setStaged((prev) => {
      const seen = new Set(prev.map((s) => s.key));
      const next = [...prev];
      for (const item of additions) {
        if (seen.has(item.key)) continue;
        if (next.length >= MAX_FILES) {
          limitHit = true;
          break;
        }
        seen.add(item.key);
        next.push(item);
      }
      return next;
    });
    return limitHit;
  }, []);

  // Explicit multi-file pick (or drag-drop): no folder structure. Every
  // non-PDF is surfaced under the drop zone since the user chose it.
  const ingestFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const rejected = new Set<string>();
      const additions: StagedFile[] = [];
      for (const file of Array.from(files)) {
        if (!isPdf(file)) {
          void logUploadAttempt({
            file,
            status: "rejected_unsupported_format",
          });
          rejected.add(fileExtension(file.name) || "?");
          continue;
        }
        additions.push({ key: stagedKey("", file), file, dirPath: "" });
      }
      setRejectedExts(rejected.size > 0 ? [...rejected] : []);
      const limitHit = addStaged(additions);
      if (limitHit) {
        setNotice(t("library.uploadModal.limitReached", { limit: MAX_FILES }));
      } else if (additions.length > 0) {
        setNotice(null);
      }
    },
    [addStaged, t],
  );

  // Pre-stage files handed in when the modal is opened (runs after the
  // open-reset effect above, so it isn't cleared).
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      ingestFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Folder pick: keep the structure, descend MAX_SUBFOLDER_DEPTH levels.
  // Non-PDFs are skipped silently, a folder scan routinely turns up
  // images, sidecar files, etc. that aren't a "format request" signal.
  const ingestFolder = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const additions: StagedFile[] = [];
      for (const file of Array.from(files)) {
        if (!isPdf(file)) continue;
        const rel =
          (file as File & { webkitRelativePath?: string })
            .webkitRelativePath || file.name;
        const segments = rel.split("/").filter(Boolean);
        // segments = [root, ...subdirs, fileName]. Subfolder depth below
        // the picked root is segments.length - 2.
        if (segments.length - 2 > MAX_SUBFOLDER_DEPTH) continue;
        const dirPath = segments.slice(0, -1).join("/");
        additions.push({ key: stagedKey(dirPath, file), file, dirPath });
      }
      setRejectedExts([]);
      if (additions.length === 0) {
        setNotice(t("library.uploadModal.noPdfsInFolder"));
        return;
      }
      const limitHit = addStaged(additions);
      setNotice(
        limitHit
          ? t("library.uploadModal.limitReached", { limit: MAX_FILES })
          : null,
      );
    },
    [addStaged, t],
  );

  const handleFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      ingestFiles(e.target.files);
      e.target.value = "";
    },
    [ingestFiles],
  );

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      ingestFolder(e.target.files);
      e.target.value = "";
    },
    [ingestFolder],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      // Stop the drop from also bubbling (through the React tree, even
      // from this portaled modal) to the library page's global onDrop,
      // which would enqueue the same files a second time.
      e.stopPropagation();
      setDragOver(false);
      ingestFiles(e.dataTransfer.files);
    },
    [ingestFiles],
  );

  const removeStaged = useCallback((key: string) => {
    setStaged((prev) => prev.filter((s) => s.key !== key));
  }, []);

  const totalBytes = staged.reduce((sum, s) => sum + s.file.size, 0);
  const wouldExceed =
    storageUsage !== null &&
    staged.length > 0 &&
    storageUsage.usedBytes + totalBytes > storageUsage.limitBytes;

  const handleUpload = useCallback(async () => {
    if (staged.length === 0 || wouldExceed) return;

    // Create each distinct folder path once, relative to the folder the
    // user is currently viewing. createFolderPath reuses existing
    // siblings, so re-uploading into the same tree won't duplicate
    // folders. On failure (e.g. profanity gate) fall back to the
    // current folder rather than dropping the whole batch.
    const uniqueDirs = [
      ...new Set(staged.map((s) => s.dirPath).filter((d) => d.length > 0)),
    ];
    const dirToFolderId = new Map<string, string | null>();
    for (const dir of uniqueDirs) {
      try {
        const folder = await createFolderPath(dir, currentFolderId);
        dirToFolderId.set(dir, folder?.id ?? currentFolderId);
      } catch {
        dirToFolderId.set(dir, currentFolderId);
      }
    }

    for (const item of staged) {
      const folderId = item.dirPath
        ? (dirToFolderId.get(item.dirPath) ?? currentFolderId)
        : currentFolderId;
      enqueueUpload(item.file, folderId);
    }

    setStaged([]);
    onClose();
  }, [staged, wouldExceed, createFolderPath, currentFolderId, enqueueUpload, onClose]);

  const handleClose = () => {
    setStaged([]);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-glass-border p-4">
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {staged.length === 0 ? (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
                  dragOver
                    ? "border-accent bg-accent/10"
                    : "border-glass-border",
                )}
              >
                <Upload size={32} className="text-text-muted" />
                <p className="text-center text-sm text-text-primary">
                  {t("library.uploadModal.dropZone")}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Files size={16} />
                    {t("library.uploadModal.chooseFiles")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => folderInputRef.current?.click()}
                  >
                    <Folder size={16} />
                    {t("library.uploadModal.chooseFolder")}
                  </Button>
                </div>
                <p className="text-xs text-text-muted">
                  {t("library.uploadModal.pdfOnly")}
                </p>
                <p className="text-center text-xs text-text-muted">
                  {t("library.uploadModal.folderHint")}
                </p>
              </div>
              {rejectedExts.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-xs text-warning">
                    {t("library.upload.unsupportedFormat", {
                      formats: rejectedExts.join(", "),
                    })}
                  </p>
                </div>
              )}
              {notice && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-xs text-warning">{notice}</p>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {/* Selection summary + add-more / clear actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-text-secondary">
                  {t("library.uploadModal.selected", {
                    count: staged.length,
                    size: formatBytes(totalBytes),
                  })}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    {t("library.uploadModal.addFiles")}
                  </button>
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    {t("library.uploadModal.addFolder")}
                  </button>
                  <button
                    onClick={() => setStaged([])}
                    className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    {t("library.uploadModal.clear")}
                  </button>
                </div>
              </div>

              {notice && (
                <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-xs text-warning">{notice}</p>
                </div>
              )}

              {/* Storage warning: synchronous pre-check so the user
                  sees this *here*, not on doomed ghost cards. */}
              {wouldExceed && (
                <div className="flex items-start gap-2 rounded-lg bg-danger/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-xs text-danger">
                    {t("library.uploadModal.wouldExceed")}
                  </p>
                </div>
              )}

              {storageUsage && (
                <StorageUsageBar
                  usedBytes={storageUsage.usedBytes}
                  limitBytes={storageUsage.limitBytes}
                  tier={storageUsage.tier}
                />
              )}

              {/* Staged file list */}
              <ul className="overflow-hidden rounded-lg border border-glass-border">
                {staged.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center gap-3 border-b border-glass-border px-3 py-2 last:border-b-0"
                  >
                    <FileText size={18} className="shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">
                        {item.file.name}
                      </p>
                      {item.dirPath && (
                        <p className="truncate text-xs text-text-muted">
                          {item.dirPath}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-text-muted">
                      {formatBytes(item.file.size)}
                    </span>
                    <button
                      onClick={() => removeStaged(item.key)}
                      className="shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        {staged.length > 0 && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-glass-border p-4">
            <Button variant="secondary" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleUpload} disabled={wouldExceed}>
              <Upload size={16} />
              {t("library.uploadModal.uploadCount", { count: staged.length })}
            </Button>
          </div>
        )}

        {/* Widened accept list: the modal still only stages PDFs, but
            exposing the common book formats in the picker lets us log
            what users actually try to add. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.epub,.txt,.md,.markdown,.mobi,.azw,.azw3,.fb2,.docx,.doc,.rtf,.odt,.cbz,.cbr,.djvu"
          className="hidden"
          onChange={handleFilesChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error: `webkitdirectory` is non-standard but widely supported
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={handleFolderChange}
        />
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
