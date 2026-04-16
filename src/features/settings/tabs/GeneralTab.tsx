import { useSettingsStore } from "@/stores/settings-store";
import type { FitMode } from "@/stores/settings-store";
import { Toggle, Slider } from "@/components/ui";
import { cn } from "@/lib/cn";

export function GeneralTab() {
  const {
    pageScrollBehavior,
    scrollAnimationDuration,
    defaultFitMode,
    setPageScrollBehavior,
    setScrollAnimationDuration,
    setDefaultFitMode,
  } = useSettingsStore();

  const fitModeOptions: { value: FitMode; label: string; description: string }[] = [
    { value: "fit-width", label: "Fit Width", description: "Scale pages to fill the viewer width" },
    { value: "fit-page", label: "Fit Page", description: "Scale pages to fit entirely in view" },
  ];

  return (
    <div className="space-y-6">
      {/* Navigation section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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

      {/* Reader section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">Reader</h2>

        <div>
          <p className="text-sm font-medium text-text-primary mb-1">
            Default fit mode
          </p>
          <p className="text-xs text-text-muted mb-3">
            How new documents are scaled when first opened
          </p>
          <div className="flex gap-2">
            {fitModeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDefaultFitMode(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
                  defaultFitMode === opt.value
                    ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                    : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs opacity-70 mt-0.5">{opt.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
