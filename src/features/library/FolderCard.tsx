import { useState, useRef, useEffect } from "react";
import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { GlassCard } from "@/components/ui";
import type { Folder as FolderType } from "@/types/database";

interface FolderCardProps {
  folder: FolderType;
  onNavigate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function FolderCard({ folder, onNavigate, onRename, onDelete }: FolderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <GlassCard className="relative cursor-pointer overflow-hidden" onClick={() => onNavigate(folder.id)}>
      <div className="flex h-48 flex-col items-center justify-center gap-2">
        <Folder size={48} className="text-accent-purple/60" />
        <p className="max-w-full truncate px-4 text-sm font-medium text-text-primary">
          {folder.name}
        </p>
      </div>

      {/* 3-dot menu */}
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-lg p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <MoreVertical size={16} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                const name = prompt("Rename folder:", folder.name);
                if (name && name.trim()) onRename(folder.id, name.trim());
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Pencil size={14} />
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(folder.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
