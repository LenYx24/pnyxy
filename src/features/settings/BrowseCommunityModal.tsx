import { useEffect, useState } from "react";
import { Download, ExternalLink, LoaderCircle, WifiOff, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { getRegistry } from "@/lib/registry";
import type { RegistryIndexEntry, RegistryStatus } from "@/lib/registry";
import { cn } from "@/lib/cn";

type Mode = "themes" | "plugins";

interface BrowseCommunityModalProps {
  mode: Mode;
  onClose: () => void;
}

export function BrowseCommunityModal({ mode, onClose }: BrowseCommunityModalProps) {
  const installedThemes = useSettingsStore((s) => s.installedThemes);
  const installedPlugins = useSettingsStore((s) => s.installedPlugins);
  const installTheme = useSettingsStore((s) => s.installTheme);
  const installPlugin = useSettingsStore((s) => s.installPlugin);

  const [entries, setEntries] = useState<RegistryIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RegistryStatus>({ offline: false });
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  // Load registry index + subscribe to status.
  useEffect(() => {
    const registry = getRegistry();
    const unsub = registry.onStatusChange(setStatus);

    let cancelled = false;
    setLoading(true);
    setError(null);
    const promise =
      mode === "themes" ? registry.listThemes() : registry.listPlugins();
    promise
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [mode]);

  async function handleInstall(entry: RegistryIndexEntry) {
    if (installing.has(entry.id)) return;
    setInstalling((prev) => new Set(prev).add(entry.id));
    try {
      const registry = getRegistry();
      if (entry.kind === "theme") {
        const theme = await registry.fetchThemeManifest(entry.id);
        installTheme(theme);
      } else {
        const manifest = await registry.fetchPluginManifest(entry.id);
        const bundle = await registry.fetchPluginBundle(entry.id, manifest.version);
        installPlugin(manifest, bundle);
      }
    } catch (err) {
      setError(`Install failed: ${(err as Error).message}`);
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  const isInstalled = (entry: RegistryIndexEntry): boolean => {
    if (entry.kind === "theme") return entry.id in installedThemes;
    return entry.id in installedPlugins;
  };

  const title = mode === "themes" ? "Browse Community Themes" : "Browse Community Plugins";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-glass-border bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {status.offline && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-400">
                <WifiOff size={11} />
                Offline — showing bundled fallback registry
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <LoaderCircle size={20} className="animate-spin" />
              <span className="ml-2 text-sm">Loading registry…</span>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">
              No {mode} found in the registry.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const installed = isInstalled(entry);
                const inFlight = installing.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-glass-border bg-glass-bg/40 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">
                        {entry.name}
                        <span className="ml-2 text-[10px] font-mono text-text-muted">
                          v{entry.version}
                        </span>
                      </p>
                      {entry.author && (
                        <p className="text-[11px] text-text-muted">
                          by {entry.author}
                        </p>
                      )}
                      {entry.description && (
                        <p className="mt-1 text-xs text-text-secondary">
                          {entry.description}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleInstall(entry)}
                      disabled={installed || inFlight}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                        installed
                          ? "bg-accent-purple/20 text-accent-purple cursor-default"
                          : "bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer",
                        inFlight && "opacity-60",
                      )}
                    >
                      {inFlight ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {installed ? "Installed" : inFlight ? "Installing…" : "Install"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-glass-border p-3">
          <a
            href="https://github.com/pnyxy/pnyxy-community"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-accent-purple"
          >
            <ExternalLink size={12} />
            Submit your own {mode === "themes" ? "theme" : "plugin"} on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
