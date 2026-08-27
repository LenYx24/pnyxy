import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { X, Link as LinkIcon, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { modalBackdropClass, modalSurfaceClass } from "@/components/ui/classes";
import { logError } from "@/lib/logger";
import { useResourceStore } from "@/stores/resource-store";

interface AddResourceModalProps {
  open: boolean;
  onClose: () => void;
  /** Folder the new resource lands in (the folder the user is currently viewing). */
  folderId: string | null;
  /** Pre-filled URL (a link pasted onto the library page). */
  initialUrl?: string;
}

/**
 * Small URL-input modal for the "Resource (beta)" library item type. Saves a
 * web page / YouTube link via the resource store, then navigates to the
 * resource viewer. Mirrors the OpenFromUrlModal shell.
 */
export function AddResourceModal({
  open,
  onClose,
  folderId,
  initialUrl = "",
}: AddResourceModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createResource = useResourceStore((s) => s.createResource);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + autofocus when opened.
  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setError(null);
    setLoading(false);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, initialUrl]);

  // Esc to close (when not actively loading).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      try {
        const id = await createResource({ url: trimmed, folderId });
        onClose();
        if (id) navigate(`/resources/${id}`);
      } catch (err) {
        logError("library:addResource", err);
        setError(
          err instanceof Error ? err.message : t("library.resource.addError"),
        );
      } finally {
        setLoading(false);
      }
    },
    [url, folderId, createResource, onClose, navigate, t],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 ${modalBackdropClass}`}
        onClick={loading ? undefined : onClose}
      />
      <div className={`relative z-10 w-full max-w-md ${modalSurfaceClass}`}>
        <div className="flex items-center justify-between p-4 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-control bg-surface-3">
              <LinkIcon
                size={16}
                strokeWidth={1.5}
                className="text-text-secondary"
              />
            </div>
            <h2 className="font-display text-lg font-semibold text-text-primary">
              {t("library.resource.addTitle")}
            </h2>
            <span className="rounded-chip bg-surface-3 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
              {t("library.resource.beta")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-control p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <p className="text-xs text-text-muted">
            {t("library.resource.addHint")}
          </p>

          <div>
            <label
              htmlFor="resource-url-input"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("library.resource.urlLabel")}
            </label>
            <input
              id="resource-url-input"
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              disabled={loading}
              className="field disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("library.resource.saving")}
                </>
              ) : (
                <>
                  <LinkIcon size={16} />
                  {t("library.resource.save")}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
