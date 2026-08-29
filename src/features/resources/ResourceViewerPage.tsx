import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { useResourceStore } from "@/stores/resource-store";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/hooks/use-media-query";
import type { Resource } from "@/types/resource";
import { ResourceChatPanel } from "./ResourceChatPanel";
import { useYouTubePlayer } from "./useYouTubePlayer";
import {
  displayHost,
  parseYouTubeId,
  youtubeEmbedUrl,
} from "@/lib/resource-url";
import { isSafeExternalUrl } from "@/lib/safe-url";

/**
 * Full-page viewer for a library "resource", a saved web page or YouTube
 * link (migration 00053, beta). Reached from the library cards at
 * `/resources/:resourceId`. YouTube resources embed a responsive player
 * with an AI side-chat (see YouTubeResourceView); web resources render
 * their extracted article markdown (when the server ingest function has
 * populated `content`) in a readable column, otherwise fall back to a
 * link card.
 */

/**
 * Saved web page: no in-app reader (extraction dropped images and
 * visualizations, so reading happens on the original site or via the
 * browser extension). The library keeps the record: what was read, and
 * the conversations that belong to it, so this view is a link card plus
 * the resource-scoped AI side-chat.
 */
function WebResourceView({
  resource,
  chatOpen,
}: {
  resource: Resource;
  chatOpen: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const safe = isSafeExternalUrl(resource.url);
  const card = (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex flex-col gap-3 rounded-xl border border-glass-border bg-glass-bg p-5 text-center">
        {resource.thumbnail_url && (
          <img src={resource.thumbnail_url} alt="" className="mx-auto max-h-40 w-full rounded-lg object-cover" draggable={false} />
        )}
        <h2 className="text-base font-medium text-text-primary">{resource.title}</h2>
        <p className="text-xs text-text-secondary">{displayHost(resource.url)}</p>
        {resource.description && (
          <p className="text-sm text-text-secondary">{resource.description}</p>
        )}
        {safe && (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white shadow-lg shadow-accent/25 transition-colors hover:bg-accent/80"
          >
            <ExternalLink size={16} />
            {t("resources.openOriginal")}
          </a>
        )}
        <p className="text-2xs text-text-muted">{t("resources.webReadElsewhere")}</p>
      </div>
    </div>
  );
  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {chatOpen ? (
          <div className="min-h-0 flex-1">
            <ResourceChatPanel resource={resource} currentTime={0} duration={null} onSeek={() => {}} compact showTitle={false} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">{card}</div>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">{card}</div>
      {chatOpen && (
        <div className="w-[380px] shrink-0 border-l border-glass-border xl:w-[420px]">
          <ResourceChatPanel resource={resource} currentTime={0} duration={null} onSeek={() => {}} compact showTitle={false} />
        </div>
      )}
    </div>
  );
}

const PLAYHEAD_KEY = "pnyxy:yt-playhead";
function loadPlayhead(videoId: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(PLAYHEAD_KEY) ?? "{}") as Record<string, number>;
    const v = all[videoId];
    return typeof v === "number" && v > 5 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}
let lastSave = 0;
function savePlayhead(videoId: string, seconds: number) {
  const now = Date.now();
  if (seconds !== 0 && now - lastSave < 5000) return;
  lastSave = now;
  try {
    const all = JSON.parse(localStorage.getItem(PLAYHEAD_KEY) ?? "{}") as Record<string, number>;
    if (seconds === 0) delete all[videoId];
    else all[videoId] = seconds;
    // keep the map small
    const keys = Object.keys(all);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete all[k];
    localStorage.setItem(PLAYHEAD_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Player + AI side-chat. Desktop: video column left, chat docked right.
 * Mobile: the player sticks to the top and the chat fills the rest, with
 * a header toggle to hide the chat when the student just wants to watch.
 */
function YouTubeResourceView({
  resource,
  ytId,
  chatOpen,
}: {
  resource: Resource;
  ytId: string;
  chatOpen: boolean;
}) {
  const isMobile = useIsMobile();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { currentTime, duration, seekTo } = useYouTubePlayer(iframeRef);

  // Resume where the student left off. The embed can't read YouTube's own
  // watch history, so the playhead is remembered per video here and fed
  // back through the embed's `start` parameter.
  const [startAt] = useState(() => loadPlayhead(ytId));
  useEffect(() => {
    if (currentTime > 5 && (!duration || currentTime < duration - 10)) savePlayhead(ytId, currentTime);
    else if (duration && currentTime >= duration - 10) savePlayhead(ytId, 0);
  }, [ytId, currentTime, duration]);

  const player = (
    <div className="aspect-video w-full overflow-hidden bg-black md:rounded-lg md:border md:border-glass-border">
      <iframe
        ref={iframeRef}
        src={youtubeEmbedUrl(ytId, startAt)}
        title={resource.title}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0">{player}</div>
        {chatOpen ? (
          <div className="min-h-0 flex-1">
            <ResourceChatPanel
              resource={resource}
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
              compact
              showTitle={false}
            />
          </div>
        ) : (
          resource.description && (
            <p className="p-4 text-sm text-text-secondary">{resource.description}</p>
          )
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl p-4">
          {player}
          {resource.description && (
            <p className="mt-4 text-sm text-text-secondary">{resource.description}</p>
          )}
        </div>
      </div>
      {chatOpen && (
        <div className="w-[380px] shrink-0 border-l border-glass-border xl:w-[420px]">
          <ResourceChatPanel
            resource={resource}
            currentTime={currentTime}
            duration={duration}
            onSeek={seekTo}
            compact
            showTitle={false}
          />
        </div>
      )}
    </div>
  );
}
export function ResourceViewerPage() {
  const { resourceId } = useParams<{ resourceId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resources = useResourceStore((s) => s.resources);
  const fetchResources = useResourceStore((s) => s.fetchResources);
  const [resolving, setResolving] = useState(resources.length === 0);
  const [chatOpen, setChatOpen] = useState(true);

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

  const backButton = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <ArrowLeft size={16} />
      {t("resources.back")}
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
          {t("resources.loading")}
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
            {t("resources.notFound")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/library")}
          >
            {t("resources.backToLibrary")}
          </Button>
        </div>
      </div>
    );
  }

  const host = displayHost(resource.url);
  const resourceUrlSafe = isSafeExternalUrl(resource.url);
  const openOriginal = resourceUrlSafe ? (
    <a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
    >
      <ExternalLink size={14} />
      {t("resources.openOriginal")}
    </a>
  ) : null;

  const ytId =
    resource.kind === "youtube" ? parseYouTubeId(resource.url) : null;

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
              {t("resources.beta")}
            </span>
          </div>
          <p className="truncate text-xs text-text-secondary">{host}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {((resource.kind === "youtube" && ytId) || resource.kind === "web") && (
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                chatOpen
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("resources.chat.toggle")}
            >
              <Sparkles size={14} strokeWidth={1.5} />
              <span className="hidden sm:inline">{t("resources.chat.toggle")}</span>
            </button>
          )}
          <span className="hidden sm:inline-flex">{openOriginal}</span>
        </div>
      </div>

      {/* Body */}
      {resource.kind === "youtube" && ytId ? (
        <YouTubeResourceView resource={resource} ytId={ytId} chatOpen={chatOpen} />
      ) : resource.kind === "web" ? (
        <WebResourceView resource={resource} chatOpen={chatOpen} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(
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
              {resourceUrlSafe && (
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white shadow-lg shadow-accent/25 transition-colors hover:bg-accent/80"
                >
                  <ExternalLink size={16} />
                  {t("resources.openOriginal")}
                </a>
              )}
              <p className="text-2xs text-text-muted">
                {t("resources.previewUnavailable")}
              </p>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
