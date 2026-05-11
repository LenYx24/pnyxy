import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Puzzle } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { CORE_PLUGINS } from "@/lib/plugins/core-registry";
import type { PluginManifest } from "@/lib/plugins/types";
import { usePluginHost } from "@/lib/plugins/host-context";
import { PluginRow } from "../PluginRow";
import { BrowseCommunityModal } from "../BrowseCommunityModal";
import { cn } from "@/lib/cn";

type SubTab = "installed" | "browse";

export function PluginsTab() {
  const { t } = useTranslation();
  const enabledPlugins = useSettingsStore((s) => s.enabledPlugins);
  const installedPlugins = useSettingsStore((s) => s.installedPlugins);
  const setPluginEnabled = useSettingsStore((s) => s.setPluginEnabled);
  const uninstallPlugin = useSettingsStore((s) => s.uninstallPlugin);

  const { statuses } = usePluginHost();

  const [subTab, setSubTab] = useState<SubTab>("installed");
  const [browseOpen, setBrowseOpen] = useState(false);

  // Core manifests + community manifests, deduplicated by id.
  const coreManifests: PluginManifest[] = Object.values(CORE_PLUGINS).map(
    (e) => e.manifest,
  );
  const communityManifests: PluginManifest[] = Object.values(installedPlugins).map(
    (p) => p.manifest,
  );

  return (
    <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
      <div className="flex items-center gap-2">
        <Puzzle size={18} className="text-accent-purple" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.pluginsSection.heading")}
        </h2>
      </div>
      <p className="text-xs text-text-muted">
        {t("settings.pluginsSection.description")}
      </p>

      <div className="flex gap-1 rounded-lg border border-glass-border bg-bg-primary/40 p-0.5">
        <SubTabButton
          active={subTab === "installed"}
          onClick={() => setSubTab("installed")}
          label={t("settings.pluginsSection.installedTab")}
          count={coreManifests.length + communityManifests.length}
        />
        <SubTabButton
          active={subTab === "browse"}
          onClick={() => {
            setSubTab("browse");
            setBrowseOpen(true);
          }}
          label={t("settings.pluginsSection.browseTab")}
        />
      </div>

      {subTab === "installed" && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("settings.pluginsSection.coreHeading")}
            </h3>
            <div className="space-y-2">
              {coreManifests.map((manifest) => (
                <PluginRow
                  key={manifest.id}
                  manifest={manifest}
                  status={statuses.get(manifest.id)}
                  enabled={enabledPlugins[manifest.id] ?? false}
                  onToggle={(v) => setPluginEnabled(manifest.id, v)}
                />
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("settings.pluginsSection.communityHeading")}
            </h3>
            {communityManifests.length === 0 ? (
              <div className="rounded-lg border border-dashed border-glass-border bg-bg-primary/40 p-4 text-center">
                <p className="text-sm text-text-secondary">
                  {t("settings.pluginsSection.noCommunity")}
                </p>
                <button
                  type="button"
                  onClick={() => setBrowseOpen(true)}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-accent-purple hover:underline cursor-pointer"
                >
                  <Plus size={12} />
                  {t("settings.pluginsSection.browseCommunity")}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {communityManifests.map((manifest) => (
                  <PluginRow
                    key={manifest.id}
                    manifest={manifest}
                    status={statuses.get(manifest.id)}
                    enabled={enabledPlugins[manifest.id] ?? false}
                    onToggle={(v) => setPluginEnabled(manifest.id, v)}
                    onUninstall={() => uninstallPlugin(manifest.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {browseOpen && (
        <BrowseCommunityModal
          mode="plugins"
          onClose={() => {
            setBrowseOpen(false);
            setSubTab("installed");
          }}
        />
      )}
    </section>
  );
}

function SubTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
        active
          ? "bg-glass-bg text-text-primary"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1 text-text-muted">({count})</span>
      )}
    </button>
  );
}
