import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type ToastType } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
} as const;

const ACCENT: Record<ToastType, string> = {
  error: "border-danger/40 text-danger",
  success: "border-success/40 text-success",
  info: "border-glass-border text-accent",
};

/**
 * Global toast stack. Mounted once at the app root. Non-blocking, stacks in
 * the bottom-right (bottom-center on mobile), auto-dismisses via the store.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-4">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border bg-bg-secondary/95 px-3 py-2 text-sm shadow-lg backdrop-blur-md",
              ACCENT[toast.type],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 text-text-primary">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
