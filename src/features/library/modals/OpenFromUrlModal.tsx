import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { X, Link as LinkIcon, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { fetchUrlAsFile, UrlFetchError } from "@/lib/url-to-file";

interface OpenFromUrlModalProps {
  open: boolean;
  onClose: () => void;
  /** Called once the URL has been fetched and converted to a File.
   * The caller decides whether to upload (signed-in PDF) or just open
   * locally, same dispatch used by the drag-drop import path. */
  onFile: (file: File) => Promise<void> | void;
}

export function OpenFromUrlModal({ open, onClose, onFile }: OpenFromUrlModalProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + autofocus when opened.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
    setLoading(false);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

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
        const file = await fetchUrlAsFile(trimmed);
        await onFile(file);
        onClose();
      } catch (err) {
        if (err instanceof UrlFetchError) {
          setError(err.message);
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Something went wrong loading that URL.",
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [url, onFile, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <LinkIcon size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              Open from URL
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <p className="text-xs text-text-muted">
            Paste a direct link to a PDF, EPUB, TXT, or Markdown file.
            Local files (<code className="rounded bg-glass-bg px-1 py-0.5 text-2xs">file://</code>) can't be opened by URL,
            drag them onto the library or use Upload instead.
          </p>

          <div>
            <label
              htmlFor="url-input"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              File URL
            </label>
            <input
              id="url-input"
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/paper.pdf"
              disabled={loading}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
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
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !url.trim()}>
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <LinkIcon size={16} />
                  Open
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
