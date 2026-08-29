import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { useFeature } from "@/lib/use-features";
import { isValidUrl } from "@/lib/resource-url";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import { saveUrlAsResource } from "./save-url";
import { fetchUrlAsFile } from "@/lib/url-to-file";
import { useUploadStore } from "@/stores/upload-store";

/**
 * `/open?url=<link>&title=<optional>`: the browser extension's "Open with
 * Pnyxy" hand-off. Saves the link as a library resource (YouTube →
 * "YouTube" folder with transcript, pages → "Web") and lands on the
 * resource viewer, where a video keeps playing next to the AI side-chat.
 * Signed-out users go through /auth?next=… first.
 */
export function OpenUrlPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const webArticles = useFeature("webArticles");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const enqueueUpload = useUploadStore((s) => s.enqueueUpload);

  const url = params.get("url") ?? "";
  const title = params.get("title") ?? undefined;

  useEffect(() => {
    if (authLoading || startedRef.current) return;
    if (!user) {
      const next = `/open?${params.toString()}`;
      navigate(`/auth?next=${encodeURIComponent(next)}`, { replace: true });
      return;
    }
    if (!url || !isValidUrl(url)) {
      setError(t("resources.open.badUrl"));
      return;
    }
    startedRef.current = true;
    void (async () => {
      try {
        // a PDF link (the extension's "Add to Pnyxy" on a PDF tab): download
        // through the CORS proxy fallback and put it in the upload queue,
        // which lands it in the library and opens the reader when done
        if (/\.pdf(?:[?#]|$)/i.test(url)) {
          const file = await fetchUrlAsFile(url);
          enqueueUpload(file);
          showToast(t("resources.open.pdfQueued"), "success");
          navigate("/library", { replace: true });
          return;
        }
        const { id, created, folder } = await saveUrlAsResource({ url, title });
        if (created) showToast(t("extension.savedTo", { folder }), "success");
        navigate(`/resources/${id}`, { replace: true });
      } catch (err) {
        logError("openUrl:save", err);
        setError(t("extension.saveFailed"));
      }
    })();
  }, [authLoading, user, url, title, params, navigate, t, webArticles, enqueueUpload]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {error ? (
        <>
          <p className="text-sm text-text-primary">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => navigate("/library")}>
            {t("resources.backToLibrary")}
          </Button>
        </>
      ) : (
        <>
          <Loader2 size={22} className="animate-spin text-text-muted" />
          <p className="text-xs text-text-muted">{t("resources.open.saving")}</p>
        </>
      )}
    </div>
  );
}
