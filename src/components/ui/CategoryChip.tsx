import { cn } from "@/lib/cn";
import type { Category } from "@/types/database";

interface CategoryChipProps {
  category: Category;
  active?: boolean;
  onClick?: () => void;
}

export function CategoryChip({ category, active = false, onClick }: CategoryChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "chip font-medium transition-colors cursor-pointer",
        active
          ? "chip-active"
          : "text-text-muted hover:bg-surface-3 hover:text-text-primary",
      )}
    >
      {category.name}
    </button>
  );
}
