import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { BookOpen, Check, Lock, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMinutes } from "../lib/scheduler";
import type { ResourceRef } from "@/types/roadmap";

export interface RoadmapNodeData extends Record<string, unknown> {
  title: string;
  description: string;
  estimatedMinutes: number;
  /** 0–100 — composite of manual + auto-detected progress. 100 reads
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
}

export type RoadmapXyNode = Node<RoadmapNodeData, "roadmap">;

const REF_LABEL_MAX = 28;

function refLabel(ref: ResourceRef): string {
  // Author + Title is the canonical citation form ("Cormen — Intro
  // to Algorithms"). Title-only when no author. Truncated to keep
  // the card narrow.
  const base = ref.author ? `${ref.author} — ${ref.title}` : ref.title;
  if (base.length <= REF_LABEL_MAX) return base;
  return `${base.slice(0, REF_LABEL_MAX - 1).trim()}…`;
}

/**
 * Custom xyflow node — a card showing the learning unit. Visual states:
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
  const completed = d.progress >= 100;
  const partial = d.progress > 0 && d.progress < 100;
  const ref = d.primaryReference;
  const refMatched =
    ref?.match?.source === "library" || ref?.match?.source === "catalog";

  return (
    <div
      className={cn(
        "relative w-60 rounded-xl border px-3 py-2.5 text-left transition-all",
        completed
          ? "border-emerald-500/40 bg-emerald-500/10"
          : d.locked
            ? "border-glass-border/60 bg-glass-bg/40"
            : "border-glass-border bg-glass-bg",
        selected && "ring-2 ring-accent-purple",
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
          className="absolute -right-1.5 -top-1.5 rounded-full bg-bg-secondary p-0.5 text-yellow-400"
          aria-label="Goal"
        />
      )}
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            completed
              ? "bg-emerald-500 text-white"
              : d.locked
                ? "bg-glass-bg text-text-muted"
                : "bg-accent-purple/15 text-accent-purple",
          )}
        >
          {completed ? (
            <Check size={12} strokeWidth={3} />
          ) : d.locked ? (
            <Lock size={11} />
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
                "mt-1 flex items-center gap-1 truncate text-[11px]",
                refMatched ? "text-accent-purple" : "text-text-muted",
              )}
              title={
                ref.author ? `${ref.author} — ${ref.title}` : ref.title
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
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
            <span>{formatMinutes(d.estimatedMinutes)}</span>
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
                className="h-full rounded-full bg-accent-purple transition-[width] duration-200 ease-out"
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
