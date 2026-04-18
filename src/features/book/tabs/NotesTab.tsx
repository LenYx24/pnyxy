import { StickyNote } from "lucide-react";

export function NotesTab() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">
        Your notes and highlights
      </h2>
      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
        <StickyNote size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Coming soon</p>
        <p className="mt-1 text-xs text-text-muted">
          Every highlight, comment, and note you've made in this book will be
          summarized here.
        </p>
      </div>
    </div>
  );
}
