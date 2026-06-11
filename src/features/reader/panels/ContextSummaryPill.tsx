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
  onPickPages,
}: {
  tocAvailable: boolean;
  tocAttached: boolean;
  selectedPages: number;
  hasPersona: boolean;
  /** When set, the pill body + "N pages" chip toggle this inline
   *  picker instead of bouncing the user to the sidebar editor. The
   *  trailing "Customize" link still routes to the sidebar (which
   *  carries extras like select-all / send-as-image that don't live
   *  in the inline picker). Passed by AiChatPanel for PDF docs; for
   *  non-PDFs it's omitted and the sidebar editor remains the only
   *  way to edit the selection. */
  onPickPages?: () => void;
}) {
  const { t } = useTranslation();
  const openAiContextEditor = useUIStore((s) => s.openAiContextEditor);
  // Sidebar route — power-user editor with select-all / send-as-image,
  // registered by ReaderSidebar. The trailing "Customize" link routes
  // here when this is available.
  const showSidebarEditor = tocAvailable && !!openAiContextEditor;
  // Pill is interactive if there's *any* way for the user to edit the
  // selection — the inline picker counts even when the sidebar editor
  // isn't registered (e.g. dockview layouts without the sidebar) and
  // even when the doc has no TOC (the picker doesn't care). Without
  // this, PDFs without a TOC fell into the static-fallback branch and
  // the "N pages" text wasn't clickable at all.
  const interactive = !!onPickPages || showSidebarEditor;

  if (
    !tocAvailable &&
    selectedPages === 0 &&
    !hasPersona &&
    !interactive
  ) {
    return null;
  }

  // Static-text fallback: nothing the user can do here (no sidebar
  // editor registered AND no inline picker handler), so don't pretend
  // to be a click target.
  if (!interactive) {
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
        <div className="flex items-center gap-1.5 text-2xs text-text-muted">
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
  // Pill body + "N pages" chip prefer the inline picker (kept in
  // the chat panel, where the user already is) when AiChatPanel
  // supplied one. The trailing "Customize" link below always falls
  // back to the sidebar editor — it's the escape hatch for the
  // controls that don't live in the inline picker yet.
  const pickPages = onPickPages ?? openEditor;
  return (
    <div className="px-3">
      <div
        onClick={pickPages}
        role="button"
        tabIndex={-1}
        className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 text-2xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
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
            pickPages();
          }}
          className={cn(
            "shrink-0 rounded font-medium underline decoration-dotted underline-offset-2 transition-colors cursor-pointer",
            "text-text-secondary hover:text-text-primary",
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
        {/* "Customize" escape — only shown when the sidebar editor is
            registered AND distinct from the primary click action.
            Without an inline picker, the whole pill already opens the
            sidebar editor so a redundant label would just be noise;
            with one, this gives access to extras (send-as-image,
            select-all) that don't live in the inline picker. */}
        {showSidebarEditor && onPickPages && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEditor();
            }}
            className="ml-auto shrink-0 rounded text-2xs text-text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary cursor-pointer"
          >
            {t("reader.aiChat.customizeContextAction", {
              defaultValue: "Customize",
            })}
          </button>
        )}
        {showSidebarEditor && !onPickPages && (
          <span className="ml-auto shrink-0 text-2xs text-text-muted">
            {t("reader.aiChat.customizeContextAction", {
              defaultValue: "Customize",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
