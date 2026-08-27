import {
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { modalBackdropClass, modalSurfaceClass } from "./classes";
import { cn } from "@/lib/cn";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small icon shown next to the title, same badge as the app's other
   *  icon + heading pairs. */
  icon?: LucideIcon;
  children: ReactNode;
  /** Override the whole footer row. Omit for the default Cancel +
   *  submit pair. */
  footer?: ReactNode;
  size?: "sm" | "md";
  /** Default footer's submit button. Omitted -> no submit button
   *  renders (Cancel-only footer). */
  onSubmit?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
}

/**
 * Shared shell for every "small form in a modal" flow (add term, add
 * content, rename section, join with code, …). Same portal / backdrop /
 * Escape conventions as ConfirmModal and PromptModal, plus a minimal
 * focus trap and native Enter-to-submit (a single-line input submits
 * the form, a textarea just gets a newline).
 */
export function FormModal({
  open,
  onClose,
  title,
  icon: Icon,
  children,
  footer,
  size = "md",
  onSubmit,
  submitLabel,
  submitting = false,
  submitDisabled = false,
}: FormModalProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus the first focusable field on open, restore whatever had focus
  // before the modal opened once it closes/unmounts.
  useLayoutEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = formRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Escape closes; Tab/Shift+Tab wraps inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const container = formRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onSubmit?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={cn("absolute inset-0", modalBackdropClass)} onClick={onClose} />
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
        onSubmit={handleSubmit}
        className={cn(
          "relative z-10 w-full p-6",
          size === "sm" ? "max-w-sm" : "max-w-md",
          modalSurfaceClass,
        )}
      >
        <div className="mb-4 flex items-center gap-2.5">
          {Icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent/15 text-accent">
              <Icon size={16} strokeWidth={1.5} />
            </span>
          )}
          <h2 id="form-modal-title" className="text-lg font-semibold text-text-primary">
            {title}
          </h2>
        </div>

        <div className="space-y-4">{children}</div>

        <div className="mt-5 flex justify-end gap-2">
          {footer ?? (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                {t("common.cancel")}
              </Button>
              {onSubmit && (
                <Button type="submit" loading={submitting} disabled={submitDisabled}>
                  {submitLabel ?? t("common.save")}
                </Button>
              )}
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
