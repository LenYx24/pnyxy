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

/** Optional global filter — when set, only shortcuts whose id passes
 *  the predicate fire. Used by focus-mode to silence navigation
 *  shortcuts while still allowing reading-related ones. */
let shortcutGate: ((id: string) => boolean) | null = null;

export function setShortcutGate(gate: ((id: string) => boolean) | null) {
  shortcutGate = gate;
}

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
      if (shortcutGate && !shortcutGate(shortcut.id)) {
        // Gated out (e.g. focus session active). Still consume the
        // keystroke so default browser actions don't fire either.
        if (shortcut.preventDefault !== false) e.preventDefault();
        return;
      }
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

/** True when running on a Mac; used for ⌘/⇧/⌥ vs Ctrl/Shift/Alt. */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform);
}

/**
 * Render a shortcut as a human-readable string, e.g. `"Ctrl + N"` or
 * on Mac `"⌘ N"`. Used by the Shortcuts settings tab and by inline
 * <Kbd> hints on buttons.
 */
export function formatShortcut(
  shortcut: Pick<Shortcut, "key" | "ctrl" | "shift" | "alt">,
): string {
  const mac = isMac();
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push(mac ? "⌘" : "Ctrl");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift");
  if (shortcut.alt) parts.push(mac ? "⌥" : "Alt");

  const keyName =
    shortcut.key === "\\"
      ? "\\"
      : shortcut.key === "="
        ? "+"
        : shortcut.key === "-"
          ? "-"
          : shortcut.key.startsWith("Arrow")
            ? shortcut.key.replace("Arrow", "")
            : shortcut.key.length === 1
              ? shortcut.key.toUpperCase()
              : shortcut.key;

  parts.push(keyName);
  // Mac glyphs already look like separate elements; skip the " + ".
  return mac ? parts.join(" ") : parts.join(" + ");
}
