import type {
  Enrollment,
  Roadmap,
  RoadmapNode,
  SchedulePrefs,
} from "@/types/roadmap";
import { topologicalOrder } from "./auto-layout";

/** YYYY-MM-DD in local time. Avoid Date.toISOString() — that uses UTC. */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

function hoursOnDate(d: Date, prefs: SchedulePrefs): number {
  if (isWeekend(d)) return prefs.workOnWeekends ? prefs.weekendHours : 0;
  return prefs.weekdayHours;
}

export interface NodeSchedule {
  /** Date by which the user is projected to finish this node. */
  dueDate: string;
  /** Whether the date came from a manual override (vs. computed). */
  manual: boolean;
}

/**
 * Walks the roadmap in topological order and allocates each node's estimated
 * minutes against the daily hours budget. A node that exceeds the day's
 * remaining budget rolls into the next day. Manual overrides pin nodes
 * absolutely; we don't try to reflow around them — the user knows best.
 */
export function computeSchedule(
  roadmap: Roadmap,
  enrollment: Enrollment,
): Map<string, NodeSchedule> {
  const result = new Map<string, NodeSchedule>();
  const order = topologicalOrder(roadmap.nodes, roadmap.edges);

  let cursor = parseYmd(enrollment.startDate);
  let minutesLeftToday = hoursOnDate(cursor, enrollment.schedulePrefs) * 60;
  // Don't let an empty schedule (0 weekday hours, no weekends) loop forever.
  const totalDailyMinutes =
    enrollment.schedulePrefs.weekdayHours * 60 +
    (enrollment.schedulePrefs.workOnWeekends
      ? enrollment.schedulePrefs.weekendHours * 60 * 2
      : 0);
  if (totalDailyMinutes <= 0) {
    // No time allocated anywhere — pin everything to startDate.
    const today = enrollment.startDate;
    for (const node of order) {
      result.set(node.id, {
        dueDate:
          enrollment.schedulePrefs.nodeDateOverrides[node.id] ?? today,
        manual: !!enrollment.schedulePrefs.nodeDateOverrides[node.id],
      });
    }
    return result;
  }

  const advanceDay = () => {
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    minutesLeftToday = hoursOnDate(cursor, enrollment.schedulePrefs) * 60;
  };

  for (const node of order) {
    const override = enrollment.schedulePrefs.nodeDateOverrides[node.id];
    if (override) {
      result.set(node.id, { dueDate: override, manual: true });
      continue;
    }

    let remaining = Math.max(node.estimatedMinutes, 1);
    while (remaining > 0 && minutesLeftToday <= 0) advanceDay();
    while (remaining > minutesLeftToday) {
      remaining -= minutesLeftToday;
      advanceDay();
      while (minutesLeftToday <= 0) advanceDay();
    }
    minutesLeftToday -= remaining;
    result.set(node.id, { dueDate: ymd(cursor), manual: false });
  }

  return result;
}

/** Total estimated minutes across the whole roadmap. */
export function totalEstimatedMinutes(roadmap: Roadmap): number {
  return roadmap.nodes.reduce(
    (sum, n) => sum + Math.max(0, n.estimatedMinutes || 0),
    0,
  );
}

/** Estimated minutes credited toward completion, scaled by each
 *  node's `nodeProgress` percent (so a 50% node contributes half).
 *  Mirrors the user's intuition that partial progress should count
 *  partially when looking at "how much have I done?". */
export function completedMinutes(
  roadmap: Roadmap,
  enrollment: Enrollment,
): number {
  let total = 0;
  for (const n of roadmap.nodes) {
    const pct = enrollment.nodeProgress[n.id] ?? 0;
    if (pct <= 0) continue;
    total += Math.max(0, n.estimatedMinutes || 0) * (pct / 100);
  }
  return total;
}

/** Average of per-node percents across the roadmap, normalised to a
 *  0–1 fraction. Empty roadmap → 0. */
export function progressFraction(
  roadmap: Roadmap,
  enrollment: Enrollment,
): number {
  if (roadmap.nodes.length === 0) return 0;
  let sum = 0;
  for (const n of roadmap.nodes) {
    sum += (enrollment.nodeProgress[n.id] ?? 0) / 100;
  }
  return sum / roadmap.nodes.length;
}

/**
 * Soft-lock evaluation — a node is "locked" when at least one of its
 * direct predecessors isn't fully complete (< 100%). The UI surfaces
 * a lock icon but still lets the user click through (intentional,
 * per design).
 */
export function lockedNodeIds(
  roadmap: Roadmap,
  nodeProgress: Record<string, number>,
): Set<string> {
  const incomingDone = new Map<string, boolean>();
  // Default everyone to unlocked, then mark locked when any
  // predecessor isn't yet at 100%.
  for (const n of roadmap.nodes) incomingDone.set(n.id, true);
  for (const e of roadmap.edges) {
    if ((nodeProgress[e.source] ?? 0) < 100) {
      incomingDone.set(e.target, false);
    }
  }
  const locked = new Set<string>();
  for (const [id, ok] of incomingDone) if (!ok) locked.add(id);
  return locked;
}

export function formatMinutes(mins: number, locale = "en"): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return locale === "hu" ? `${h} ó` : `${h} h`;
  return locale === "hu" ? `${h} ó ${rem} p` : `${h} h ${rem} min`;
}

/** Tiny helper: fresh node skeleton for the editor. */
export function makeBlankNode(): RoadmapNode {
  return {
    id: crypto.randomUUID(),
    type: "text",
    title: "New step",
    description: "",
    estimatedMinutes: 30,
  };
}
