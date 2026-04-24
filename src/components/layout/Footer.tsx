import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react";

/**
 * Inline brand glyphs — lucide-react doesn't ship GitHub/Twitter for
 * trademark reasons, so we embed minimal SVGs to stay dependency-light.
 */
function GithubGlyph({ size = 16 }: { size?: number }) {
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

function TwitterGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Site-wide footer. Rendered on all main app routes (not the reader).
 * Link targets for social media are placeholders — swap them for the
 * real handles when they exist.
 */
export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="mt-8 border-t border-glass-border bg-bg-secondary/40 py-6 text-sm text-text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            to="/about"
            className="transition-colors hover:text-text-primary"
          >
            {t("footer.about")}
          </Link>
          <Link
            to="/privacy"
            className="transition-colors hover:text-text-primary"
          >
            {t("footer.privacy")}
          </Link>
          <Link
            to="/terms"
            className="transition-colors hover:text-text-primary"
          >
            {t("footer.terms")}
          </Link>
          <Link
            to="/help"
            className="transition-colors hover:text-text-primary"
          >
            {t("footer.help")}
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/LenYx24/pnyxy-reader"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 transition-colors hover:bg-glass-hover hover:text-text-primary"
            title="GitHub"
            aria-label="GitHub"
          >
            <GithubGlyph size={16} />
          </a>
          <a
            href="https://twitter.com/pnyxy"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 transition-colors hover:bg-glass-hover hover:text-text-primary"
            title="Twitter / X"
            aria-label="Twitter"
          >
            <TwitterGlyph size={16} />
          </a>
          <a
            href="https://discord.gg/pnyxy"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 transition-colors hover:bg-glass-hover hover:text-text-primary"
            title="Discord"
            aria-label="Discord"
          >
            <MessageCircle size={16} />
          </a>
        </div>
      </div>

      <div className="mx-auto mt-3 max-w-6xl px-4 text-xs text-text-muted/70">
        &copy; {new Date().getFullYear()} Pnyxy Reader
      </div>
    </footer>
  );
}
