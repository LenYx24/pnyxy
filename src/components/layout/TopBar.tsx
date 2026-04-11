import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

interface TopBarProps {
  title?: string;
}

export function TopBar({ title = "Library" }: TopBarProps) {
  const { sidebarCollapsed } = useUIStore();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center justify-between border-b border-glass-border bg-bg-primary/60 px-6 backdrop-blur-xl",
        "transition-all duration-300",
        sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded",
      )}
    >
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5">
          <Search size={16} className="text-text-muted" />
          <span className="text-sm text-text-muted">Search...</span>
        </div>
      </div>
    </header>
  );
}
