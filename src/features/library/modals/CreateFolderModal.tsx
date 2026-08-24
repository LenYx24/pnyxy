import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { X, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void> | void;
  /** Name of the folder the new folder will be created inside (null = library root). */
  parentFolderName?: string | null;
}

export function CreateFolderModal({
  open,
  onClose,
  onCreate,
  parentFolderName,
}: CreateFolderModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setSubmitting(false);
      // Defer focus until after the input has mounted.
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("library.createFolder.nameRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("library.createFolder.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !submitting && onClose()}
      />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <FolderPlus size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.createFolder.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <p className="text-xs text-text-muted">
            {t("library.createFolder.creatingIn")}{" "}
            <span className="font-medium text-text-secondary">
              {parentFolderName ?? t("library.createFolder.root")}
            </span>
          </p>

          <div>
            <label
              htmlFor="new-folder-name"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              {t("library.createFolder.nameLabel")}
            </label>
            <input
              id="new-folder-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("library.createFolder.namePlaceholder")}
              maxLength={240}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
            />
            <p className="mt-1 text-xs text-text-muted">
              {/* `<slash/>` and `<ex/>` are placeholder elements the
                  translation mustn't touch, Trans swaps them for the
                  real styled <span>s at render time. */}
              <Trans
                i18nKey="library.createFolder.nestedTip"
                components={{
                  slash: (
                    <span className="font-mono text-text-secondary">/</span>
                  ),
                  ex: (
                    <span className="font-mono text-text-secondary">
                      p1/p2/p3
                    </span>
                  ),
                }}
              />
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("library.createFolder.creating")}
                </>
              ) : (
                t("library.createFolder.create")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
