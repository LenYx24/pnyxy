import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useCategoryStore } from "@/stores/category-store";

interface CreateCategoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateCategoryModal({ open, onClose }: CreateCategoryModalProps) {
  const categories = useCategoryStore((s) => s.categories);
  const createCategory = useCategoryStore((s) => s.createCategory);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createCategory(name.trim(), parentId || null, description.trim() || undefined);
      setName("");
      setParentId("");
      setDescription("");
      onClose();
    } catch (err) {
      // Surface the underlying message so the user can act on it.
      // Common causes: slug collision (unique constraint on
      // categories.slug, message contains "duplicate key"), empty
      // slug after stripping non-alphanumerics, profanity filter,
      // or auth/RLS rejection.
      const msg =
        err instanceof Error ? err.message : "Failed to create category.";
      if (msg.includes("duplicate key")) {
        setError("A category with this name already exists.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            New Category
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <input
            type="text"
            placeholder="Category name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
          />

          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="field w-full"
          >
            <option value="">No parent (top-level)</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.parent_id ? "\u00A0\u00A0\u2514 " : ""}{cat.name}
              </option>
            ))}
          </select>

          <textarea
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none resize-none"
          />

          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "Create Category"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
