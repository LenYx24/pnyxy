import { useMemo } from "react";
import { Keyboard } from "lucide-react";
import {
  formatShortcut,
  getRegisteredShortcuts,
} from "@/lib/keyboard-shortcuts";

export function ShortcutsTab() {
  const shortcuts = useMemo(() => {
    const map = getRegisteredShortcuts();
    return Array.from(map.values())
      .filter((s) => s.description)
      .map((s) => ({
        id: s.id,
        key: s.key,
        ctrl: s.ctrl,
        shift: s.shift,
        alt: s.alt,
        description: s.description!,
      }));
  }, []);

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Keyboard size={18} className="text-text-secondary" />
        <h2 className="text-lg font-semibold text-text-primary">
          Keyboard Shortcuts
        </h2>
      </div>

      {shortcuts.length === 0 ? (
        <p className="text-sm text-text-muted">
          No shortcuts registered. Open a document to see reader shortcuts.
        </p>
      ) : (
        <div className="divide-y divide-glass-border/50">
          {shortcuts.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between py-2.5"
            >
              <span className="text-sm text-text-secondary">
                {s.description}
              </span>
              <kbd className="whitespace-nowrap rounded bg-bg-primary/80 px-2 py-1 text-xs font-mono text-text-primary border border-glass-border">
                {formatShortcut(s)}
              </kbd>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
