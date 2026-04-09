import { useMemo } from "react";
import { Settings, Keyboard } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { getRegisteredShortcuts } from "@/lib/keyboard-shortcuts";
import { Toggle, Slider } from "@/components/ui";

function formatKey(shortcut: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}) {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.alt) parts.push("Alt");

  const keyName =
    shortcut.key === "\\" ? "\\" :
    shortcut.key === "=" ? "+" :
    shortcut.key === "-" ? "-" :
    shortcut.key.startsWith("Arrow") ? shortcut.key.replace("Arrow", "") :
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() :
    shortcut.key;

  parts.push(keyName);
  return parts.join(" + ");
}

export function SettingsPage() {
  const {
    pageScrollBehavior,
    scrollAnimationDuration,
    setPageScrollBehavior,
    setScrollAnimationDuration,
  } = useSettingsStore();

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
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Settings size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
      </div>

      {/* Navigation section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6">
        <h2 className="text-lg font-semibold text-text-primary">Navigation</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">
              Animated page scroll
            </p>
            <p className="text-xs text-text-muted">
              Smoothly animate when navigating between pages
            </p>
          </div>
          <Toggle
            checked={pageScrollBehavior === "smooth"}
            onChange={(checked) =>
              setPageScrollBehavior(checked ? "smooth" : "instant")
            }
          />
        </div>

        {pageScrollBehavior === "smooth" && (
          <div className="space-y-2 pl-0">
            <p className="text-sm font-medium text-text-primary">
              Animation duration
            </p>
            <Slider
              value={scrollAnimationDuration}
              onChange={setScrollAnimationDuration}
              min={100}
              max={1000}
              step={50}
              valueLabel={`${scrollAnimationDuration}ms`}
            />
          </div>
        )}
      </section>

      {/* Keyboard shortcuts section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-6">
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
                <kbd className="rounded bg-bg-primary/80 px-2 py-1 text-xs font-mono text-text-primary border border-glass-border">
                  {formatKey(s)}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
