import { Link as LinkIcon } from "lucide-react";

export function ResourcesTab() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">
        External resources
      </h2>
      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
        <LinkIcon size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Coming soon</p>
        <p className="mt-1 text-xs text-text-muted">
          Lecture recordings, companion articles, author interviews, and
          community-curated links will appear here.
        </p>
      </div>
    </div>
  );
}
