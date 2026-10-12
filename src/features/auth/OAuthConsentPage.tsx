import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Laptop,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { MeshBackground, Button, Checkbox } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import {
  classifyRedirect,
  clearPendingConsent,
  rememberPendingConsent,
} from "@/lib/oauth-consent";

type State =
  | { kind: "loading" }
  | { kind: "ask"; details: OAuthAuthorizationDetails }
  | { kind: "redirecting" }
  | { kind: "error" };

/**
 * Consent screen of Pnyxy's OAuth server (Supabase Auth redirects here with
 * ?authorization_id=). An AI agent, e.g. a claude.ai connector, asks to use
 * the account through the remote MCP server; approving sends the user back
 * to the agent with an authorization code.
 */
export function OAuthConsentPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [deciding, setDeciding] = useState<"approve" | "deny" | null>(null);
  const [trusted, setTrusted] = useState(false);

  const signedIn = !authLoading && !!user;

  useEffect(() => {
    if (!signedIn || !authorizationId) return;
    clearPendingConsent();
    let cancelled = false;
    void supabase.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          logError("oauth-consent:details", error);
          setState({ kind: "error" });
          return;
        }
        if (!("authorization_id" in data)) {
          // approved before: Supabase hands back the redirect straight away
          setState({ kind: "redirecting" });
          window.location.assign(data.redirect_url);
          return;
        }
        setState({ kind: "ask", details: data });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, authorizationId]);

  if (!authorizationId) {
    return <Shell>{<ErrorBody text={t("oauthConsent.invalid")} />}</Shell>;
  }

  if (!authLoading && !user) {
    const here = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    rememberPendingConsent(here);
    return <Navigate to={`/auth?next=${encodeURIComponent(here)}`} replace />;
  }

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setDeciding(approve ? "approve" : "deny");
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });
    if (error || !data) {
      logError("oauth-consent:decide", error);
      setDeciding(null);
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "redirecting" });
    window.location.assign(data.redirect_url);
  }

  if (state.kind === "error") {
    return <Shell>{<ErrorBody text={t("oauthConsent.failed")} />}</Shell>;
  }

  if (state.kind !== "ask") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-6 text-sm text-text-muted">
          <Loader2 size={24} className="animate-spin" />
          {state.kind === "redirecting" && t("oauthConsent.redirecting")}
        </div>
      </Shell>
    );
  }

  const { details } = state;
  const redirect = classifyRedirect(details.redirect_uri);
  const appName = details.client.name || t("oauthConsent.unnamedApp");
  const abilities = [
    t("oauthConsent.canRead"),
    t("oauthConsent.canReadState"),
    t("oauthConsent.canCreate"),
    t("oauthConsent.canOrganize"),
  ];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary">
            <ShieldCheck size={24} className="text-text-secondary" />
          </div>
          <h1 className="font-display text-xl font-semibold text-text-primary">
            {t("oauthConsent.title", { app: appName })}
          </h1>
          <p className="text-[13px] text-text-muted">
            {t("oauthConsent.account", { email: details.user.email })}
          </p>
        </div>

        {redirect.kind === "known" && (
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-success">
            <BadgeCheck size={16} />
            {t("oauthConsent.verified", {
              agent: redirect.agent,
              host: redirect.host,
            })}
          </p>
        )}
        {redirect.kind === "local" && (
          <p className="flex items-start gap-2 rounded-lg bg-bg-tertiary px-4 py-3 text-[13px] text-text-secondary">
            <Laptop size={16} className="mt-0.5 shrink-0" />
            {t("oauthConsent.local")}
          </p>
        )}
        {redirect.kind === "unknown" && (
          <div className="space-y-3 rounded-lg bg-warning/10 px-4 py-3">
            <p className="flex items-start gap-2 text-[13px] text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {t("oauthConsent.unknown", { host: redirect.host })}
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
              <Checkbox
                checked={trusted}
                onChange={setTrusted}
                aria-label={t("oauthConsent.trust")}
              />
              {t("oauthConsent.trust")}
            </label>
          </div>
        )}

        <div className="rounded-lg bg-bg-tertiary px-4 py-3">
          <p className="mb-2 text-[13px] font-medium text-text-primary">
            {t("oauthConsent.itCan", { app: appName })}
          </p>
          <ul className="space-y-1.5">
            {abilities.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-[13px] text-text-secondary"
              >
                <Check size={14} className="mt-0.5 shrink-0 text-success" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            {t("oauthConsent.cannot")}
          </p>
        </div>

        <p className="text-center text-xs text-text-muted">
          {t("oauthConsent.returnTo", { host: redirect.host })}
        </p>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={deciding !== null}
            loading={deciding === "deny"}
            onClick={() => void decide(false)}
          >
            {t("oauthConsent.deny")}
          </Button>
          <Button
            className="flex-1"
            disabled={
              deciding !== null || (redirect.kind === "unknown" && !trusted)
            }
            loading={deciding === "approve"}
            onClick={() => void decide(true)}
          >
            {t("oauthConsent.approve")}
          </Button>
        </div>

        <p className="text-center text-xs text-text-muted">
          {t("oauthConsent.revokeHint")}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <MeshBackground />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-glass-bg p-8 backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}

function ErrorBody({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-danger/10 px-4 py-3 text-center text-sm text-danger">
      {text}
    </p>
  );
}
