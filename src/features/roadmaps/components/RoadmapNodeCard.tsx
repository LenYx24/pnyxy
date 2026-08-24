import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { BookOpen, Check, Lock, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMinutes } from "../lib/scheduler";
import { useRoadmapStore } from "@/stores/roadmap-store";
import type { ResourceRef } from "@/types/roadmap";

export interface RoadmapNodeData extends Record<string, unknown> {
  /** Roadmap this node belongs to, the inline minutes editor needs
   *  it to write back through `upsertNode` without dragging the
   *  parent component into the loop. */
  roadmapId: string;
  /** Identifier for this node within the roadmap. */
  nodeId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  /** 0-100, composite of manual + auto-detected progress. 100 reads
   *  as "complete" everywhere the node card uses to render. */
  progress: number;
  locked: boolean;
  isGoal: boolean;
  /** Top reference (the AI-cited primary book/URL), shown small on
   *  the card. Full list lives in the side panel. Optional. */
  primaryReference?: ResourceRef;
  /** When enrolled, scheduler-derived "due by" date in YYYY-MM-DD form. */
  dueDate?: string;
  /** Whether dueDate came from a manual override. */
  manualDate?: boolean;
  /** Edit mode dims the visual cues for completion/lock. */
  editMode: boolean;
  /** True when the user is enrolled and viewing (not editing), so a
   *  click on the node toggles completion. Drives the checkbox-style
   *  affordance + tooltip that make "tick this off" discoverable. */
  completable: boolean;
}

export type RoadmapXyNode = Node<RoadmapNodeData, "roadmap">;

const REF_LABEL_MAX = 28;

function refLabel(ref: ResourceRef): string {
  // Author + Title is the canonical citation form ("Cormen, Intro
  // to Algorithms"). Title-only when no author. Truncated to keep
  // the card narrow.
  const base = ref.author ? `${ref.author} - ${ref.title}` : ref.title;
  if (base.length <= REF_LABEL_MAX) return base;
  return `${base.slice(0, REF_LABEL_MAX - 1).trim()}…`;
}

/**
 * Custom xyflow node, a card showing the learning unit. Visual states:
 *   - progress >= 100 (green check, dimmed, line-through title)
 *   - 0 < progress < 100 (partial-fill progress bar at bottom)
 *   - locked (lock icon, faint)
 *   - goal (trophy in corner)
 *   - editMode (no completion/lock cues, edit chrome)
 *
 * A primary reference (first AI-cited resource) renders as a small
 * tappable badge below the description. Hover/tap drives the side
 * panel to that node where the full reference list is shown.
 */
export function RoadmapNodeCard({
  data: d,
  selected,
}: NodeProps<RoadmapXyNode>) {
  const { t } = useTranslation();
  const completed = d.progress >= 100;
  const partial = d.progress > 0 && d.progress < 100;
  const ref = d.primaryReference;
  const refMatched =
    ref?.match?.source === "library" || ref?.match?.source === "catalog";

  // Tooltip on the whole card while enrolled, so the "click a node to
  // mark it done" interaction is discoverable rather than hidden.
  const cardTitle = d.completable
    ? completed
      ? t("roadmaps.node.clickToUncheck", {
          defaultValue: "Click to mark as not done",
        })
      : t("roadmaps.node.clickToCheck", {
          defaultValue: "Click to mark as done",
        })
    : undefined;

  return (
    <div
      title={cardTitle}
      className={cn(
        "relative w-60 rounded-xl border px-3 py-2.5 text-left transition-all",
        completed
          ? "border-success/40 bg-success/10"
          : d.locked
            ? "border-glass-border/60 bg-glass-bg/40"
            : "border-glass-border bg-glass-bg",
        selected && "ring-2 ring-accent",
        d.completable && "cursor-pointer hover:border-accent/60",
        !d.editMode && d.locked && "opacity-70",
        !d.editMode && completed && "opacity-90",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-glass-border !bg-bg-secondary"
      />
      {d.isGoal && (
        <Trophy
          size={14}
          className="absolute -right-1.5 -top-1.5 rounded-full bg-bg-secondary p-0.5 text-warning"
          aria-label="Goal"
        />
      )}
      <div className="flex items-start gap-2">
        <div
          aria-label={
            d.completable
              ? completed
                ? t("roadmaps.node.done", { defaultValue: "Done" })
                : t("roadmaps.node.notDone", { defaultValue: "Not done" })
              : undefined
          }
          className={cn(
            "group/check mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
            completed
              ? "bg-success text-white"
              : d.locked
                ? "bg-glass-bg text-text-muted"
                : d.completable
                  ? "border-2 border-accent/60 bg-accent/10 text-accent hover:bg-accent/25"
                  : "bg-accent/15 text-accent",
          )}
        >
          {completed ? (
            <Check size={12} strokeWidth={3} />
          ) : d.locked ? (
            <Lock size={11} />
          ) : d.completable ? (
            // Empty checkbox that reveals a check on hover, reads as
            // "tick me off".
            <Check
              size={12}
              strokeWidth={3}
              className="opacity-0 transition-opacity group-hover/check:opacity-60"
            />
          ) : (
            <span className="block h-2 w-2 rounded-full bg-current" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium text-text-primary",
              completed && "line-through decoration-1",
            )}
          >
            {d.title || "Untitled"}
          </p>
          {d.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {d.description}
            </p>
          )}
          {ref && (
            <div
              className={cn(
                "mt-1 flex items-center gap-1 truncate text-2xs",
                refMatched ? "text-accent" : "text-text-muted",
              )}
              title={
                ref.author ? `${ref.author} - ${ref.title}` : ref.title
              }
            >
              <BookOpen size={10} className="shrink-0" />
              <span className="truncate">{refLabel(ref)}</span>
              {ref.pageRange && (
                <span className="shrink-0 text-text-muted">
                  · p{ref.pageRange.from}–{ref.pageRange.to}
                </span>
              )}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-muted">
            <MinutesPill
              roadmapId={d.roadmapId}
              nodeId={d.nodeId}
              minutes={d.estimatedMinutes}
            />
            {d.dueDate && (
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5",
                  d.manualDate
                    ? "bg-accent-blue/15 text-accent-blue"
                    : "bg-glass-bg text-text-secondary",
                )}
                title={d.manualDate ? "Manually scheduled" : "Auto-scheduled"}
              >
                {d.dueDate}
              </span>
            )}
          </div>
          {partial && !d.editMode && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-glass-bg">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${d.progress}%` }}
                aria-label={`${d.progress}% complete`}
              />
            </div>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-glass-border !bg-bg-secondary"
      />
    </div>
  );
}

/**
 * Click-to-edit minutes badge on the node card. Reads/writes the
 * roadmap through the store directly so the parent (xyflow / detail
 * page / editor) doesn't need to pass a callback. Estimates change a
 * lot in practice, a user partway through a node realises their
 * 30-minute guess is really 90, so the inline edit deliberately
 * lives outside the editor's full edit-mode flow.
 *
 * Click stops propagation so it doesn't toggle node selection /
 * complete-state. Commit on Enter or blur, cancel on Escape. xyflow's
 * built-in `.nodrag` / `.nopan` classes keep this from kicking off a
 * graph drag when the user click-and-holds inside the input.
 */
function MinutesPill({
  roadmapId,
  nodeId,
  minutes,
}: {
  roadmapId: string;
  nodeId: string;
  minutes: number;
}) {
  const updateNodeMinutes = useRoadmapStore((s) => s.updateNodeMinutes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(minutes));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(String(minutes));
  }, [minutes, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) updateNodeMinutes(roadmapId, nodeId, parsed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(String(minutes));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="nodrag nopan w-14 rounded border border-accent/60 bg-bg-secondary px-1 py-0.5 text-2xs outline-none"
        aria-label="Estimated minutes"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="nodrag nopan -mx-1 -my-0.5 cursor-text rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary"
      title="Click to edit"
    >
      {formatMinutes(minutes)}
    </button>
  );
}
