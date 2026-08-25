import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";

const URL_RE = /^https?:\/\/\S+$/i;

interface LibraryDropZoneProps {
  /** Click fallback: opens the file picker. */
  onPickFiles: () => void;
  /** A single http(s) URL was pasted anywhere on the page (outside an
   *  input); opens the add-link flow with it. */
  onPasteUrl: (url: string) => void;
}

/**
 * Dashed "drop a PDF or paste a link" box under the file list. File
 * drops are handled by the page-wide drag handlers on LibraryPage (this
 * box sits inside that area), so the zone only adds the click fallback
 * and the paste listener.
 */
export function LibraryDropZone({ onPickFiles, onPasteUrl }: LibraryDropZoneProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, [contenteditable=''], [contenteditable='true']") ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (!text || !URL_RE.test(text)) return;
      e.preventDefault();
      onPasteUrl(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onPasteUrl]);

  return (
    <button
      type="button"
      onClick={onPickFiles}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-glass-border p-4 text-center text-[13px] text-text-muted transition-colors hover:border-accent/50 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <Upload size={18} strokeWidth={1.75} />
      {t("library.list.dropZone")}
    </button>
  );
}
