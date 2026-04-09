import { useEffect } from "react";
import {
  registerShortcut,
  unregisterShortcut,
  type Shortcut,
} from "@/lib/keyboard-shortcuts";

export function useKeyboardShortcut(
  shortcut: Omit<Shortcut, "handler"> & { handler: () => void },
) {
  useEffect(() => {
    registerShortcut(shortcut);
    return () => unregisterShortcut(shortcut.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut.id, shortcut.handler]);
}
