import { Link } from "react-router";
import { MessageSquare } from "lucide-react";

export function DiscussTab() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">Discussion</h2>
      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
        <MessageSquare size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">
          No community linked yet
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Books will be linkable to a forum community so readers can discuss
          specific passages, chapters, or the book as a whole.
        </p>
        <Link
          to="/forum"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-accent-purple hover:underline"
        >
          Browse all communities
        </Link>
      </div>
    </div>
  );
}
