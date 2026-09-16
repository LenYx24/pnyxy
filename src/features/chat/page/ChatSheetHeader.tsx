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
  ArrowDownToLine,
  Check,
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
import { useSettingsStore } from "@/stores/settings-store";
import { ContextInspectorModal } from "../ContextInspectorModal";
import { ChatGraphOverlay } from "./ChatGraphOverlay";
import { ChatModelPickerContainer } from "../composer/ChatModelPickerContainer";

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
  /** The chat tab bar is showing below the header: push the floating
   *  desktop header down by its height so the title never covers the tabs. */
  hasTabs?: boolean;
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
  hasTabs = false,
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
  const autoScrollStreaming = useSettingsStore(
    (s) => s.chatAutoScrollStreaming,
  );
  const setAutoScrollStreaming = useSettingsStore(
    (s) => s.setChatAutoScrollStreaming,
  );

  // header overflow entries, shared by the desktop and mobile kebabs.
  // On mobile the context-inspector (eye) lives in this menu instead of its own
  // button, so pass includeInspector there; desktop keeps its standalone eye.
  const renderOverflowItems = (
    close: () => void,
    opts?: { includeInspector?: boolean },
  ) => (
    <>
      {opts?.includeInspector && (
        <button
          type="button"
          onClick={() => {
            close();
            setInspectorOpen(true);
          }}
          className={menuRowClass}
          aria-haspopup="dialog"
        >
          <Eye size={16} strokeWidth={1.5} />
          {t("chat.contextInspector.open")}
        </button>
      )}
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
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={autoScrollStreaming}
        onClick={() => setAutoScrollStreaming(!autoScrollStreaming)}
        className={menuRowClass}
      >
        <ArrowDownToLine size={16} strokeWidth={1.5} />
        <span className="flex-1">{t("chat.autoScrollStreaming")}</span>
        {autoScrollStreaming && (
          <Check size={15} strokeWidth={2} className="text-accent" />
        )}
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
      <div
        className={`pointer-events-none absolute inset-x-0 ${hasTabs ? "top-9" : "top-0"} z-10 hidden items-center gap-2.5 bg-gradient-to-b from-bg-secondary via-bg-secondary/85 to-transparent px-7 pb-5 pt-3 sm:flex [&>*]:pointer-events-auto`}
      >
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

      {/* mobile header: the only top bar on /chat. Gemini-style, roomy tap
          targets. Order: hamburger (drawer) · model picker (center, replaces
          the conversation title) · new chat · overflow (holds the context
          inspector). Owns the safe-area top inset itself. */}
      <div
        className="flex items-center gap-0.5 px-1.5 pb-2 sm:hidden"
        style={{ paddingTop: "calc(0.5rem + var(--spacing-safe-top, 0px))" }}
      >
        <IconButton
          size="md"
          className="h-11 w-11"
          onClick={onOpenDrawer}
          aria-label={t("chat.title")}
        >
          <Menu size={24} strokeWidth={1.5} />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <ChatModelPickerContainer />
        </div>
        <Tooltip
          label={t("chat.newConversation")}
          shortcut="chat:new"
          side="bottom"
        >
          <IconButton
            size="md"
            className="h-11 w-11"
            onClick={onNew}
            aria-label={t("chat.newConversation")}
            data-tour="chat-new"
          >
            <SquarePen size={22} strokeWidth={1.5} />
          </IconButton>
        </Tooltip>
        <span ref={overflowAnchorMobileRef} className="inline-flex">
          <IconButton
            size="md"
            className="h-11 w-11"
            onClick={() => setOverflowOpenMobile((v) => !v)}
            aria-label={t("settings.aiSection.moreActions")}
          >
            <MoreHorizontal size={22} strokeWidth={1.5} />
          </IconButton>
        </span>
        <FloatingMenu
          open={overflowOpenMobile}
          anchorRef={overflowAnchorMobileRef}
          onClose={() => setOverflowOpenMobile(false)}
        >
          {renderOverflowItems(() => setOverflowOpenMobile(false), {
            includeInspector: true,
          })}
        </FloatingMenu>
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
