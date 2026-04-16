import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useIsDesktop, useIsMobile } from "@/hooks/use-media-query";

interface TopBarProps {
  title?: string;
}

export function TopBar({ title = "Library" }: TopBarProps) {
  const { sidebarCollapsed, setMobileSidebarOpen } = useUIStore();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center justify-between border-b border-glass-border bg-bg-primary/60 px-4 md:px-6 backdrop-blur-xl",
        "transition-all duration-300",
        isDesktop && (sidebarCollapsed ? "ml-sidebar-collapsed" : "ml-sidebar-expanded"),
      )}
    >
      <div className="flex items-center gap-3">
        {/* Hamburger button (tablet only) */}
        {!isDesktop && !isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer touch-target"
          >
            <Menu size={20} />
          </button>
        )}
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
      </div>

      <div className="hidden md:flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5">
          <Search size={16} className="text-text-muted" />
          <span className="text-sm text-text-muted">Search...</span>
        </div>
      </div>
    </header>
  );
}
