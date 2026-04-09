export interface Shortcut {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description?: string;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

const shortcuts = new Map<string, Shortcut>();
let listenerAttached = false;

function handleKeyDown(e: KeyboardEvent) {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    // Allow Escape to blur inputs, but skip everything else
    if (e.key !== "Escape") return;
  }

  for (const shortcut of shortcuts.values()) {
    const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
    const shiftMatch = !!shortcut.shift === e.shiftKey;
    const altMatch = !!shortcut.alt === e.altKey;
    const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

    if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
      if (shortcut.preventDefault !== false) {
        e.preventDefault();
      }
      shortcut.handler(e);
      return;
    }
  }
}

function ensureListener() {
  if (!listenerAttached) {
    window.addEventListener("keydown", handleKeyDown);
    listenerAttached = true;
  }
}

export function registerShortcut(shortcut: Shortcut) {
  ensureListener();
  shortcuts.set(shortcut.id, shortcut);
}

export function unregisterShortcut(id: string) {
  shortcuts.delete(id);
}

export function getRegisteredShortcuts(): Map<string, Shortcut> {
  return shortcuts;
}
