import { Info } from "lucide-react";

export function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Info size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">About Pnyxy</h1>
      </div>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <p>
          Pnyxy is a modern, multi-format reading app. It supports PDF,
          EPUB, Markdown, and plain-text documents, with annotation,
          whiteboard, and search tooling built in.
        </p>
        <p>
          The project is built around an extensible plugin system and a
          themeable UI. Your library lives locally by default; cloud
          sync is optional.
        </p>
        <p>
          Have feedback or want to contribute? Reach out via the links
          in the footer.
        </p>
      </section>
    </div>
  );
}
