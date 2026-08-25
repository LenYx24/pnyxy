import { FolderInput, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "@/components/ui";

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
      <div className="flex items-center justify-between gap-2 rounded-chip bg-bg-tertiary px-3 py-2 shadow-page sm:justify-start sm:gap-3 sm:px-4">
        <span className="text-sm font-medium text-text-primary whitespace-nowrap">
          {t("library.selection.countSelected", { count })}
        </span>

        <div className="h-4 w-px bg-surface-3" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="gap-1.5 px-3 py-2 text-xs"
            onClick={onMove}
          >
            <FolderInput size={16} strokeWidth={1.5} />
            {t("library.selection.move")}
          </Button>

          <Button
            variant="ghost"
            className="gap-1.5 px-3 py-2 text-xs text-danger hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 size={16} strokeWidth={1.5} />
            {t("library.selection.delete")}
          </Button>
        </div>

        <div className="h-4 w-px bg-surface-3" />

        <IconButton
          size="sm"
          onClick={onClear}
          title={t("library.selection.clear")}
          aria-label={t("library.selection.clear")}
        >
          <X size={16} strokeWidth={1.5} />
        </IconButton>
      </div>
    </div>
  );
}
