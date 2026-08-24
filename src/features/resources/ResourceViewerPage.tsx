import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useResourceStore } from "@/stores/resource-store";
import { Button } from "@/components/ui";
import { renderMarkdown } from "@/lib/ai/markdown-message";
import {
  displayHost,
  parseYouTubeId,
  youtubeEmbedUrl,
} from "@/lib/resource-url";

/**
 * Full-page viewer for a library "resource", a saved web page or YouTube
 * link (migration 00053, beta). Reached from the library cards at
 * `/resources/:resourceId`. YouTube resources embed a responsive player;
 * web resources render their extracted article markdown (when the server
 * ingest function has populated `content`) in a readable column, otherwise
 * fall back to a link card.
 */
export function ResourceViewerPage() {
  const { resourceId } = useParams<{ resourceId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resources = useResourceStore((s) => s.resources);
  const fetchResources = useResourceStore((s) => s.fetchResources);
  const [resolving, setResolving] = useState(resources.length === 0);

  // Deep-link / refresh straight onto this route won't have hydrated the
  // store yet, so pull the list once if it's empty.
  useEffect(() => {
    let cancelled = false;
    if (resources.length === 0) {
      setResolving(true);
      void fetchResources().finally(() => {
        if (!cancelled) setResolving(false);
      });
    } else {
      setResolving(false);
    }
    return () => {
      cancelled = true;
    };
    // Only run on mount; subsequent store updates are handled by the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resource = useMemo(
    () => resources.find((r) => r.id === resourceId),
    [resources, resourceId],
  );

  const html = useMemo(
    () =>
      resource?.kind === "web" && resource.content
        ? renderMarkdown(resource.content)
        : "",
    [resource?.kind, resource?.content],
  );

  const backButton = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <ArrowLeft size={16} />
      {t("resources.back", { defaultValue: "Back" })}
    </button>
  );

  // Loading state while the store hydrates.
  if (resolving && !resource) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-glass-border px-3 py-2">
          {backButton}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
          {t("resources.loading", { defaultValue: "Loading…" })}
        </div>
      </div>
    );
  }

  // Not found, resolved but the id isn't in the list.
  if (!resource) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-glass-border px-3 py-2">
          {backButton}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-text-secondary">
            {t("resources.notFound", {
              defaultValue: "This resource could not be found.",
            })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate("/library")}>
            {t("resources.backToLibrary", { defaultValue: "Go to library" })}
          </Button>
        </div>
      </div>
    );
  }

  const host = displayHost(resource.url);
  const openOriginal = (
    <a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
    >
      <ExternalLink size={14} />
      {t("resources.openOriginal", { defaultValue: "Open original" })}
    </a>
  );

  const ytId = resource.kind === "youtube" ? parseYouTubeId(resource.url) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-glass-border px-3 py-2">
        {backButton}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-medium text-text-primary">
              {resource.title}
            </h1>
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent">
              {t("resources.beta", { defaultValue: "Beta" })}
            </span>
          </div>
          <p className="truncate text-xs text-text-secondary">{host}</p>
        </div>
        <div className="shrink-0">{openOriginal}</div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {resource.kind === "youtube" && ytId ? (
          <div className="mx-auto w-full max-w-4xl p-4">
            <div className="aspect-video w-full overflow-hidden rounded-lg border border-glass-border bg-black">
              <iframe
                src={youtubeEmbedUrl(ytId)}
                title={resource.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            {resource.description && (
              <p className="mt-4 text-sm text-text-secondary">
                {resource.description}
              </p>
            )}
          </div>
        ) : resource.kind === "web" && resource.content ? (
          <article className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <div
              className="ai-message break-words"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        ) : (
          // Fallback card: YouTube id unparseable, or web page not yet
          // ingested (content extraction is a beta server feature).
          <div className="mx-auto w-full max-w-md px-4 py-10">
            <div className="flex flex-col gap-4 rounded-xl border border-glass-border bg-glass-bg p-6 text-center">
              {resource.thumbnail_url && (
                <img
                  src={resource.thumbnail_url}
                  alt=""
                  className="mx-auto max-h-40 w-full rounded-lg object-cover"
                  draggable={false}
                />
              )}
              <h2 className="text-base font-medium text-text-primary">
                {resource.title}
              </h2>
              <p className="text-xs text-text-secondary">{host}</p>
              {resource.description && (
                <p className="text-sm text-text-secondary">
                  {resource.description}
                </p>
              )}
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white shadow-lg shadow-accent/25 transition-colors hover:bg-accent/80"
              >
                <ExternalLink size={16} />
                {t("resources.openOriginal", { defaultValue: "Open original" })}
              </a>
              <p className="text-2xs text-text-muted">
                {t("resources.previewUnavailable", {
                  defaultValue:
                    "A readable preview isn't available yet. Extraction is a beta feature that needs the server ingest function.",
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
