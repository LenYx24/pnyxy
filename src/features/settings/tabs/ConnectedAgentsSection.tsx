import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import type { OAuthGrant } from "@supabase/supabase-js";
import { Button, ConfirmModal, IconButton } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { MCP_SERVER_URL } from "@/lib/oauth-consent";
import { showToast } from "@/stores/toast-store";
import { SettingRow, SettingsSection } from "../ui";

async function fetchGrants(): Promise<OAuthGrant[]> {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) {
    // OAuth server off for this project: just no list
    logError("settings:agents:listGrants", error);
    return [];
  }
  return data ?? [];
}

function CopyField({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-bg-primary/60 py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
        {value}
      </code>
      <IconButton
        size="sm"
        aria-label={t("settings.agents.copy")}
        title={t("settings.agents.copy")}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? (
          <Check size={14} className="text-success" />
        ) : (
          <Copy size={14} />
        )}
      </IconButton>
    </div>
  );
}

/**
 * Settings > AI: connect an outside AI agent (claude.ai custom connector,
 * Claude Code) to the account through the remote MCP server, and list or
 * revoke the agents that were approved on /oauth/consent.
 */
export function ConnectedAgentsSection() {
  const { t, i18n } = useTranslation();
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null);
  const [revoking, setRevoking] = useState<OAuthGrant | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGrants().then((list) => {
      if (!cancelled) setGrants(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function revoke(grant: OAuthGrant) {
    const { error } = await supabase.auth.oauth.revokeGrant({
      clientId: grant.client.id,
    });
    if (error) {
      logError("settings:agents:revokeGrant", error);
      showToast(t("settings.agents.revokeFailed"), "error");
      return;
    }
    showToast(
      t("settings.agents.revoked", { app: grant.client.name }),
      "success",
    );
    setGrants(await fetchGrants());
  }

  const claudeCodeCmd = `claude mcp add --transport http pnyxy ${MCP_SERVER_URL}`;

  return (
    <SettingsSection
      title={t("settings.agents.heading")}
      description={t("settings.agents.description")}
    >
      <SettingRow label={t("settings.agents.urlLabel")} stacked>
        <CopyField value={MCP_SERVER_URL} />
      </SettingRow>
      <SettingRow label={t("settings.agents.claudeSteps")} stacked>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-text-secondary">
          <li>{t("settings.agents.step1")}</li>
          <li>{t("settings.agents.step2")}</li>
          <li>{t("settings.agents.step3")}</li>
        </ol>
      </SettingRow>
      <SettingRow
        label={t("settings.agents.claudeCode")}
        hint={t("settings.agents.claudeCodeHint")}
        stacked
      >
        <CopyField value={claudeCodeCmd} />
      </SettingRow>
      <SettingRow label={t("settings.agents.connected")} stacked>
        {grants === null ? null : grants.length === 0 ? (
          <p className="text-[13px] text-text-muted">
            {t("settings.agents.none")}
          </p>
        ) : (
          <ul className="space-y-1">
            {grants.map((g) => (
              <li
                key={g.client.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-bg-primary/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-text-primary">
                    {g.client.name || t("oauthConsent.unnamedApp")}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t("settings.agents.since", {
                      date: new Date(g.granted_at).toLocaleDateString(
                        i18n.language,
                      ),
                    })}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setRevoking(g)}
                >
                  {t("settings.agents.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingRow>
      <ConfirmModal
        open={revoking !== null}
        title={t("settings.agents.revokeTitle", {
          app: revoking?.client.name ?? "",
        })}
        body={t("settings.agents.revokeBody")}
        confirmLabel={t("settings.agents.revoke")}
        danger
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          const grant = revoking;
          setRevoking(null);
          if (grant) void revoke(grant);
        }}
      />
    </SettingsSection>
  );
}
