import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  size?: "sm" | "md" | "lg";
  /** Drag handle in the bottom-right corner; the chosen width/height is
   *  remembered in localStorage under this key. The body scrolls as a
   *  whole (header + footer stay put). */
  resizeStorageKey?: string;
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
  resizeStorageKey,
  onSubmit,
  submitLabel,
  submitting = false,
  submitDisabled = false,
}: FormModalProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(() => {
    if (!resizeStorageKey) return null;
    try {
      const raw = localStorage.getItem(resizeStorageKey);
      const parsed = raw ? (JSON.parse(raw) as { w?: number; h?: number }) : null;
      return parsed && parsed.w && parsed.h ? { w: parsed.w, h: parsed.h } : null;
    } catch {
      return null;
    }
  });
  // corner drag: track the pointer, clamp to the viewport, persist on release
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = formRef.current;
      if (!el) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = el.offsetWidth;
      const startH = el.offsetHeight;
      let last = { w: startW, h: startH };
      const onMove = (ev: PointerEvent) => {
        const w = Math.min(window.innerWidth - 32, Math.max(360, startW + (ev.clientX - startX)));
        const h = Math.min(window.innerHeight - 32, Math.max(240, startH + (ev.clientY - startY)));
        last = { w, h };
        setDims(last);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (resizeStorageKey) {
          try {
            localStorage.setItem(resizeStorageKey, JSON.stringify(last));
          } catch {
            /* storage unavailable */
          }
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [resizeStorageKey],
  );
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
        style={
          resizeStorageKey && dims
            ? { width: dims.w, height: dims.h, maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100vh - 2rem)" }
            : undefined
        }
        className={cn(
          "relative z-10 w-full p-6",
          size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-md",
          resizeStorageKey && "flex max-h-[calc(100vh-2rem)] flex-col",
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

        <div className={cn("space-y-4", resizeStorageKey && "menu-scroll -mx-2 min-h-0 flex-1 overflow-y-auto px-2")}>{children}</div>

        {resizeStorageKey && (
          <div
            onPointerDown={onResizeStart}
            title={t("common.resize")}
            aria-label={t("common.resize")}
            role="separator"
            className="absolute bottom-1.5 right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm opacity-50 hover:opacity-100"
            style={{
              backgroundImage:
                "linear-gradient(135deg, transparent 0 55%, var(--color-text-muted-2) 55% 65%, transparent 65% 80%, var(--color-text-muted-2) 80% 90%, transparent 90%)",
            }}
          />
        )}

        <div className={cn("flex justify-end gap-2", resizeStorageKey ? "mt-3" : "mt-5")}>
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
