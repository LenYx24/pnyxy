import { useTranslation } from "react-i18next";
import { Palette, Puzzle } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const COMMUNITY_URL = "https://github.com/LenYx24/pnyxy-community";

/** Lucide 1.x drops the GitHub mark for trademark reasons, inline
 *  SVG to stay dependency-light (same pattern as Footer.tsx). */
function GithubGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.69-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.73-1.53-2.55-.29-5.23-1.27-5.23-5.67 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.17 1.17.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.2-1.48 3.16-1.17 3.16-1.17.63 1.59.23 2.77.12 3.06.74.8 1.18 1.82 1.18 3.07 0 4.41-2.68 5.38-5.24 5.66.41.35.77 1.03.77 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.66.79.55C20.22 21.37 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

/**
 * Open-source + extensibility section. One panel states the app's MIT
 * license (no repo link on purpose), the other links the community
 * registry repo (drop-in themes & plugins). Solid panels, single accent.
 */
export function OpenSourceSection() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        eyebrow={t("landing.eyebrow.openSource")}
        title={t("landing.openSource.title")}
        subtitle={t("landing.openSource.subtitle")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex h-full flex-col rounded-xl border border-glass-border bg-bg-secondary p-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <GithubGlyph size={20} />
          </div>
          <h3 className="mb-2 font-display text-lg font-semibold text-text-primary">
            {t("landing.openSource.repo.title")}
          </h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            {t("landing.openSource.repo.description")}
          </p>
          <p className="mt-auto pt-4 font-mono text-2xs text-text-muted">
            MIT
          </p>
        </div>

        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex h-full flex-col rounded-xl border border-glass-border bg-bg-secondary p-6 transition-colors hover:border-accent/40"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <Palette size={20} />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <Puzzle size={20} />
            </div>
          </div>
          <h3 className="mb-2 font-display text-lg font-semibold text-text-primary">
            {t("landing.openSource.community.title")}
          </h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            {t("landing.openSource.community.description")}
          </p>
          <p className="mt-auto pt-4 font-mono text-2xs text-accent">
            github.com/LenYx24/pnyxy-community →
          </p>
        </a>
      </div>
    </section>
  );
}
