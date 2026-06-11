import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, FileText, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { useCommunityStore } from "@/stores/community-store";
import { usePostStore } from "@/stores/post-store";
import type { PostKind } from "@/types/forum";

const tabs: { key: PostKind; label: string; icon: React.ElementType }[] = [
  { key: "text", label: "Text", icon: FileText },
  { key: "link", label: "Link", icon: LinkIcon },
];

export function PostComposer() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const fetchCommunityBySlug = useCommunityStore((s) => s.fetchCommunityBySlug);
  const currentCommunity = useCommunityStore((s) => s.currentCommunity);
  const createPost = usePostStore((s) => s.createPost);

  const [kind, setKind] = useState<PostKind>("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (slug && !currentCommunity) {
      fetchCommunityBySlug(slug);
    }
  }, [slug, currentCommunity, fetchCommunityBySlug]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (kind === "link" && !linkUrl.trim()) {
      setError("URL is required for link posts.");
      return;
    }
    if (!currentCommunity) return;

    setError("");
    setSubmitting(true);
    try {
      await createPost({
        community_id: currentCommunity.id,
        title: title.trim(),
        kind,
        body_md: body.trim() || null,
        link_url: kind === "link" ? linkUrl.trim() : null,
      });
      navigate(`/forum/c/${slug}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => navigate(`/forum/c/${slug}`)}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-text-primary">New Post</h2>
          {currentCommunity && (
            <p className="text-sm text-text-muted">
              in {currentCommunity.name}
            </p>
          )}
        </div>
      </div>

      {/* Kind tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
              kind === key
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="An interesting title..."
            className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
            autoFocus
          />
        </div>

        {kind === "link" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">
              URL
            </label>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">
            {kind === "link" ? "Description (optional)" : "Body"}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your thoughts... (Markdown supported)"
            className="h-48 w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2.5 text-sm text-text-primary outline-none resize-y focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(`/forum/c/${slug}`)}>
          Cancel
        </Button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || submitting}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:opacity-40 cursor-pointer"
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </div>
    </div>
  );
}
