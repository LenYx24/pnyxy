import { Check, Trash2 } from "lucide-react";
import type { Theme } from "@/lib/themes";
import { CORE_THEMES } from "@/lib/themes";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui";

interface ThemeCardProps {
  theme: Theme;
  isActive: boolean;
  onApply: () => void;
  onUninstall?: () => void;
}

/**
 * Renders a theme preview swatch using the theme's own tokens, with
 * an Apply button + uninstall (community themes only). Active state
 * is a surface step up plus a check, no accent ring.
 */
export function ThemeCard({ theme, isActive, onApply, onUninstall }: ThemeCardProps) {
  const isCore = theme.id in CORE_THEMES;
  const tokens = theme.tokens;
  const swatchStyle = {
    background: tokens["--color-bg-primary"],
    color: tokens["--color-text-primary"],
  } satisfies React.CSSProperties;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-panel transition-colors",
        isActive ? "bg-surface-3" : "bg-bg-tertiary hover:bg-surface-3/70",
      )}
    >
      {/* Preview area */}
      <div className="p-2 pb-0">
        <div
          className="flex h-24 flex-col justify-between rounded-control p-3"
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
      </div>

      {/* Meta + actions */}
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {theme.name}
          </p>
          <p className="truncate text-2xs text-text-muted">
            {theme.author}
            {!isCore && " · community"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isCore && onUninstall && (
            <IconButton
              variant="danger"
              size="sm"
              onClick={onUninstall}
              title="Uninstall theme"
              aria-label="Uninstall theme"
            >
              <Trash2 size={14} />
            </IconButton>
          )}
          {isActive ? (
            <span className="inline-flex items-center gap-1 px-2 text-xs font-medium text-text-primary">
              <Check size={14} />
              Active
            </span>
          ) : (
            <Button variant="secondary" size="sm" onClick={onApply}>
              Apply
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
