import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { useBackToClose } from "@/hooks/use-back-to-close";

interface PromptModalProps {
  open: boolean;
  title: string;
  /** Optional body copy shown above the input — context for the user. */
  body?: React.ReactNode;
  /** Pre-fill the input. Use this for rename flows. */
  defaultValue?: string;
  placeholder?: string;
  /** Defaults to t("common.cancel") and t("common.save"). */
  cancelLabel?: string;
  confirmLabel?: string;
  /** Pass any non-empty string check or async validation; return a
   *  string error to block submission. Empty input is rejected
   *  automatically. */
  validate?: (value: string) => string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

/**
 * Drop-in replacement for `window.prompt`. Same vibe as ConfirmModal:
 * portal-rendered glass card, Esc closes, Enter submits. The text
 * input is auto-focused on open and pre-filled for rename flows.
 */
export function PromptModal({
  open,
  title,
  body,
  defaultValue = "",
  placeholder,
  cancelLabel,
  confirmLabel,
  validate,
  onClose,
  onSubmit,
}: PromptModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset whenever the modal opens — the same instance is re-used
  // for many flows (rename folder A, rename folder B), so without
  // this the second open would still show the first folder's name.
  // Using the "set state during render with a guard" pattern from
  // the React docs instead of useEffect avoids the
  // react-hooks/set-state-in-effect lint while still resetting
  // before the next paint.
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setValue(defaultValue);
      setError(null);
    }
  }

  // Focus + select-all so a rename flow lets the user just start
  // typing to overwrite. Layout effect avoids a one-frame flicker.
  useLayoutEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Android hardware back / system back gesture closes the prompt.
  useBackToClose(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("common.requiredField"));
      return;
    }
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }
    onSubmit(trimmed);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl"
      >
        <h3
          id="prompt-modal-title"
          className="mb-2 text-lg font-semibold text-text-primary"
        >
          {title}
        </h3>
        {body && (
          <div className="mb-3 text-sm text-text-muted">
            {typeof body === "string" ? <p>{body}</p> : body}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className="mb-1 w-full rounded-md border border-glass-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent-purple"
        />
        {error && (
          <p className="mb-2 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-accent-purple/20 px-4 py-2 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/30"
          >
            {confirmLabel ?? t("common.save")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
