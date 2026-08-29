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

/** Optional global filter, when set, only shortcuts whose id passes
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

  // First registered match wins, except that a screen-scoped shortcut
  // (library:, reader:, chat:) beats a global `app:` one bound to the
  // same keys. Mount order between AppLayout and its route children is
  // not stable across navigations, so the precedence is explicit here.
  let match: Shortcut | null = null;
  for (const shortcut of shortcuts.values()) {
    const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
    const shiftMatch = !!shortcut.shift === e.shiftKey;
    const altMatch = !!shortcut.alt === e.altKey;
    const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
    if (!(ctrlMatch && shiftMatch && altMatch && keyMatch)) continue;
    if (!match) {
      match = shortcut;
    } else if (isGlobalId(match.id) && !isGlobalId(shortcut.id)) {
      match = shortcut;
    }
  }
  if (!match) return;

  if (shortcutGate && !shortcutGate(match.id)) {
    // Gated out (e.g. focus session active). Still consume the
    // keystroke so default browser actions don't fire either.
    if (match.preventDefault !== false) e.preventDefault();
    return;
  }
  if (match.preventDefault !== false) {
    e.preventDefault();
  }
  match.handler(e);
}

function isGlobalId(id: string): boolean {
  return id.startsWith("app:");
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
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform);
}

export type ShortcutSpec = Pick<Shortcut, "key" | "ctrl" | "shift" | "alt">;

/**
 * The individual chips of a shortcut ("Ctrl", "Shift", "O"), used by
 * <Kbd> chip rendering. `formatShortcut` joins these into one string.
 */
export function shortcutParts(shortcut: ShortcutSpec): string[] {
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
          : shortcut.key === " "
            ? "Space"
            : shortcut.key.startsWith("Arrow")
              ? shortcut.key.replace("Arrow", "")
              : shortcut.key.length === 1
                ? shortcut.key.toUpperCase()
                : shortcut.key;
  parts.push(keyName);
  return parts;
}

export type ShortcutGroup = "global" | "library" | "chat" | "reader";

export interface CatalogEntry extends ShortcutSpec {
  /** Registry id, same string the live registration uses. */
  id: string;
  group: ShortcutGroup;
  /** i18n key under `shortcuts.items`. */
  labelKey: string;
}

/**
 * Static list of every user-facing binding. The live registry only
 * holds what is currently mounted (the reader's bindings are gone once
 * you leave the reader), so the Shortcuts settings tab and the tooltip
 * hints read from this catalog instead. Keep in sync with the
 * `useKeyboardShortcut` calls; ids are the join key.
 */
export const SHORTCUT_CATALOG: CatalogEntry[] = [
  // Global
  { id: "app:command-palette", group: "global", labelKey: "commandPalette", key: "k", ctrl: true },
  { id: "app:open-book", group: "global", labelKey: "openBook", key: "o", ctrl: true },
  { id: "app:new-chat", group: "global", labelKey: "newChat", key: "o", ctrl: true, shift: true },
  { id: "app:quick-ask", group: "global", labelKey: "quickAsk", key: "k", ctrl: true, shift: true },
  { id: "app:open-settings", group: "global", labelKey: "openSettings", key: ",", ctrl: true },
  { id: "app:shortcuts-sheet", group: "global", labelKey: "shortcutsSheet", key: "/", ctrl: true },
  // Library
  { id: "library:upload", group: "library", labelKey: "upload", key: "u", ctrl: true },
  { id: "library:new-folder", group: "library", labelKey: "newFolder", key: "f", ctrl: true, shift: true },
  { id: "library:scan-device", group: "library", labelKey: "scanDevice", key: "d", ctrl: true, shift: true },
  { id: "library:go-up", group: "library", labelKey: "goUp", key: "Backspace", alt: true },
  { id: "library:edit-path", group: "library", labelKey: "editPath", key: "l", ctrl: true, shift: true },
  // Chat
  { id: "chat:new", group: "chat", labelKey: "newChat", key: "o", ctrl: true, shift: true },
  // Reader
  { id: "reader:close-book", group: "reader", labelKey: "closeBook", key: "w", ctrl: true, shift: true },
  { id: "reader:search", group: "reader", labelKey: "search", key: "f", ctrl: true },
  { id: "reader:replace", group: "reader", labelKey: "replace", key: "h", ctrl: true },
  { id: "reader:go-to-page", group: "reader", labelKey: "goToPage", key: "g", ctrl: true },
  { id: "reader:toggle-toc", group: "reader", labelKey: "toggleToc", key: "\\", ctrl: true },
  { id: "reader:toggle-ai-chat", group: "reader", labelKey: "toggleAiChat", key: "i", ctrl: true },
  { id: "reader:toggle-comments", group: "reader", labelKey: "toggleComments", key: "m", ctrl: true },
  { id: "reader:fullscreen", group: "reader", labelKey: "fullscreen", key: "f" },
  { id: "reader:zen-mode", group: "reader", labelKey: "zenMode", key: ".", ctrl: true },
  { id: "reader:zoom-in", group: "reader", labelKey: "zoomIn", key: "=", ctrl: true },
  { id: "reader:zoom-out", group: "reader", labelKey: "zoomOut", key: "-", ctrl: true },
  { id: "reader:zoom-reset", group: "reader", labelKey: "zoomReset", key: "0", ctrl: true },
  { id: "reader:prev-page", group: "reader", labelKey: "prevPage", key: "ArrowLeft" },
  { id: "reader:next-page", group: "reader", labelKey: "nextPage", key: "ArrowRight" },
  { id: "reader:space-next", group: "reader", labelKey: "spaceNext", key: " " },
  { id: "reader:space-prev", group: "reader", labelKey: "spacePrev", key: " ", shift: true },
  { id: "reader:page-down", group: "reader", labelKey: "pageDown", key: "PageDown" },
  { id: "reader:page-up", group: "reader", labelKey: "pageUp", key: "PageUp" },
  { id: "reader:home", group: "reader", labelKey: "home", key: "Home" },
  { id: "reader:end", group: "reader", labelKey: "end", key: "End" },
  { id: "reader:vim-h", group: "reader", labelKey: "vimH", key: "h" },
  { id: "reader:vim-l", group: "reader", labelKey: "vimL", key: "l" },
  { id: "reader:vim-j", group: "reader", labelKey: "vimJ", key: "j" },
  { id: "reader:vim-k", group: "reader", labelKey: "vimK", key: "k" },
  { id: "reader:search-next", group: "reader", labelKey: "searchNext", key: "n" },
  { id: "reader:search-prev", group: "reader", labelKey: "searchPrev", key: "n", shift: true },
  { id: "reader:highlight-yellow", group: "reader", labelKey: "highlightYellow", key: "1" },
  { id: "reader:highlight-green", group: "reader", labelKey: "highlightGreen", key: "2" },
  { id: "reader:highlight-blue", group: "reader", labelKey: "highlightBlue", key: "3" },
  { id: "reader:highlight-pink", group: "reader", labelKey: "highlightPink", key: "4" },
  { id: "reader:highlight-orange", group: "reader", labelKey: "highlightOrange", key: "5" },
  { id: "reader:add-comment", group: "reader", labelKey: "addComment", key: "c", ctrl: true, shift: true },
  { id: "reader:bookmark-page", group: "reader", labelKey: "bookmarkPage", key: "b", ctrl: true },
  { id: "reader:cycle-theme", group: "reader", labelKey: "cycleTheme", key: "t", ctrl: true, shift: true },
  { id: "reader:print", group: "reader", labelKey: "print", key: "p", ctrl: true },
  { id: "reader:screenshot", group: "reader", labelKey: "screenshot", key: "s", ctrl: true, shift: true },
  { id: "reader:undo", group: "reader", labelKey: "undo", key: "z", ctrl: true },
];

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  "global",
  "library",
  "chat",
  "reader",
];

/** Look up a catalog entry by registry id (for tooltip hints). */
export function getCatalogShortcut(id: string): CatalogEntry | undefined {
  return SHORTCUT_CATALOG.find((s) => s.id === id);
}

/**
 * Render a shortcut as a human-readable string, e.g. `"Ctrl + N"` or
 * on Mac `"⌘ N"`. Used by the Shortcuts settings tab and by inline
 * <Kbd> hints on buttons.
 */
export function formatShortcut(shortcut: ShortcutSpec): string {
  const parts = shortcutParts(shortcut);
  // Mac glyphs already look like separate elements; skip the " + ".
  return isMac() ? parts.join(" ") : parts.join(" + ");
}
