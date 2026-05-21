import { useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FloatingMenu } from "@/components/ui";
import { logError } from "@/lib/logger";
import type { DownloadAction } from "@/lib/library/download-entry";

/**
 * Download CTA used on the Book description page. Mirrors the library
 * card menu's behaviour but in a single button so it can sit in the
 * page's primary action row:
 *
 *  - 0 actions → renders nothing (catalog books without an IA scan
 *                or download_url stay silent rather than showing a
 *                broken / disabled control).
 *  - 1 action  → plain button that triggers it directly.
 *  - 2+ actions → button with a caret that opens a small FloatingMenu
 *                 listing each format. Used by public-domain IA scans
 *                 which carry PDF / EPUB / Plain text in parallel.
 */
export function DownloadButton({
  actions,
  variant = "secondary",
}: {
  actions: DownloadAction[];
  /** Match the surrounding action row. The Book description page
   *  mixes a single "primary" CTA (Read) with secondary outlined
   *  buttons (Generate quiz, etc.); Download stays in the secondary
   *  cluster by default. */
  variant?: "secondary" | "primary";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (actions.length === 0) return null;

  const labelFor = (a: DownloadAction) =>
    a.format === "original"
      ? t("library.actions.download", { defaultValue: "Download" })
      : t("library.actions.downloadFormat", {
          defaultValue: "Download {{format}}",
          format: a.format.toUpperCase(),
        });

  const runOne = async (action: DownloadAction) => {
    try {
      await action.run();
    } catch (err) {
      logError("book:downloadAction", err);
    }
  };

  const baseClass =
    variant === "primary"
      ? "inline-flex items-center gap-2 rounded-lg bg-accent-purple px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-purple/85 cursor-pointer"
      : "inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-5 py-2.5 text-sm font-medium text-text-primary backdrop-blur-md transition-all duration-200 hover:bg-glass-hover cursor-pointer";

  if (actions.length === 1) {
    const only = actions[0];
    return (
      <button
        type="button"
        onClick={() => void runOne(only)}
        className={baseClass}
      >
        <Download size={16} />
        {labelFor(only)}
      </button>
    );
  }

  // Multi-format: a single visible affordance with a caret. The
  // primary button text says "Download" — the format choice happens
  // inside the menu so we don't crowd the action row with one CTA per
  // file type.
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={baseClass}
      >
        <Download size={16} />
        {t("library.actions.download", { defaultValue: "Download" })}
        <ChevronDown size={14} className="text-text-muted" />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="w-44"
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => {
              setOpen(false);
              void runOne(action);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Download size={14} />
            {labelFor(action)}
          </button>
        ))}
      </FloatingMenu>
    </>
  );
}
