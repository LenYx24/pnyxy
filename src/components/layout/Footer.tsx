import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/**
 * Inline brand glyphs — lucide-react doesn't ship GitHub/Twitter/
 * Discord for trademark reasons, so we embed minimal SVGs to stay
 * dependency-light.
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

function DiscordGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.073.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.073-.035 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.335-.955 2.42-2.157 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.335-.946 2.42-2.157 2.42z" />
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
            href="https://github.com/LenYx24/pnyxy"
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
            <DiscordGlyph size={16} />
          </a>
        </div>
      </div>

      <div className="mx-auto mt-3 max-w-6xl px-4 text-xs text-text-muted/70">
        &copy; {new Date().getFullYear()} Pnyxy Reader
      </div>
    </footer>
  );
}
