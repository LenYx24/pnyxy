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

/**
 * Renders a thin dotted accent-purple underline below every text rect
 * that was sent to the AI in a chat (recorded by chat-store when a
 * "Send to chat" hand-off submits). Clicking the underline opens a
 * floating popover listing every chat message the passage rode along
 * with — click an entry to switch the AI panel to that conversation.
 *
 * Visually distinct from highlights on purpose: highlights paint a
 * translucent block over the text (`mix-blend-multiply`), citations
 * draw a separate underline strip below the rect. The two can stack
 * on the same text without fighting.
 */
export function AiCitationLayer({ pageNum }: AiCitationLayerProps) {
  const { t } = useTranslation();
  const pageCitations = useAnnotationStore(
    (s) => s.citationsByPage.get(pageNum) ?? EMPTY,
  );
  const openConversation = useChatStore((s) => s.openConversation);
  const openReaderAiChat = useUIStore((s) => s.openReaderAiChat);

  // Group citations by their selection (same rects = same source
  // passage); a passage sent twice should show as one underline with
  // a count, not two stacked strips. Key by rects+text since the IDs
  // differ per send.
  const groups = useMemo(() => groupBySelection(pageCitations), [pageCitations]);

  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const anchorsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  if (groups.length === 0) return null;

  const handleJump = async (citation: AiCitation) => {
    setOpenGroupKey(null);
    // Surface the chat panel first (no-op if already visible) so the
    // user lands on the conversation they just chose, not a blank
    // reader. Then switch to the cited conversation.
    openReaderAiChat?.();
    try {
      await openConversation(citation.conversationId);
    } catch {
      // Conversation may have been deleted since the citation was
      // saved. The popover still serves as a record of "you asked
      // about this passage on <date>". Nothing else to do here.
    }
  };

  return (
    <div
      className="absolute inset-0"
      // pointer-events-auto on individual underlines below; this
      // wrapper itself is transparent to clicks so the page text
      // selection still works around the underlines.
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
            // Sit the underline just below the text rect. 1.5px
            // strip + dotted accent color reads as "marked" without
            // shouting. Hover bumps the opacity so it's discoverable
            // as interactive.
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
                "repeating-linear-gradient(90deg, var(--color-accent-purple, #a78bfa) 0 4px, transparent 4px 8px)",
              backgroundSize: "8px 2px",
              backgroundRepeat: "repeat-x",
              backgroundPosition: "left center",
              pointerEvents: "auto",
              // Translate up half-height so the strip overlaps the
              // text baseline a hair — keeps it visually attached to
              // the line above without colliding with the next line.
              transform: "translateY(-1px)",
            }}
            aria-label={t("reader.aiCitation.openPopoverAria", {
              defaultValue: "View AI conversations citing this passage",
            })}
            title={
              g.items.length === 1
                ? t("reader.aiCitation.singleTitle", {
                    defaultValue: "Sent to AI · click to view conversation",
                  })
                : t("reader.aiCitation.multiTitle", {
                    count: g.items.length,
                    defaultValue: "Sent to AI in {{count}} conversations",
                  })
            }
          >
            {i === 0 && g.items.length > 1 && (
              <span
                className="absolute right-0 top-full mt-0.5 rounded-full bg-accent-purple px-1 text-[8px] font-bold leading-tight text-white"
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
  /** Rects from the first citation in the group — every citation in
   *  the same group shares the same selection rects by construction. */
  rects: AiCitation["selection"]["rects"];
  items: AiCitation[];
}

/** Group citations whose selection rects + text match — multiple
 *  sends of the same passage collapse into one underline. */
function groupBySelection(citations: AiCitation[]): CitationGroup[] {
  const byKey = new Map<string, CitationGroup>();
  for (const c of citations) {
    const key = selectionKey(c);
    const existing = byKey.get(key);
    if (existing) existing.items.push(c);
    else
      byKey.set(key, {
        key,
        // Drop NaN-coord rects so the render layer doesn't emit
        // `top: NaN%` into the DOM (see PageRect.isFiniteRect docs).
        rects: c.selection.rects.filter(isFiniteRect),
        items: [c],
      });
  }
  // Most-recent-first inside each group so the popover lists newest
  // conversations at the top.
  for (const g of byKey.values()) {
    g.items.sort((a, b) => b.createdAt - a.createdAt);
  }
  return Array.from(byKey.values());
}

function selectionKey(c: AiCitation): string {
  // Rect coords are floats; round to 4dp so trivial pixel jitter
  // between two sends of the same selection still groups together.
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
  // Anchor to the right edge of the underline, sitting just below.
  // Same approach as FloatingMenu — measured once on mount; if the
  // user scrolls, the popover scrolls out of view (matches the
  // user's mental model of "I clicked a thing in the document").
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
        className="fixed z-[61] flex w-72 flex-col gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 p-1.5 shadow-xl backdrop-blur-md"
        style={{ top: Math.max(8, top), left: Math.max(8, left) }}
      >
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <Bot size={12} className="text-accent-purple" />
          {t("reader.aiCitation.popoverTitle", {
            count: items.length,
            defaultValue: "Sent to AI · {{count}} times",
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
                    {c.messageSnippet || c.conversationTitle ||
                      t("reader.aiCitation.untitledMessage", {
                        defaultValue: "(untitled message)",
                      })}
                  </p>
                  <p className="truncate text-[10px] text-text-muted">
                    {[
                      c.conversationTitle ||
                        t("reader.aiCitation.untitledConv", {
                          defaultValue: "Untitled chat",
                        }),
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
