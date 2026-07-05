import { useCallback, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui";

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use red confirm-button styling for destructive actions. */
  danger?: boolean;
}

interface UseConfirmReturn {
  /** Resolves `true` if the user confirmed, `false` if they
   *  dismissed (Esc, backdrop, or Cancel). */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Render this somewhere in the component's tree (usually
   *  alongside the page-level fragment) so the modal has a
   *  mount point. */
  ConfirmModalElement: React.ReactElement;
}

/**
 * Promise-based wrapper around the shared `ConfirmModal`. Lets the
 * call site write
 *
 *     if (!(await confirm({ title, danger: true }))) return;
 *
 * instead of hand-rolling open-state, an onConfirm callback, and a
 * separate JSX block per delete action. Each component gets its own
 * hook instance, there's no global queue.
 */
export function useConfirm(): UseConfirmReturn {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  // Holds the pending resolver between confirm() and the user's
  // click. Cleared on resolution so a stray onClose after onConfirm
  // (the ConfirmModal calls both on success) doesn't double-resolve.
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpts(next);
      }),
    [],
  );

  const handleClose = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setOpts(null);
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setOpts(null);
  }, []);

  const ConfirmModalElement = (
    <ConfirmModal
      open={opts !== null}
      title={opts?.title ?? ""}
      body={opts?.body}
      confirmLabel={opts?.confirmLabel}
      cancelLabel={opts?.cancelLabel}
      danger={opts?.danger}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  );

  return { confirm, ConfirmModalElement };
}
