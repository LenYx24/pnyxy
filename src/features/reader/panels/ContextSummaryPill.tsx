import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

/**
 * Pill above the AI chat composer summarising the context the next message
 * carries (persona, TOC toggle, selected pages). Clicking opens the page
 * picker; when no opener is registered (e.g. /chat) it stays a passive label.
 */
export function ContextSummaryPill({
  tocAvailable,
  tocAttached,
  selectedPages,
  hasPersona,
  onPickPages,
}: {
  tocAvailable: boolean;
  tocAttached: boolean;
  selectedPages: number;
  hasPersona: boolean;
  /** Inline page picker used by the pill body + chip (PDF docs). When
   *  omitted the sidebar editor is the only way to edit the selection. */
  onPickPages?: () => void;
}) {
  const { t } = useTranslation();
  const openAiContextEditor = useUIStore((s) => s.openAiContextEditor);
  // sidebar editor (select-all / send-as-image), registered by ReaderSidebar
  const showSidebarEditor = tocAvailable && !!openAiContextEditor;
  // interactive if either the inline picker or sidebar editor can edit pages
  const interactive = !!onPickPages || showSidebarEditor;

  if (!tocAvailable && selectedPages === 0 && !hasPersona && !interactive) {
    return null;
  }

  // static-text fallback: nothing editable, so not a click target
  if (!interactive) {
    const parts: string[] = [];
    if (tocAttached && tocAvailable) parts.push(t("reader.aiChat.contextToc"));
    if (selectedPages > 0) {
      parts.push(t("reader.aiChat.contextPages", { count: selectedPages }));
    }
    if (hasPersona) parts.push(t("reader.aiChat.contextPersona"));
    const summary =
      parts.length > 0 ? parts.join(" · ") : t("reader.aiChat.contextEmpty");
    return (
      <div className="px-3">
        <div className="flex items-center gap-1.5 text-2xs text-text-muted">
          <FileText size={11} />
          <span className="truncate">{summary}</span>
        </div>
      </div>
    );
  }

  // interactive variant: the "N pages" chip is the discrete page-picker target
  const openEditor = () => openAiContextEditor?.();
  // prefer the inline picker; fall back to the sidebar editor
  const pickPages = onPickPages ?? openEditor;
  return (
    <div className="px-3">
      <div
        onClick={pickPages}
        role="button"
        tabIndex={-1}
        className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 text-2xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        title={t("reader.aiChat.customizeContext")}
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
            pickPages();
          }}
          className={cn(
            "shrink-0 rounded font-medium underline decoration-dotted underline-offset-2 transition-colors cursor-pointer",
            "text-text-secondary hover:text-text-primary",
          )}
          aria-label={t("reader.aiChat.contextPagesEditAria")}
        >
          {selectedPages > 0
            ? t("reader.aiChat.contextPages", { count: selectedPages })
            : t("reader.aiChat.contextPagesEmpty")}
        </button>
        {hasPersona && (
          <>
            <span className="text-text-muted/50">·</span>
            <span className="truncate">
              {t("reader.aiChat.contextPersona")}
            </span>
          </>
        )}
        {/* "Customize" link to the sidebar editor, only when it's distinct
            from the primary click action (i.e. an inline picker exists) */}
        {showSidebarEditor && onPickPages && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEditor();
            }}
            className="ml-auto shrink-0 rounded text-2xs text-text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary cursor-pointer"
          >
            {t("reader.aiChat.customizeContextAction")}
          </button>
        )}
        {showSidebarEditor && !onPickPages && (
          <span className="ml-auto shrink-0 text-2xs text-text-muted">
            {t("reader.aiChat.customizeContextAction")}
          </span>
        )}
      </div>
    </div>
  );
}
