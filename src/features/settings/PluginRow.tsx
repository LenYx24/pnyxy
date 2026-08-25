import { ChevronDown, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { IconButton, Toggle } from "@/components/ui";
import type { PluginManifest } from "@/lib/plugins/types";
import type { PluginLoadStatus } from "@/lib/plugins/manager";
import { CORE_PLUGINS } from "@/lib/plugins/core-registry";
import { cn } from "@/lib/cn";

interface PluginRowProps {
  manifest: PluginManifest;
  status?: PluginLoadStatus;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall?: () => void;
}

/**
 * Single row in the Plugins → Installed list. Shows manifest meta,
 * load status, an enable toggle, and (for community plugins) an
 * uninstall button. Permissions are exposed via a disclosure.
 */
export function PluginRow({
  manifest,
  status,
  enabled,
  onToggle,
  onUninstall,
}: PluginRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isCore = manifest.id in CORE_PLUGINS;
  const permissions = manifest.permissions ?? [];

  return (
    <div className="rounded-panel bg-bg-tertiary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-text-primary truncate">
              {manifest.name}
            </p>
            <span className="text-2xs font-mono text-text-muted">
              v{manifest.version}
            </span>
            {isCore && (
              <span className="chip px-2 py-0.5 text-2xs">Core</span>
            )}
            <StatusBadge status={status} enabled={enabled} />
          </div>
          <p className="text-[13px] text-text-muted">by {manifest.author}</p>
          {manifest.description && (
            <p className="mt-1 text-[13px] text-text-secondary">
              {manifest.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Toggle checked={enabled} onChange={onToggle} />
          {!isCore && onUninstall && (
            <IconButton
              variant="danger"
              size="sm"
              onClick={onUninstall}
              title="Uninstall"
              aria-label="Uninstall"
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>

      {/* Disclosure: permissions + error */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-2xs text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
      >
        <ChevronDown
          size={12}
          className={cn("transition-transform", expanded && "rotate-180")}
        />
        Details
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-control bg-bg-secondary/60 p-3 text-xs">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2">
              Permissions
            </p>
            {permissions.length === 0 ? (
              <p className="text-text-secondary">None requested.</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1">
                {permissions.map((p) => (
                  <li
                    key={p}
                    className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-text-secondary"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {status?.state === "error" && status.error && (
            <div className="rounded-control bg-danger/10 p-2 text-danger">
              <p className="text-2xs uppercase tracking-wide">Error</p>
              <p className="text-2xs">{status.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  enabled,
}: {
  status?: PluginLoadStatus;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <span className="text-2xs uppercase tracking-wide text-text-muted">
        Disabled
      </span>
    );
  }
  if (!status || status.state === "unloaded") {
    return (
      <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide text-text-muted">
        <LoaderCircle size={10} className="animate-spin" />
        Loading
      </span>
    );
  }
  if (status.state === "error") {
    return (
      <span className="text-2xs uppercase tracking-wide text-danger">
        Error
      </span>
    );
  }
  return (
    <span className="text-2xs uppercase tracking-wide text-success">
      Loaded
    </span>
  );
}
