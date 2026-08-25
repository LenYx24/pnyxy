import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function GlassCard({ children, className, onClick }: GlassCardProps) {
  return (
    <div
      className={cn(
        // panel: surface-2, no border, 16 px radius (UI v2)
        "rounded-panel bg-bg-tertiary",
        "transition-colors hover:bg-surface-3",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
