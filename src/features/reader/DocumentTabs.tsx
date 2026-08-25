import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, X } from "lucide-react";
import { useReaderStore } from "@/stores/reader-store";
import { unregisterFile } from "@/lib/file-store";
import { cn } from "@/lib/cn";

/**
 * Top tab bar shown when 2+ documents are open in the reader. Each tab
 * switches the active document; the X closes the document. Hidden
 * automatically when only one (or zero) documents are open.
 */
export function DocumentTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const documents = useReaderStore((s) => s.documents);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const setActiveDocument = useReaderStore((s) => s.setActiveDocument);
  const removeDocument = useReaderStore((s) => s.removeDocument);

  const entries = Array.from(documents.entries());
  if (entries.length < 2) return null;

  const handleClose = (id: string) => {
    const remaining = entries.filter(([eid]) => eid !== id);
    removeDocument(id);
    unregisterFile(id);
    if (id === activeDocumentId) {
      const next = remaining[0]?.[0] ?? null;
      if (next) {
        setActiveDocument(next);
        navigate(`/reader/${next}`, { replace: true });
      } else {
        navigate("/reader", { replace: true });
      }
    }
  };

  const handleSelect = (id: string) => {
    setActiveDocument(id);
    navigate(`/reader/${id}`, { replace: true });
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-glass-border bg-bg-secondary/40 px-2 py-1">
      {entries.map(([id, doc]) => {
        const isActive = id === activeDocumentId;
        const title = doc.meta?.title ?? t("reader.tabs.untitled");
        return (
          <div
            key={id}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-bg-tertiary text-text-primary"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <button
              onClick={() => handleSelect(id)}
              className="flex max-w-[200px] items-center gap-1.5 cursor-pointer"
              title={title}
            >
              <FileText size={12} className="shrink-0" />
              <span className="truncate">{title}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose(id);
              }}
              aria-label={t("reader.tabs.close")}
              title={t("reader.tabs.close")}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded text-current opacity-50 transition-opacity hover:bg-glass-hover hover:opacity-100 cursor-pointer",
                isActive && "opacity-80",
              )}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
