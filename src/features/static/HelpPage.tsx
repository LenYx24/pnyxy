import { HelpCircle } from "lucide-react";
import { Link } from "react-router";

export function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <HelpCircle size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Help</h1>
      </div>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Opening a document
          </h2>
          <p>
            Drop a file into the Library or use the upload button. PDF,
            EPUB, Markdown, and plain-text files are all supported.
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Find and replace
          </h2>
          <p>
            Inside the reader, press <kbd className="rounded bg-glass-bg px-1.5 py-0.5 text-xs">Ctrl+F</kbd>{" "}
            to search and <kbd className="rounded bg-glass-bg px-1.5 py-0.5 text-xs">Ctrl+H</kbd>{" "}
            to replace. Replace is only available for editable formats
            (text and Markdown).
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Keyboard shortcuts
          </h2>
          <p>
            A full list of shortcuts lives in{" "}
            <Link
              to="/settings/shortcuts"
              className="text-accent-purple hover:underline"
            >
              Settings → Shortcuts
            </Link>
            .
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Reporting issues
          </h2>
          <p>
            Found a bug? Reach out via the GitHub link in the footer.
          </p>
        </div>
      </section>
    </div>
  );
}
