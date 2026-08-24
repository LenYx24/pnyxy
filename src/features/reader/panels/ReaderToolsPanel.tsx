import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  BotMessageSquare,
  ExternalLink,
  Globe,
  Languages,
  Network,
  PenTool,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import type { DockviewApi, IDockviewPanelProps } from "dockview";
import type { LucideIcon } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useReaderStore } from "@/stores/reader-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { useFeatures } from "@/lib/use-features";
import { AiChatPanelContent } from "./AiChatPanel";
import { AnnotationMenuDefinePanel } from "./AnnotationMenuDefinePanel";
import { AnnotationMenuTranslatePanel } from "./AnnotationMenuTranslatePanel";
import { AnnotationMenuWikiPanel } from "./AnnotationMenuWikiPanel";
import { ConversationGraph } from "@/features/chat/ConversationGraph";
import { useReaderDockPanels } from "../use-reader-dock-panels";
import {
  ReaderNotesList,
  ReaderWhiteboardsList,
} from "./ReaderNotesWhiteboards";

/**
 * The right-side reader panel, a tab switcher over the tools that fit
 * a persistent reading side panel: AI Chat plus manual-entry Dictionary,
 * Wikipedia, and Translate lookups (the same panel bodies the text-
 * selection popover uses, here fed by a typed query instead of a
 * selection). This is what the `aiChat` dockview panel now mounts, so
 * every bit of surrounding plumbing (toggle, persisted layout, mobile
 * slide-over, "Send to AI") keeps working under its old id.
 *
 * The AI Chat body stays mounted across tab switches (behind a `hidden`)
 * so it preserves conversation/scroll state and, critically, remains
 * the sink that drains "Send to AI" drafts even while the user is on a
 * lookup tab. The lookup tabs mount lazily; their fetch/abort state is
 * cheap to recreate on re-entry.
 */

type ToolTab =
  | "chat"
  | "graph"
  | "notes"
  | "whiteboard"
  | "dictionary"
  | "wikipedia"
  | "translate";

/** Small typed-query form shared by the Dictionary and Translate tabs
 *  (the Wikipedia panel ships its own input, so it doesn't use this). */
function LookupQueryBar({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit();
      }}
      className="flex items-stretch gap-1 p-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="flex items-center gap-1 rounded bg-accent/20 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/30 cursor-pointer disabled:opacity-50"
      >
        <Search size={12} />
        {t("reader.tools.search")}
      </button>
    </form>
  );
}

export function ReaderToolsPanelContent({
  onClose,
  dockviewApi,
}: {
  onClose?: () => void;
  dockviewApi?: DockviewApi;
} = {}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<ToolTab>("chat");
  // note/whiteboard editors open as dockview panels to the right
  const dockPanels = useReaderDockPanels(dockviewApi);

  // Dictionary / Translate each keep a draft (the input) + a submitted
  // query. The lookup bodies fetch off their `selectedText` prop, so we
  // only hand them the submitted value, typing doesn't fire requests.
  const [dictDraft, setDictDraft] = useState("");
  const [dictQuery, setDictQuery] = useState("");
  const [transDraft, setTransDraft] = useState("");
  const [transQuery, setTransQuery] = useState("");

  // A fresh "Send to AI" draft means the user expects the chat, snap to
  // it so the drained quote is visible immediately (AiChatPanelContent
  // stays mounted below and does the actual draining).
  const pendingDraft = useChatStore((s) => s.pendingDraft);
  const openConversation = useChatStore((s) => s.openConversation);
  // Scope the graph to the book open in the reader.
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reaction to an external store signal (a new send-to-AI draft); can't cascade because pendingDraft only flips on user action
    if (pendingDraft) setTab("chat");
  }, [pendingDraft]);

  const handleGraphOpen = useCallback(
    (id: string) => {
      void openConversation(id);
      setTab("chat");
    },
    [openConversation],
  );

  const features = useFeatures();
  const tabs = useMemo<{ key: ToolTab; icon: LucideIcon; label: string }[]>(
    () =>
      [
        { key: "chat" as const, icon: BotMessageSquare, label: t("reader.tools.tabChat") },
        ...(features.graph
          ? [{ key: "graph" as const, icon: Network, label: t("reader.tools.tabGraph") }]
          : []),
        ...(features.notes
          ? [{ key: "notes" as const, icon: StickyNote, label: t("reader.sidebar.tabNotes") }]
          : []),
        ...(features.whiteboard
          ? [{ key: "whiteboard" as const, icon: PenTool, label: t("reader.sidebar.tabWhiteboards") }]
          : []),
        {
          key: "dictionary" as const,
          icon: BookOpen,
          label: t("reader.tools.tabDictionary"),
        },
        { key: "wikipedia" as const, icon: Globe, label: t("reader.tools.tabWikipedia") },
        {
          key: "translate" as const,
          icon: Languages,
          label: t("reader.tools.tabTranslate"),
        },
      ],
    [t, features],
  );

  const handleDictSubmit = useCallback(() => setDictQuery(dictDraft.trim()), [
    dictDraft,
  ]);
  const handleTransSubmit = useCallback(
    () => setTransQuery(transDraft.trim()),
    [transDraft],
  );

  // Mobile: the AI chat is the app's headline feature, so give it the whole
  // panel and drop the tab switcher. Dictionary / Wikipedia / Translate stay
  // reachable from the text-selection popover; here they'd only eat height
  // and add rarely-used chrome. AiChatPanelContent owns its own header (list
  // toggle / new / overflow / close), so the close button still works.
  if (isMobile) {
    return (
      <div className="flex h-full flex-col bg-bg-secondary">
        <AiChatPanelContent onClose={onClose} />
      </div>
    );
  }

  return (
    // opaque surface so the dark dockview backdrop can't bleed through and
    // wash the panel gray in light theme
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-glass-border px-1.5 py-1">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer",
                tab === key
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title={label}
            >
              <Icon size={18} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        {/* pop the chat out into its own browser tab (multi-tab reading) */}
        {tab === "chat" && (
          <a
            href="/chat"
            target="_blank"
            rel="noopener noreferrer"
            title={t("reader.tools.openInNewTab", {
              defaultValue: "Open in new tab",
            })}
            aria-label={t("reader.tools.openInNewTab", {
              defaultValue: "Open in new tab",
            })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <ExternalLink size={16} />
          </a>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.closeAria")}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* AI Chat: kept mounted so it preserves state and keeps draining
          "Send to AI" drafts while the user is on another tab. */}
      <div className={cn("min-h-0 flex-1", tab !== "chat" && "hidden")}>
        <AiChatPanelContent />
      </div>

      {tab === "graph" && (
        <ConversationGraph
          onOpen={handleGraphOpen}
          scopeDocId={activeDocumentId}
          className="min-h-0 flex-1"
        />
      )}

      {tab === "notes" && <ReaderNotesList panels={dockPanels} />}

      {tab === "whiteboard" && (
        <ReaderWhiteboardsList panels={dockPanels} />
      )}

      {tab === "dictionary" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <LookupQueryBar
            value={dictDraft}
            onChange={setDictDraft}
            onSubmit={handleDictSubmit}
            placeholder={t("reader.tools.dictionaryPlaceholder")}
          />
          {dictQuery ? (
            <AnnotationMenuDefinePanel selectedText={dictQuery} fullWidth />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-text-muted">
              {t("reader.tools.emptyDictionary")}
            </p>
          )}
        </div>
      )}

      {tab === "wikipedia" && (
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {/* The Wikipedia panel carries its own query input + lang
              toggles, so it needs no shared query bar. */}
          <AnnotationMenuWikiPanel initialQuery="" fullWidth />
        </div>
      )}

      {tab === "translate" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <LookupQueryBar
            value={transDraft}
            onChange={setTransDraft}
            onSubmit={handleTransSubmit}
            placeholder={t("reader.tools.translatePlaceholder")}
          />
          {transQuery ? (
            <AnnotationMenuTranslatePanel selectedText={transQuery} fullWidth />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-text-muted">
              {t("reader.tools.emptyTranslate")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ReaderToolsPanel(props: IDockviewPanelProps) {
  // Mirror AiChatPanel's old behaviour: the header X closes the dockview
  // panel, matching the reader toolbar's toggle button. containerApi lets
  // the Notes/Whiteboard tabs open editor panels beside the viewer.
  return (
    <ReaderToolsPanelContent
      onClose={() => props.api.close()}
      dockviewApi={props.containerApi}
    />
  );
}
