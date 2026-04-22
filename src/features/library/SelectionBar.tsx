import { FolderInput, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";

interface SelectionBarProps {
  count: number;
  onMove: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, onMove, onDelete, onClear }: SelectionBarProps) {
  const { t } = useTranslation();
  if (count === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 px-3 pb-3 sm:bottom-6 sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 sm:px-0 sm:pb-0"
      style={{ animation: "slide-up 0.2s ease-out" }}
    >
      <div className="flex items-center justify-between gap-2 rounded-xl border border-glass-border bg-bg-secondary/95 px-3 py-2.5 shadow-xl shadow-black/30 backdrop-blur-xl sm:justify-start sm:gap-3 sm:px-4">
        <span className="text-sm font-medium text-text-primary whitespace-nowrap">
          {t("library.selection.countSelected", { count })}
        </span>

        <div className="h-4 w-px bg-glass-border" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="gap-1.5 px-3 py-2 text-xs"
            onClick={onMove}
          >
            <FolderInput size={14} />
            {t("library.selection.move")}
          </Button>

          <Button
            variant="ghost"
            className="gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300"
            onClick={onDelete}
          >
            <Trash2 size={14} />
            {t("library.selection.delete")}
          </Button>
        </div>

        <div className="h-4 w-px bg-glass-border" />

        <button
          onClick={onClear}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
          title={t("library.selection.clear")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
