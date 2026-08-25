import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Body copy. Pass a string for the simple case or any node for
   *  rich content (e.g. a list of items being deleted). */
  body?: React.ReactNode;
  /** Defaults to t("common.cancel") and t("common.ok"). Override for
   *  destructive actions ("Delete", "Remove from library", …). */
  cancelLabel?: string;
  confirmLabel?: string;
  /** When true, the confirm button uses the danger style (red bg).
   *  Set this for destructive actions; the rest stay accent. */
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Drop-in replacement for `window.confirm`. Same UX shell as the
 * existing inline delete dialogs across the app, backdrop, glass
 * card, two buttons, but reusable. Returns control via callbacks
 * (no Promise) so React state stays the source of truth.
 */
export function ConfirmModal({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  danger = false,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  const { t } = useTranslation();

  // Esc to dismiss. Mirrors the rest of our modal patterns.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative z-10 w-full max-w-sm rounded-page bg-bg-tertiary p-6 shadow-page"
      >
        <h3
          id="confirm-modal-title"
          className="mb-2 text-lg font-semibold text-text-primary"
        >
          {title}
        </h3>
        {body && (
          <div className="mb-4 text-sm text-text-muted">
            {typeof body === "string" ? <p>{body}</p> : body}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={cn(
              "cursor-pointer rounded-control px-4 py-2 text-sm font-medium transition-colors",
              danger
                ? "bg-danger/20 text-danger hover:bg-danger/30"
                : "bg-text-primary font-semibold text-bg-primary hover:opacity-90",
            )}
          >
            {confirmLabel ?? t("common.ok")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
