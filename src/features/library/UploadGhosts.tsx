/** In-flight upload ghost rows shown in the library list while files
 *  upload (success auto-dismisses, errors stay with retry/dismiss). */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, FileText, RotateCw, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useUploadStore, type UploadJob } from "@/stores/upload-store";
import { cn } from "@/lib/cn";

/**
 * One row per in-flight upload in the current folder. Successful jobs
 * auto-dismiss 1.5s after landing (the real book card has rendered by then);
 * errored ones stay until dismissed or retried.
 */
export function UploadGhostStrip({
  currentFolderId,
}: {
  currentFolderId: string | null;
}) {
  const uploads = useUploadStore((s) => s.uploads);
  const dismissUpload = useUploadStore((s) => s.dismissUpload);
  const retryUpload = useUploadStore((s) => s.retryUpload);
  const cancelUpload = useUploadStore((s) => s.cancelUpload);

  const visible = useMemo(() => {
    const out: UploadJob[] = [];
    for (const job of uploads.values()) {
      if ((job.folderId ?? null) === currentFolderId) out.push(job);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [uploads, currentFolderId]);

  // auto-dismiss successful jobs after a short delay; per-id timers avoid double-scheduling
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const job of visible) {
      if (job.status === "success") {
        timers.push(setTimeout(() => dismissUpload(job.id), 1500));
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [visible, dismissUpload]);

  if (visible.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {visible.map((job) => (
        <UploadGhostRow
          key={job.id}
          job={job}
          onDismiss={() => dismissUpload(job.id)}
          onRetry={() => retryUpload(job.id)}
          onCancel={() => cancelUpload(job.id)}
        />
      ))}
    </div>
  );
}

function UploadGhostRow({
  job,
  onDismiss,
  onRetry,
  onCancel,
}: {
  job: UploadJob;
  onDismiss: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isError = job.status === "error";
  const isSuccess = job.status === "success";
  const isUploading = job.status === "uploading";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-panel bg-bg-tertiary px-3 py-2 transition-colors",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-control",
          isError
            ? "bg-danger/15 text-danger"
            : isSuccess
              ? "bg-success/15 text-success"
              : "bg-surface-3 text-text-secondary",
        )}
      >
        {isError ? (
          <AlertTriangle size={16} strokeWidth={1.5} />
        ) : isSuccess ? (
          <Check size={16} strokeWidth={1.5} />
        ) : (
          <FileText size={16} strokeWidth={1.5} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{job.fileName}</p>
        {/* Progress bar (uploading) / status text (success/error). */}
        {job.status === "uploading" ? (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-text-secondary transition-[width] duration-200"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        ) : isError ? (
          <p className="truncate text-2xs text-danger">
            {job.error ?? t("library.upload.failed")}
          </p>
        ) : (
          <p className="text-2xs text-success">
            {t("library.upload.success")}
          </p>
        )}
      </div>
      {/* cancel an in-flight upload; aborts the transfer and drops the row */}
      {isUploading && (
        <IconButton
          size="sm"
          type="button"
          onClick={onCancel}
          title={t("library.upload.cancel")}
          aria-label={t("library.upload.cancel")}
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      {isError && (
        <IconButton
          size="sm"
          type="button"
          onClick={onRetry}
          title={t("library.upload.retry")}
          aria-label={t("library.upload.retry")}
        >
          <RotateCw size={16} strokeWidth={1.5} />
        </IconButton>
      )}
      {(isError || isSuccess) && (
        <IconButton
          size="sm"
          type="button"
          onClick={onDismiss}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      )}
    </div>
  );
}
