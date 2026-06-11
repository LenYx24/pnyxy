import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  GraduationCap,
  Loader2,
  Newspaper,
  Plus,
  Trash2,
  Video,
  FileText,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useConfirm } from "@/hooks/use-confirm";
import { useBook } from "../BookPageContext";

type ResourceKind = "video" | "article" | "course" | "document" | "other";

interface ExternalResource {
  id: string;
  url: string;
  title: string | null;
  kind: ResourceKind;
  created_at: string;
}

const KIND_META: Record<
  ResourceKind,
  { icon: typeof Video; label: string; tone: string }
> = {
  video: { icon: Video, label: "Video", tone: "text-danger" },
  course: {
    icon: GraduationCap,
    label: "Course",
    tone: "text-warning",
  },
  article: { icon: Newspaper, label: "Article", tone: "text-blue-400" },
  document: { icon: FileText, label: "Document", tone: "text-violet-400" },
  other: { icon: LinkIcon, label: "Link", tone: "text-text-muted" },
};

/** Best-effort URL classification. The model is just a hint for the
 *  list icon — the user can edit it later. We default to 'article'
 *  for ordinary http(s) URLs (most "other" things people paste are
 *  blog posts) and 'other' only when nothing matches AND the URL
 *  shape is unusual.
 */
function classifyUrl(url: string): ResourceKind {
  let host = "";
  let pathname = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    pathname = u.pathname.toLowerCase();
  } catch {
    return "other";
  }

  const VIDEO_HOSTS = [
    "youtube.com",
    "youtu.be",
    "m.youtube.com",
    "vimeo.com",
    "twitch.tv",
  ];
  if (VIDEO_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return "video";
  }

  const COURSE_HOSTS = [
    "coursera.org",
    "edx.org",
    "udemy.com",
    "khanacademy.org",
    "ocw.mit.edu",
    "brilliant.org",
    "pluralsight.com",
    "udacity.com",
    "futurelearn.com",
  ];
  if (COURSE_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return "course";
  }

  if (
    pathname.endsWith(".pdf") ||
    host === "arxiv.org" ||
    host.endsWith(".arxiv.org")
  ) {
    return "document";
  }

  return "article";
}

/** Pull a friendly default title from the URL when the user didn't
 *  give us one. Falls back to the bare host so the list still has
 *  *something* to show.
 */
function deriveTitle(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname === "youtu.be") {
      const v = u.searchParams.get("v");
      if (v) return `YouTube · ${v}`;
      return "YouTube video";
    }
    const lastSegment = u.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      return decodeURIComponent(lastSegment).replace(/[-_]/g, " ");
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResourcesTab() {
  const { t } = useTranslation();
  const data = useBook();
  const user = useAuthStore((s) => s.user);
  const { confirm, ConfirmModalElement } = useConfirm();

  const [resources, setResources] = useState<ExternalResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [formTitle, setFormTitle] = useState("");

  const targetCol =
    data.source === "catalog" ? "catalog_book_id" : "book_id";
  const targetId = data.book.id;

  // Initial fetch + refetch on book change.
  useEffect(() => {
    if (!user) {
      setResources([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data: rows, error: err } = await supabase
        .from("book_external_resources")
        .select("id, url, title, kind, created_at")
        .eq("user_id", user.id)
        .eq(targetCol, targetId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (err) {
        logError("ResourcesTab:fetch", err);
        setError(err.message);
        setLoading(false);
        return;
      }
      setResources((rows ?? []) as ExternalResource[]);
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, targetCol, targetId]);

  const handleAdd = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!user) return;
      const trimmedUrl = formUrl.trim();
      if (!trimmedUrl) return;
      // Quick URL sanity check — defer the deep validation to the
      // browser when the user clicks through.
      try {
        new URL(trimmedUrl);
      } catch {
        setError(
          t("book.resources.errorBadUrl", {
            defaultValue: "That doesn't look like a valid URL.",
          }),
        );
        return;
      }

      setAdding(true);
      setError(null);
      const kind = classifyUrl(trimmedUrl);
      const finalTitle = formTitle.trim() || deriveTitle(trimmedUrl);
      const insertRow: Record<string, unknown> = {
        user_id: user.id,
        url: trimmedUrl,
        title: finalTitle,
        kind,
      };
      insertRow[targetCol] = targetId;

      const { data: row, error: err } = await supabase
        .from("book_external_resources")
        .insert(insertRow)
        .select("id, url, title, kind, created_at")
        .single();
      if (err) {
        logError("ResourcesTab:insert", err);
        setError(err.message);
        setAdding(false);
        return;
      }
      setResources((prev) => [row as ExternalResource, ...prev]);
      setFormUrl("");
      setFormTitle("");
      setShowForm(false);
      setAdding(false);
    },
    [user, formUrl, formTitle, targetCol, targetId, t],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: t("book.resources.deleteTitle", {
          defaultValue: "Remove this resource?",
        }),
        body: t("book.resources.deleteBody", {
          defaultValue:
            "The link is removed only from your library — the original page is untouched.",
        }),
        confirmLabel: t("common.delete", { defaultValue: "Delete" }),
        danger: true,
      });
      if (!ok) return;
      const previous = resources;
      setResources((prev) => prev.filter((r) => r.id !== id));
      const { error: err } = await supabase
        .from("book_external_resources")
        .delete()
        .eq("id", id);
      if (err) {
        logError("ResourcesTab:delete", err);
        setResources(previous); // revert
        setError(err.message);
      }
    },
    [confirm, resources, t],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t("book.resources.heading", {
              defaultValue: "External resources",
            })}
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.resources.description", {
              defaultValue:
                "Companion videos, articles, courses you've found useful for this book. Private to you.",
            })}
          </p>
        </div>
        {!showForm && (
          <Button
            variant="secondary"
            onClick={() => setShowForm(true)}
            className="shrink-0"
          >
            <Plus size={14} />
            {t("book.resources.add", { defaultValue: "Add link" })}
          </Button>
        )}
      </header>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="space-y-2 rounded-xl border border-glass-border bg-glass-bg/30 p-4"
        >
          <div>
            <label
              htmlFor="resource-url"
              className="mb-1 block text-xs font-medium text-text-secondary"
            >
              {t("book.resources.url", { defaultValue: "URL" })}
            </label>
            <input
              id="resource-url"
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
              disabled={adding}
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <label
              htmlFor="resource-title"
              className="mb-1 block text-xs font-medium text-text-secondary"
            >
              {t("book.resources.titleField", {
                defaultValue: "Title (optional)",
              })}
            </label>
            <input
              id="resource-title"
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder={t("book.resources.titlePlaceholder", {
                defaultValue: "Auto-detected from URL if blank",
              })}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
              disabled={adding}
              autoComplete="off"
            />
          </div>
          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setFormUrl("");
                setFormTitle("");
                setError(null);
              }}
              disabled={adding}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={adding || !formUrl.trim()}>
              {adding ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t("book.resources.save", { defaultValue: "Add" })}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
          <LinkIcon size={24} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.resources.emptyTitle", {
              defaultValue: "Nothing linked yet",
            })}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.resources.emptyHint", {
              defaultValue:
                "Add YouTube videos, articles, or course pages tied to this book.",
            })}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {resources.map((r) => (
            <ResourceRow
              key={r.id}
              resource={r}
              onDelete={() => void handleDelete(r.id)}
            />
          ))}
        </ul>
      )}

      {ConfirmModalElement}
    </div>
  );
}

function ResourceRow({
  resource,
  onDelete,
}: {
  resource: ExternalResource;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  // Defensive: server-side check constrains kind, but a future schema
  // tweak could surface a value the renderer doesn't recognise.
  const kindMeta = KIND_META[resource.kind] ?? KIND_META.other;
  const Icon = kindMeta.icon;

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-glass-border bg-glass-bg/30 p-3 transition-colors hover:bg-glass-hover">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-primary/40 ${kindMeta.tone}`}
      >
        <Icon size={16} />
      </div>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 cursor-pointer"
        title={resource.title ?? resource.url}
      >
        <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent">
          {resource.title || resource.url}
        </p>
        <p className="truncate text-xs text-text-muted">{resource.url}</p>
      </a>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        className="hidden rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer sm:inline-flex"
        title={t("book.resources.open", { defaultValue: "Open in new tab" })}
        aria-label={t("book.resources.open", {
          defaultValue: "Open in new tab",
        })}
      >
        <ExternalLink size={14} />
      </a>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer"
        title={t("common.delete", { defaultValue: "Delete" })}
        aria-label={t("common.delete", { defaultValue: "Delete" })}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
