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
        "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
        active
          ? "bg-accent/15 text-accent"
          : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
      )}
    >
      {category.name}
    </button>
  );
}
