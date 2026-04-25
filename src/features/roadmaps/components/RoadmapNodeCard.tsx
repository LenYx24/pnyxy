import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Check, Lock, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMinutes } from "../lib/scheduler";

export interface RoadmapNodeData extends Record<string, unknown> {
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  locked: boolean;
  isGoal: boolean;
  /** When enrolled, scheduler-derived "due by" date in YYYY-MM-DD form. */
  dueDate?: string;
  /** Whether dueDate came from a manual override. */
  manualDate?: boolean;
  /** Edit mode dims the visual cues for completion/lock. */
  editMode: boolean;
}

export type RoadmapXyNode = Node<RoadmapNodeData, "roadmap">;

/**
 * Custom xyflow node — a card showing the learning unit. Visual states:
 *   - completed (green check, dimmed)
 *   - locked (lock icon, faint)
 *   - goal (trophy in corner)
 *   - editMode (no completion/lock cues, edit chrome)
 */
export function RoadmapNodeCard({
  data: d,
  selected,
}: NodeProps<RoadmapXyNode>) {
  return (
    <div
      className={cn(
        "relative w-60 rounded-xl border px-3 py-2.5 text-left transition-all",
        // Background + border based on state.
        d.completed
          ? "border-emerald-500/40 bg-emerald-500/10"
          : d.locked
            ? "border-glass-border/60 bg-glass-bg/40"
            : "border-glass-border bg-glass-bg",
        selected && "ring-2 ring-accent-purple",
        // Visually dim locked/completed cards in viewer mode only.
        !d.editMode && d.locked && "opacity-70",
        !d.editMode && d.completed && "opacity-90",
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
            d.completed
              ? "bg-emerald-500 text-white"
              : d.locked
                ? "bg-glass-bg text-text-muted"
                : "bg-accent-purple/15 text-accent-purple",
          )}
        >
          {d.completed ? (
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
              d.completed && "line-through decoration-1",
            )}
          >
            {d.title || "Untitled"}
          </p>
          {d.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {d.description}
            </p>
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
