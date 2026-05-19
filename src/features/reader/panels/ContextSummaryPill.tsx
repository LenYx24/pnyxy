import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

/**
 * Pill above the AI chat composer that summarises the context the
 * next message will carry. Mirrors the chat-store's send-time logic
 * (Settings → AI persona, the per-book TOC toggle, the user's
 * manually-selected pages from the TOC selection mode), so the user
 * can verify what's about to ship without reading our code.
 *
 * Doubles as a "Customize context" entry point — clicking it (or
 * the trailing pencil) opens the sidebar's thumbnail TOC in page-
 * selection mode. The opener function is registered by
 * `ReaderSidebar`; on surfaces where it's null (e.g. the standalone
 * `/chat` page) the pill stays as a passive label.
 */
export function ContextSummaryPill({
  tocAvailable,
  tocAttached,
  selectedPages,
  hasPersona,
}: {
  tocAvailable: boolean;
  tocAttached: boolean;
  selectedPages: number;
  hasPersona: boolean;
}) {
  const { t } = useTranslation();
  const openAiContextEditor = useUIStore((s) => s.openAiContextEditor);
  // Only show the customize entry point when there's a book in scope
  // (the page selection only makes sense then) AND the reader
  // actually registered an opener. /chat without a doc → no pill at
  // all.
  const showEditor = tocAvailable && !!openAiContextEditor;

  if (!tocAvailable && selectedPages === 0 && !hasPersona && !showEditor) {
    return null;
  }

  // Static-text fallback: rendered when there's no editor to open (we
  // can't take the user anywhere actionable, so don't pretend to).
  if (!showEditor) {
    const parts: string[] = [];
    if (tocAttached && tocAvailable) parts.push(t("reader.aiChat.contextToc"));
    if (selectedPages > 0) {
      parts.push(t("reader.aiChat.contextPages", { count: selectedPages }));
    }
    if (hasPersona) parts.push(t("reader.aiChat.contextPersona"));
    const summary =
      parts.length > 0
        ? parts.join(" · ")
        : t("reader.aiChat.contextEmpty");
    return (
      <div className="px-3">
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <FileText size={11} />
          <span className="truncate">{summary}</span>
        </div>
      </div>
    );
  }

  // Interactive variant: each part is a discrete element so the
  // "N pages" chip can read as the obvious entry point to the page
  // picker. Previously the whole pill was one big button and users
  // didn't realize the page count was the click target. Now the chip
  // carries the accent color + dotted underline, the rest stays
  // muted, and bare-space clicks still open the editor as a forgiving
  // fallback.
  const openEditor = () => openAiContextEditor?.();
  return (
    <div className="px-3">
      <div
        onClick={openEditor}
        role="button"
        tabIndex={-1}
        className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 text-[10px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        title={t("reader.aiChat.customizeContext", {
          defaultValue: "Customize what pages get sent to the AI",
        })}
      >
        <FileText size={11} className="shrink-0" />
        {tocAttached && tocAvailable && (
          <>
            <span className="truncate">{t("reader.aiChat.contextToc")}</span>
            {(selectedPages > 0 || hasPersona) && (
              <span className="text-text-muted/50">·</span>
            )}
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openEditor();
          }}
          className={cn(
            "shrink-0 rounded font-medium underline decoration-dotted underline-offset-2 transition-colors cursor-pointer",
            "text-accent-purple hover:text-accent-purple/80",
          )}
          aria-label={t("reader.aiChat.contextPagesEditAria", {
            defaultValue: "Choose which pages get sent to the AI",
          })}
        >
          {selectedPages > 0
            ? t("reader.aiChat.contextPages", { count: selectedPages })
            : t("reader.aiChat.contextPagesEmpty", {
                defaultValue: "Pick pages",
              })}
        </button>
        {hasPersona && (
          <>
            <span className="text-text-muted/50">·</span>
            <span className="truncate">{t("reader.aiChat.contextPersona")}</span>
          </>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-accent-purple/80">
          {t("reader.aiChat.customizeContextAction", {
            defaultValue: "Customize",
          })}
        </span>
      </div>
    </div>
  );
}
