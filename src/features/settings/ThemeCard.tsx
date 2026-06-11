import { Check, Trash2 } from "lucide-react";
import type { Theme } from "@/lib/themes";
import { CORE_THEMES } from "@/lib/themes";
import { cn } from "@/lib/cn";

interface ThemeCardProps {
  theme: Theme;
  isActive: boolean;
  onApply: () => void;
  onUninstall?: () => void;
}

/**
 * Renders a theme preview swatch using the theme's own tokens, with
 * an Apply button + uninstall (community themes only).
 */
export function ThemeCard({ theme, isActive, onApply, onUninstall }: ThemeCardProps) {
  const isCore = theme.id in CORE_THEMES;
  const tokens = theme.tokens;
  const swatchStyle = {
    background: tokens["--color-bg-primary"],
    color: tokens["--color-text-primary"],
    borderColor: tokens["--color-glass-border"],
  } satisfies React.CSSProperties;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border transition-colors",
        isActive
          ? "border-accent ring-2 ring-accent/30"
          : "border-glass-border hover:border-glass-border/80",
      )}
    >
      {/* Preview area */}
      <div
        className="flex h-28 flex-col justify-between border-b p-3"
        style={swatchStyle}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: tokens["--color-accent"] }}
          />
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: tokens["--color-accent-blue"] }}
          />
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: tokens["--color-text-muted"] }}
          />
        </div>
        <div className="space-y-1">
          <div
            className="h-2 w-3/4 rounded"
            style={{ background: tokens["--color-text-secondary"] }}
          />
          <div
            className="h-2 w-1/2 rounded"
            style={{ background: tokens["--color-text-muted"] }}
          />
        </div>
      </div>

      {/* Meta + actions */}
      <div className="flex items-start justify-between gap-2 bg-glass-bg/40 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {theme.name}
          </p>
          <p className="text-2xs text-text-muted truncate">
            {theme.author}
            {!isCore && " · community"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isCore && onUninstall && (
            <button
              type="button"
              onClick={onUninstall}
              title="Uninstall theme"
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onApply}
            disabled={isActive}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-accent/20 text-accent cursor-default"
                : "bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer",
            )}
          >
            {isActive ? (
              <>
                <Check size={12} />
                Active
              </>
            ) : (
              "Apply"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
