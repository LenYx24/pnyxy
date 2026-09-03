/**
 * Top of the sheet: the desktop title bar (title, book subtitle, kebab)
 * and the mobile top bar (drawer hamburger, title, kebab, new chat). Both
 * kebabs share one menu: graph (feature-gated), export Markdown, quotas.
 * Also mounts the graph overlay it opens.
 */
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Download,
  Eye,
  Gauge,
  Menu,
  MoreHorizontal,
  Network,
  SquarePen,
} from "lucide-react";
import { FloatingMenu, IconButton, Tooltip } from "@/components/ui";
import { useFeature } from "@/lib/use-features";
import { ContextInspectorModal } from "../ContextInspectorModal";
import { ChatGraphOverlay } from "./ChatGraphOverlay";

const menuRowClass =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer";

interface ChatSheetHeaderProps {
  activeTitle: string;
  /** Book subtitle after the title, when the thread is about a book. */
  headerBook?: string;
  /** Export entry is offered only while a conversation is open. */
  canExport: boolean;
  onExport: () => void;
  onNew: () => void;
  /** Mobile: opens the conversation drawer. */
  onOpenDrawer: () => void;
  scopeDocId?: string;
  /** Incognito conversation: show the Temporary chip. */
  isTemporary?: boolean;
  /** Source document of the active conversation, for the context inspector
   *  (the active conversation's own source_doc_id when set, else the
   *  page's scope). May differ from `scopeDocId`, which only reflects the
   *  route scope and is used for the graph overlay. */
  docId?: string | null;
  /** Active conversation id, for the context inspector's history layer. */
  conversationId?: string | null;
}

export function ChatSheetHeader({
  activeTitle,
  isTemporary = false,
  headerBook,
  canExport,
  onExport,
  onNew,
  onOpenDrawer,
  scopeDocId,
  docId = null,
  conversationId = null,
}: ChatSheetHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const graphEnabled = useFeature("graph");

  // separate overflow-menu state for desktop and mobile
  const overflowAnchorRef = useRef<HTMLSpanElement>(null);
  const overflowAnchorMobileRef = useRef<HTMLSpanElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowOpenMobile, setOverflowOpenMobile] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // header overflow entries, shared by the desktop and mobile kebabs
  const renderOverflowItems = (close: () => void) => (
    <>
      {graphEnabled && (
        <button
          type="button"
          onClick={() => {
            close();
            setShowGraph(true);
          }}
          className={menuRowClass}
        >
          <Network size={16} strokeWidth={1.5} />
          {t("chat.graph.title")}
        </button>
      )}
      {canExport && (
        <button
          type="button"
          onClick={() => {
            close();
            onExport();
          }}
          className={menuRowClass}
        >
          <Download size={16} strokeWidth={1.5} />
          {t("chat.exportMarkdown")}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          close();
          navigate("/settings/ai");
        }}
        className={menuRowClass}
      >
        <Gauge size={16} strokeWidth={1.5} />
        {t("settings.aiSection.openQuotas")}
      </button>
    </>
  );

  return (
    <>
      {graphEnabled && showGraph && (
        <ChatGraphOverlay
          scopeDocId={scopeDocId}
          onClose={() => setShowGraph(false)}
        />
      )}

      {/* desktop sheet header: floats over the thread (Gemini-style) so the
          text uses the full height; a short gradient keeps the title legible */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 hidden items-center gap-2.5 bg-gradient-to-b from-bg-secondary via-bg-secondary/85 to-transparent px-7 pb-5 pt-3 sm:flex [&>*]:pointer-events-auto">
        <span
          className="min-w-0 truncate font-display text-base font-semibold text-text-primary"
          title={activeTitle}
        >
          {activeTitle}
        </span>
        {headerBook && (
          <span
            className="min-w-0 truncate text-xs text-text-muted"
            title={headerBook}
          >
            · {headerBook}
          </span>
        )}
        {isTemporary && (
          <span
            className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-2xs font-medium text-text-muted"
            title={t("chat.temporary.hint")}
          >
            {t("chat.temporary.chip")}
          </span>
        )}
        <div className="flex-1" />
        <IconButton
          size="sm"
          onClick={() => setInspectorOpen(true)}
          aria-label={t("chat.contextInspector.open")}
          title={t("chat.contextInspector.open")}
          aria-haspopup="dialog"
        >
          <Eye size={18} strokeWidth={1.5} />
        </IconButton>
        <span ref={overflowAnchorRef} className="inline-flex">
          <IconButton
            size="sm"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label={t("settings.aiSection.moreActions")}
            title={t("settings.aiSection.moreActions")}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </IconButton>
        </span>
        <FloatingMenu
          open={overflowOpen}
          anchorRef={overflowAnchorRef}
          onClose={() => setOverflowOpen(false)}
        >
          {renderOverflowItems(() => setOverflowOpen(false))}
        </FloatingMenu>
      </div>

      {/* mobile header: the only top bar on /chat. hamburger opens the
          conversation drawer. owns the safe-area top inset itself. */}
      <div
        className="flex items-center gap-1 px-2 pb-2 sm:hidden"
        style={{ paddingTop: "calc(0.5rem + var(--spacing-safe-top, 0px))" }}
      >
        <IconButton
          size="sm"
          onClick={onOpenDrawer}
          aria-label={t("chat.title")}
        >
          <Menu size={20} strokeWidth={1.5} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate px-1 font-display text-[15px] font-semibold text-text-primary">
          {activeTitle}
        </span>
        <IconButton
          size="sm"
          onClick={() => setInspectorOpen(true)}
          aria-label={t("chat.contextInspector.open")}
        >
          <Eye size={20} strokeWidth={1.5} />
        </IconButton>
        <span ref={overflowAnchorMobileRef} className="inline-flex">
          <IconButton
            size="sm"
            onClick={() => setOverflowOpenMobile((v) => !v)}
            aria-label={t("settings.aiSection.moreActions")}
          >
            <MoreHorizontal size={20} strokeWidth={1.5} />
          </IconButton>
        </span>
        <FloatingMenu
          open={overflowOpenMobile}
          anchorRef={overflowAnchorMobileRef}
          onClose={() => setOverflowOpenMobile(false)}
        >
          {renderOverflowItems(() => setOverflowOpenMobile(false))}
        </FloatingMenu>
        <Tooltip
          label={t("chat.newConversation")}
          shortcut="chat:new"
          side="bottom"
        >
          <IconButton
            size="sm"
            onClick={onNew}
            aria-label={t("chat.newConversation")}
            data-tour="chat-new"
          >
            <SquarePen size={20} strokeWidth={1.5} />
          </IconButton>
        </Tooltip>
      </div>

      <ContextInspectorModal
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        docId={docId}
        docTitle={headerBook ?? null}
        conversationId={conversationId}
      />
    </>
  );
}
