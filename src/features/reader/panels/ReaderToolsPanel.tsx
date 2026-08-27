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
import {
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui/classes";
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
      className="flex items-center gap-1 px-3 py-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field min-w-0 flex-1 px-3 py-1.5 text-xs"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="chip inline-flex items-center gap-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-50"
      >
        <Search size={14} strokeWidth={1.5} />
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
    () => [
      {
        key: "chat" as const,
        icon: BotMessageSquare,
        label: t("reader.tools.tabChat"),
      },
      ...(features.graph
        ? [
            {
              key: "graph" as const,
              icon: Network,
              label: t("reader.tools.tabGraph"),
            },
          ]
        : []),
      ...(features.notes
        ? [
            {
              key: "notes" as const,
              icon: StickyNote,
              label: t("reader.sidebar.tabNotes"),
            },
          ]
        : []),
      ...(features.whiteboard
        ? [
            {
              key: "whiteboard" as const,
              icon: PenTool,
              label: t("reader.sidebar.tabWhiteboards"),
            },
          ]
        : []),
      {
        key: "dictionary" as const,
        icon: BookOpen,
        label: t("reader.tools.tabDictionary"),
      },
      {
        key: "wikipedia" as const,
        icon: Globe,
        label: t("reader.tools.tabWikipedia"),
      },
      {
        key: "translate" as const,
        icon: Languages,
        label: t("reader.tools.tabTranslate"),
      },
    ],
    [t, features],
  );

  const handleDictSubmit = useCallback(
    () => setDictQuery(dictDraft.trim()),
    [dictDraft],
  );
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
      <div className="flex h-full flex-col bg-bg-primary">
        <AiChatPanelContent onClose={onClose} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Caption row: "Margin" + the tools as a compact segmented control */}
      <div className="flex items-center gap-2 pl-3 pr-2 pb-1 pt-3.5">
        <span className="shrink-0 px-1 text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
          {t("reader.tools.margin")}
        </span>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className={cn(segmentedGroupClass, "w-max")}>
            {tabs.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  segmentedItemClass,
                  "flex items-center gap-1.5 py-1",
                  tab === key
                    ? cn("px-2.5", segmentedItemActiveClass)
                    : "px-1.5",
                )}
                title={label}
                aria-label={label}
                aria-pressed={tab === key}
              >
                <Icon size={16} strokeWidth={1.5} />
                {tab === key && (
                  <span className="whitespace-nowrap">{label}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        {/* pop the chat out into its own browser tab (multi-tab reading) */}
        {tab === "chat" && (
          <a
            href="/chat"
            target="_blank"
            rel="noopener noreferrer"
            title={t("reader.tools.openInNewTab")}
            aria-label={t("reader.tools.openInNewTab")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
          >
            <ExternalLink size={16} strokeWidth={1.5} />
          </a>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted-2 transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.closeAria")}
          >
            <X size={16} strokeWidth={1.5} />
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

      {tab === "whiteboard" && <ReaderWhiteboardsList panels={dockPanels} />}

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
            <p className="px-3 py-6 text-center text-xs text-text-muted-2">
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
            <p className="px-3 py-6 text-center text-xs text-text-muted-2">
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
