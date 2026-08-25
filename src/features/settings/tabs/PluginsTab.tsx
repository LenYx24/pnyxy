import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { CORE_PLUGINS } from "@/lib/plugins/core-registry";
import type { PluginManifest } from "@/lib/plugins/types";
import { usePluginHost } from "@/lib/plugins/host-context";
import { PluginRow } from "../PluginRow";
import { BrowseCommunityModal } from "../BrowseCommunityModal";
import { Button } from "@/components/ui";
import { SectionCaption, SettingsSection } from "../ui";

export function PluginsTab() {
  const { t } = useTranslation();
  const enabledPlugins = useSettingsStore((s) => s.enabledPlugins);
  const installedPlugins = useSettingsStore((s) => s.installedPlugins);
  const setPluginEnabled = useSettingsStore((s) => s.setPluginEnabled);
  const uninstallPlugin = useSettingsStore((s) => s.uninstallPlugin);

  const { statuses } = usePluginHost();

  const [browseOpen, setBrowseOpen] = useState(false);

  // Core manifests + community manifests, deduplicated by id.
  const coreManifests: PluginManifest[] = Object.values(CORE_PLUGINS).map(
    (e) => e.manifest,
  );
  const communityManifests: PluginManifest[] = Object.values(installedPlugins).map(
    (p) => p.manifest,
  );

  return (
    <div className="space-y-8">
      <SettingsSection
        description={t("settings.pluginsSection.description")}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setBrowseOpen(true)}>
            <Plus size={14} />
            {t("settings.pluginsSection.browseTab")}
          </Button>
        }
        plain
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <SectionCaption className="px-1">
              {t("settings.pluginsSection.coreHeading")} ({coreManifests.length})
            </SectionCaption>
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

          <div className="space-y-2">
            <SectionCaption className="px-1">
              {t("settings.pluginsSection.communityHeading")} (
              {communityManifests.length})
            </SectionCaption>
            {communityManifests.length === 0 ? (
              <div className="rounded-panel bg-bg-tertiary p-5 text-center">
                <p className="text-[13px] text-text-muted">
                  {t("settings.pluginsSection.noCommunity")}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setBrowseOpen(true)}
                >
                  <Plus size={14} />
                  {t("settings.pluginsSection.browseCommunity")}
                </Button>
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
      </SettingsSection>

      {browseOpen && (
        <BrowseCommunityModal
          mode="plugins"
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}
