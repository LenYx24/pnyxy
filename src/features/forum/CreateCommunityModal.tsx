import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { useCommunityStore } from "@/stores/community-store";

interface CreateCommunityModalProps {
  open: boolean;
  onClose: () => void;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateCommunityModal({
  open,
  onClose,
}: CreateCommunityModalProps) {
  const createCommunity = useCommunityStore((s) => s.createCommunity);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slugManual, setSlugManual] = useState(false);

  if (!open) return null;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManual) {
      setSlug(slugify(value));
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await createCommunity({
        name: name.trim(),
        slug: slug || slugify(name.trim()),
        description: description.trim(),
      });
      setName("");
      setSlug("");
      setDescription("");
      setSlugManual(false);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">
            Create Community
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Linear Algebra"
              className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">
              Slug
            </label>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <span>/forum/c/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                placeholder="linear-algebra"
                className="flex-1 rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              className="h-20 w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary outline-none resize-none focus:border-accent-purple"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
            className="rounded-lg bg-accent-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-purple/80 disabled:opacity-40 cursor-pointer"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
