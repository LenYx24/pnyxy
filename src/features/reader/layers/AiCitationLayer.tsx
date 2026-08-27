import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bot, MessageSquare } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { isFiniteRect, type AiCitation } from "@/types/annotation";
import { cn } from "@/lib/cn";

const EMPTY: AiCitation[] = [];

interface AiCitationLayerProps {
  pageNum: number;
}

/** Dotted underline under text sent to the AI; click opens a popover of the citing chats. */
export function AiCitationLayer({ pageNum }: AiCitationLayerProps) {
  const { t } = useTranslation();
  const pageCitations = useAnnotationStore(
    (s) => s.citationsByPage.get(pageNum) ?? EMPTY,
  );
  const openConversation = useChatStore((s) => s.openConversation);
  const openReaderAiChat = useUIStore((s) => s.openReaderAiChat);

  // group by selection so a passage sent twice shows one underline with a count
  const groups = useMemo(
    () => groupBySelection(pageCitations),
    [pageCitations],
  );

  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const anchorsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  if (groups.length === 0) return null;

  const handleJump = async (citation: AiCitation) => {
    setOpenGroupKey(null);
    openReaderAiChat?.();
    try {
      await openConversation(citation.conversationId);
    } catch {
      // conversation may have been deleted since the citation was saved
    }
  };

  return (
    <div
      className="absolute inset-0"
      // wrapper is click-transparent so text selection still works; underlines set pointer-events-auto
      style={{ zIndex: 4, pointerEvents: "none" }}
    >
      {groups.map((g) => {
        const key = g.key;
        const isOpen = openGroupKey === key;
        return g.rects.map((rect, i) => (
          <button
            key={`${key}-${i}`}
            ref={(el) => {
              if (i !== 0) return;
              if (el) anchorsRef.current.set(key, el);
              else anchorsRef.current.delete(key);
            }}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenGroupKey(isOpen ? null : key);
            }}
            className={cn(
              "absolute cursor-pointer transition-opacity",
              isOpen ? "opacity-100" : "opacity-70 hover:opacity-100",
            )}
            style={{
              left: `${rect.x * 100}%`,
              top: `${(rect.y + rect.height) * 100}%`,
              width: `${rect.width * 100}%`,
              height: "0.18rem",
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--color-accent, #a78bfa) 0 4px, transparent 4px 8px)",
              backgroundSize: "8px 2px",
              backgroundRepeat: "repeat-x",
              backgroundPosition: "left center",
              pointerEvents: "auto",
              transform: "translateY(-1px)",
            }}
            aria-label={t("reader.aiCitation.openPopoverAria")}
            title={
              g.items.length === 1
                ? t("reader.aiCitation.singleTitle")
                : t("reader.aiCitation.multiTitle", {
                    count: g.items.length,
                  })
            }
          >
            {i === 0 && g.items.length > 1 && (
              <span
                className="absolute right-0 top-full mt-0.5 rounded-full bg-accent px-1 text-[8px] font-bold leading-tight text-white"
                aria-hidden="true"
              >
                {g.items.length}
              </span>
            )}
          </button>
        ));
      })}

      {openGroupKey &&
        (() => {
          const group = groups.find((g) => g.key === openGroupKey);
          const anchor = anchorsRef.current.get(openGroupKey);
          if (!group || !anchor) return null;
          return (
            <OccurrencePopover
              anchor={anchor}
              items={group.items}
              onClose={() => setOpenGroupKey(null)}
              onJump={handleJump}
            />
          );
        })()}
    </div>
  );
}

interface CitationGroup {
  key: string;
  /** Shared selection rects for the group. */
  rects: AiCitation["selection"]["rects"];
  items: AiCitation[];
}

/** Collapse citations with matching rects + text into one group. */
function groupBySelection(citations: AiCitation[]): CitationGroup[] {
  const byKey = new Map<string, CitationGroup>();
  for (const c of citations) {
    const key = selectionKey(c);
    const existing = byKey.get(key);
    if (existing) existing.items.push(c);
    else
      byKey.set(key, {
        key,
        // drop NaN-coord rects so we never emit `top: NaN%` into the DOM
        rects: c.selection.rects.filter(isFiniteRect),
        items: [c],
      });
  }
  // most-recent first within each group
  for (const g of byKey.values()) {
    g.items.sort((a, b) => b.createdAt - a.createdAt);
  }
  return Array.from(byKey.values());
}

function selectionKey(c: AiCitation): string {
  // round coords to 4dp so pixel jitter between two sends still groups
  const rectKey = c.selection.rects
    .map(
      (r) =>
        `${r.pageNum}:${r.x.toFixed(4)}:${r.y.toFixed(4)}:${r.width.toFixed(4)}:${r.height.toFixed(4)}`,
    )
    .join("|");
  return `${rectKey}#${c.selection.text.trim()}`;
}

function OccurrencePopover({
  anchor,
  items,
  onClose,
  onJump,
}: {
  anchor: HTMLElement;
  items: AiCitation[];
  onClose: () => void;
  onJump: (c: AiCitation) => void;
}) {
  const { t } = useTranslation();
  // measured once on mount; scrolling lets it scroll out of view
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  const left = Math.min(rect.left, window.innerWidth - 280);

  return createPortal(
    <>
      {/* Click-outside dismiss */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        className="fixed z-[61] flex w-72 flex-col gap-1 rounded-panel bg-bg-tertiary p-1.5 shadow-page"
        style={{ top: Math.max(8, top), left: Math.max(8, left) }}
      >
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-text-muted">
          <Bot size={12} className="text-accent" />
          {t("reader.aiCitation.popoverTitle", {
            count: items.length,
          })}
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onJump(c)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-glass-hover cursor-pointer"
              >
                <MessageSquare
                  size={12}
                  className="mt-0.5 shrink-0 text-text-muted"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text-primary">
                    {c.messageSnippet ||
                      c.conversationTitle ||
                      t("reader.aiCitation.untitledMessage")}
                  </p>
                  <p className="truncate text-2xs text-text-muted">
                    {[
                      c.conversationTitle ||
                        t("reader.aiCitation.untitledConv"),
                      formatRelative(c.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>,
    document.body,
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(ts).getFullYear() !== new Date().getFullYear()
        ? "numeric"
        : undefined,
  });
}
