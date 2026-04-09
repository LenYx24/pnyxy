import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
}

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-glass-border bg-glass-bg backdrop-blur-md",
        "transition-colors hover:bg-glass-hover",
        className,
      )}
    >
      {children}
    </div>
  );
}
