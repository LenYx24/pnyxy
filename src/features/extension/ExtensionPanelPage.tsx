import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, LogIn, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import { useResourceStore } from "@/stores/resource-store";
import { useFeature } from "@/lib/use-features";
import { normalizeUrl } from "@/lib/resource-url";
import { saveUrlAsResource } from "@/features/resources/save-url";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import { ResourceChatPanel } from "@/features/resources/ResourceChatPanel";
import type { Resource } from "@/types/resource";

const MAX_PAGE_TEXT = 120_000;

interface PageContext {
  url: string;
  title: string;
  text: string;
  selection: string;
}

/**
 * The browser extension's side panel: this route is loaded in an iframe
 * inside the extension, which posts the active tab's URL / title / text /
 * selection via postMessage. The page is saved as a "web" resource in the
 * library's "Web" folder (find-or-create by URL) and the resource-scoped
 * AI chat opens with the page text as context, so every conversation
 * about an article stays attached to it in the library.
 *
 * Auth lives inside the iframe (storage is partitioned per top-level
 * site), so a signed-out panel shows a sign-in button that goes through
 * /auth?next=/ext within the frame.
 */
export function ExtensionPanelPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const webArticles = useFeature("webArticles");
  const resources = useResourceStore((s) => s.resources);
  const fetchResources = useResourceStore((s) => s.fetchResources);

  const [page, setPage] = useState<PageContext | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the extension looked for a signed-in Pnyxy tab and found none
  const [noSession, setNoSession] = useState(false);

  // page context from the extension (parent frame only)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data as {
        type?: string;
        url?: unknown;
        title?: unknown;
        text?: unknown;
        selection?: unknown;
      };
      if (!d || typeof d.type !== "string") return;
      if (d.type === "pnyxy:session") {
        // session handed over from the user's Pnyxy tab (partitioned storage
        // keeps the frame from seeing it on its own)
        const s = e.data as { access_token?: unknown; refresh_token?: unknown };
        if (typeof s.access_token === "string" && typeof s.refresh_token === "string") {
          void supabase.auth
            .setSession({ access_token: s.access_token, refresh_token: s.refresh_token })
            .then(() => setNoSession(false))
            .catch((err) => logError("extension:setSession", err));
        }
        return;
      }
      if (d.type === "pnyxy:no-session") {
        setNoSession(true);
        return;
      }
      if (d.type !== "pnyxy:page" || typeof d.url !== "string") return;
      setPage({
        url: d.url,
        title: typeof d.title === "string" ? d.title : "",
        text: typeof d.text === "string" ? d.text.slice(0, MAX_PAGE_TEXT) : "",
        selection: typeof d.selection === "string" ? d.selection : "",
      });
    };
    window.addEventListener("message", onMessage);
    // tell the extension we're listening; it replies with the page
    window.parent.postMessage({ type: "pnyxy:ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (user) void fetchResources();
  }, [user, fetchResources]);

  // signed out: ask the extension to copy the session from an app tab
  useEffect(() => {
    if (user || authLoading) return;
    window.parent.postMessage({ type: "pnyxy:need-auth" }, "*");
  }, [user, authLoading]);

  // find-or-create the resource for the current page
  const savingRef = useRef<string | null>(null);
  const ensureResource = useCallback(
    async (p: PageContext) => {
      const key = normalizeUrl(p.url).replace(/#.*$/, "");
      if (savingRef.current === key) return;
      savingRef.current = key;
      setSaving(true);
      setError(null);
      try {
        const { id, created, folder } = await saveUrlAsResource({
          url: p.url,
          title: p.title,
          content: p.text || null,
        });
        setResourceId(id);
        // the only place "it got saved" is announced; the header stays clean
        if (created) showToast(t("extension.savedTo", { folder }), "success");
      } catch (err) {
        logError("extension:saveResource", err);
        setError(t("extension.saveFailed"));
      } finally {
        setSaving(false);
        savingRef.current = null;
      }
    },
    [t],
  );

  useEffect(() => {
    if (!user || !page || !webArticles) return;
    void ensureResource(page);
  }, [user, page, webArticles, ensureResource]);

  const resource: Resource | null = useMemo(
    () => resources.find((r) => r.id === resourceId) ?? null,
    [resources, resourceId],
  );
  const initialInput = useMemo(
    () =>
      page?.selection?.trim()
        ? `> ${page.selection.trim().slice(0, 4000)}\n\n`
        : undefined,
    [page?.selection],
  );

  if (!user) {
    if (authLoading) {
      return (
        <Centered>
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </Centered>
      );
    }
    return (
      <Centered>
        {noSession ? (
          <Sparkles size={22} strokeWidth={1.5} className="text-accent" />
        ) : (
          <Loader2 size={20} className="animate-spin text-text-muted" />
        )}
        <p className="text-sm text-text-primary">{t("extension.signInTitle")}</p>
        <p className="text-xs text-text-muted">{t("extension.signInBody")}</p>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => window.parent.postMessage({ type: "pnyxy:open-app" }, "*")}
        >
          <LogIn size={14} strokeWidth={1.5} />
          {t("extension.openAppToSignIn")}
        </Button>
        <button
          type="button"
          onClick={() => navigate("/auth?next=/ext")}
          className="text-2xs text-text-muted underline-offset-2 hover:underline cursor-pointer"
        >
          {t("extension.signInHere")}
        </button>
      </Centered>
    );
  }
  if (!webArticles) {
    return (
      <Centered>
        <p className="text-sm text-text-primary">{t("extension.notEnabledTitle")}</p>
        <p className="text-xs text-text-muted">{t("extension.notEnabledBody")}</p>
      </Centered>
    );
  }
  if (!page) {
    return (
      <Centered>
        <Loader2 size={20} className="animate-spin text-text-muted" />
        <p className="text-xs text-text-muted">{t("extension.waitingForPage")}</p>
      </Centered>
    );
  }

  const settingsButton = (
    <button
      type="button"
      onClick={() => window.parent.postMessage({ type: "pnyxy:open-settings" }, "*")}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
      title={t("extension.settings")}
      aria-label={t("extension.settings")}
    >
      <Settings size={15} strokeWidth={1.5} />
    </button>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-bg-primary">
      {error && <p className="px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="min-h-0 flex-1">
        {resource ? (
          <ResourceChatPanel
            resource={resource}
            currentTime={0}
            duration={null}
            onSeek={() => {}}
            initialInput={initialInput}
            compact
            extraActions={settingsButton}
          />
        ) : (
          <Centered>
            <Loader2 size={20} className="animate-spin text-text-muted" />
            {saving && <p className="text-xs text-text-muted">{t("extension.saving")}</p>}
          </Centered>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-2 bg-bg-primary px-6 text-center">
      {children}
    </div>
  );
}
