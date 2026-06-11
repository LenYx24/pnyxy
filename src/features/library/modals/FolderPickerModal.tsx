import { useState } from "react";
import { X, Folder, Home } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Folder as FolderType } from "@/types/database";

interface FolderPickerModalProps {
  open: boolean;
  folders: FolderType[];
  currentFolderId: string | null;
  onClose: () => void;
  onSelect: (folderId: string | null) => void;
}

export function FolderPickerModal({
  open,
  folders,
  currentFolderId,
  onClose,
  onSelect,
}: FolderPickerModalProps) {
  const [selected, setSelected] = useState<string | null>(currentFolderId);

  if (!open) return null;

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const children = folders.filter((f) => f.parent_id === parentId);
    if (children.length === 0) return null;
    return children.map((folder) => (
      <div key={folder.id}>
        <button
          onClick={() => setSelected(folder.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer",
            selected === folder.id
              ? "bg-accent/15 text-accent"
              : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
          )}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <Folder size={16} />
          {folder.name}
        </button>
        {renderTree(folder.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Move to Folder
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Folder tree */}
        <div className="max-h-64 overflow-y-auto p-3">
          {/* Root option */}
          <button
            onClick={() => setSelected(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer",
              selected === null
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <Home size={16} />
            Root (no folder)
          </button>

          {renderTree(null, 0)}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-glass-border p-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSelect(selected)}>Move</Button>
        </div>
      </div>
    </div>
  );
}
