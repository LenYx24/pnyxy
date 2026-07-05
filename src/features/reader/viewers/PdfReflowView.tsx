import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, AlertTriangle } from "lucide-react";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useIsMobile } from "@/hooks/use-media-query";
import type { ReflowedDocument } from "@/lib/pdf-reflow";

interface PdfReflowViewProps {
  documentId: string;
}

// Module-level cache of successful extractions. Re-toggling reflow on
// the same book becomes instant after the first run. We intentionally
// do NOT share in-flight promises across mounts: under React's strict
// mode the cleanup-then-rerun cycle aborts the first effect's
// controller, and a shared in-flight promise would then deliver its
// progress events to that already-aborted controller while the new
// component instance sat waiting at 0/N forever. Letting each mount
// own its own extraction keeps the bookkeeping local and trivially
// correct; the wasted dev-only work is bounded by `reflowCache`.
const reflowCache = new Map<string, ReflowedDocument>();

export function PdfReflowView({ documentId }: PdfReflowViewProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // Typography knobs are shared with EPUB so the user's font/line-
  // height preference applies in both reflowable views.
  const fontScale = useSettingsStore((s) => s.epubFontScale);
  const lineHeight = useSettingsStore((s) => s.epubLineHeight);

  const [reflow, setReflow] = useState<ReflowedDocument | null>(
    () => reflowCache.get(documentId) ?? null,
  );
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cached = reflowCache.get(documentId);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to the per-doc cache when the prop changes; one-shot, can't cascade
      setReflow(cached);
      return;
    }

    const docs = useReaderStore.getState().documents;
    const entry = docs.get(documentId);
    const adapter = entry?.adapter;
    if (!adapter?.extractReflow) {
      setError("unsupported");
      return;
    }

    setError(null);
    setReflow(null);
    setProgress({ current: 0, total: entry?.meta.totalPages ?? 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    adapter
      .extractReflow({
        signal: controller.signal,
        onProgress: (current, total) => {
          if (controller.signal.aborted) return;
          setProgress({ current, total });
        },
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        reflowCache.set(documentId, result);
        setReflow(result);
        setProgress(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "unknown");
        setProgress(null);
      });

    return () => {
      controller.abort();
    };
  }, [documentId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center text-text-secondary">
          <AlertTriangle size={28} className="text-warning" />
          <p className="text-sm">
            {error === "unsupported"
              ? t("reader.reflow.errorUnsupported")
              : t("reader.reflow.errorGeneric")}
          </p>
        </div>
      </div>
    );
  }

  if (!reflow) {
    const progressLabel = progress
      ? t("reader.reflow.progress", {
          current: progress.current,
          total: progress.total,
        })
      : t("reader.reflow.starting");
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <Loader2 size={24} className="animate-spin text-accent" />
          <p className="text-sm">{progressLabel}</p>
        </div>
      </div>
    );
  }

  if (reflow.blocks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center text-text-secondary">
          <AlertTriangle size={28} className="text-warning" />
          <p className="text-sm">{t("reader.reflow.emptyExtract")}</p>
          <p className="text-xs text-text-muted">
            {t("reader.reflow.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  const baseFontSize = isMobile ? 17 : 18;
  // Match the typographic ratios used by Pnyxy's other reflowable
  // viewer (EPUB) so users get a coherent experience across formats.
  const fontSizePx = baseFontSize * fontScale;

  return (
    <div className="h-full overflow-y-auto bg-bg-primary px-3 py-6 sm:px-6 md:px-8">
      <div
        className="mx-auto"
        style={{ maxWidth: "min(40rem, 100%)", lineHeight }}
      >
        <div className="mb-6 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">
          {t("reader.reflow.banner")}
        </div>
        {reflow.blocks.map((block, idx) => {
          // Page break appears whenever the page number changes between
          // adjacent blocks, derived purely from the array, no mutable
          // state needed across iterations.
          const prevPageNum = idx === 0 ? -1 : reflow.blocks[idx - 1].pageNum;
          const showPageBreak = block.pageNum !== prevPageNum;

          // Selectable text uses the body font, no per-block override
          // beyond size/weight so OS spell-check + accessibility tools
          // see a single coherent text flow.
          const heading1Style = {
            fontSize: `${fontSizePx * 1.6}px`,
            fontWeight: 700,
            marginTop: "1.5em",
            marginBottom: "0.5em",
          };
          const heading2Style = {
            fontSize: `${fontSizePx * 1.3}px`,
            fontWeight: 600,
            marginTop: "1.25em",
            marginBottom: "0.4em",
          };
          const paragraphStyle = {
            fontSize: `${fontSizePx}px`,
            marginBottom: "0.85em",
          };

          return (
            <div key={idx}>
              {showPageBreak && (
                <div className="my-4 flex items-center gap-2 text-2xs uppercase tracking-wide text-text-muted">
                  <span className="h-px flex-1 bg-glass-border" />
                  <span>
                    {t("reader.reflow.pageLabel", { page: block.pageNum })}
                  </span>
                  <span className="h-px flex-1 bg-glass-border" />
                </div>
              )}
              {block.type === "heading" && block.level === 1 && (
                <h2
                  style={heading1Style}
                  className="text-text-primary"
                >
                  {block.text}
                </h2>
              )}
              {block.type === "heading" && block.level === 2 && (
                <h3
                  style={heading2Style}
                  className="text-text-primary"
                >
                  {block.text}
                </h3>
              )}
              {block.type === "paragraph" && (
                <p
                  style={paragraphStyle}
                  className="text-text-secondary"
                >
                  {block.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

