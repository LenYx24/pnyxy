import type {
  Enrollment,
  Roadmap,
  RoadmapNode,
  SchedulePrefs,
} from "@/types/roadmap";
import { topologicalOrder } from "./auto-layout";

/** YYYY-MM-DD in local time. toISOString() would give UTC. */
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
  dueDate: string;
  /** True when the date is a manual override rather than computed. */
  manual: boolean;
}

/**
 * Allocates each node's estimated minutes against the daily hours budget in
 * topological order, spilling into the next day when a node overruns. Manual
 * overrides pin nodes and are not reflowed around.
 */
export function computeSchedule(
  roadmap: Roadmap,
  enrollment: Enrollment,
): Map<string, NodeSchedule> {
  const result = new Map<string, NodeSchedule>();
  const order = topologicalOrder(roadmap.nodes, roadmap.edges);

  let cursor = parseYmd(enrollment.startDate);
  let minutesLeftToday = hoursOnDate(cursor, enrollment.schedulePrefs) * 60;
  // guard against an all-zero budget looping forever
  const totalDailyMinutes =
    enrollment.schedulePrefs.weekdayHours * 60 +
    (enrollment.schedulePrefs.workOnWeekends
      ? enrollment.schedulePrefs.weekendHours * 60 * 2
      : 0);
  if (totalDailyMinutes <= 0) {
    // no time budget, pin everything to startDate
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

/** Estimated minutes done, scaled by each node's nodeProgress percent. */
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

/** Average per-node percent as a 0-1 fraction. Empty roadmap is 0. */
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
 * A node is locked when any direct predecessor is under 100%. Soft lock:
 * the UI shows an icon but still allows click-through.
 */
export function lockedNodeIds(
  roadmap: Roadmap,
  nodeProgress: Record<string, number>,
): Set<string> {
  const incomingDone = new Map<string, boolean>();
  // start unlocked, flip when a predecessor is below 100%
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

/** Estimated minutes still owed, weighted by each node's remaining percent. */
export function remainingEstimatedMinutes(
  roadmap: Roadmap,
  enrollment: Enrollment,
): number {
  let total = 0;
  for (const n of roadmap.nodes) {
    const est = Math.max(0, n.estimatedMinutes || 0);
    const pct = enrollment.nodeProgress[n.id] ?? 0;
    const remainingPct = Math.max(0, 100 - pct) / 100;
    total += est * remainingPct;
  }
  return total;
}

/** Counts study days in [from, to] inclusive, split into weekday/weekend buckets. */
export function countDaysInRange(
  from: Date,
  to: Date,
): { weekdays: number; weekends: number } {
  let weekdays = 0;
  let weekends = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= end.getTime()) {
    if (isWeekend(cursor)) weekends += 1;
    else weekdays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return { weekdays, weekends };
}

export interface DeadlineDerivation {
  /** Computed hours per Mon-Fri. */
  weekdayHours: number;
  /** Computed hours per Sat-Sun. 0 when multiplier is 0. */
  weekendHours: number;
  /** Whether weekend study is on (multiplier > 0). */
  workOnWeekends: boolean;
  /** Days available between today (inclusive) and the deadline (inclusive). */
  daysAvailable: { weekdays: number; weekends: number };
  /** Total minutes to allocate across those days. */
  totalMinutes: number;
  /** False when 0 effective days (past deadline, or weekend-only with multiplier 0). */
  feasible: boolean;
}

/**
 * Inverse of the scheduler: from remaining minutes and a finish date, returns
 * the weekday/weekend hours needed to land on time. weekendMultiplier weights
 * weekend days vs weekdays (0 = none, 1 = equal, 1.5 = half again as much).
 */
export function deriveHoursForDeadline(opts: {
  totalMinutes: number;
  today: Date;
  endDate: Date;
  weekendMultiplier: number;
}): DeadlineDerivation {
  const { totalMinutes, today, endDate, weekendMultiplier } = opts;
  const m = Math.max(0, weekendMultiplier);
  const { weekdays, weekends } = countDaysInRange(today, endDate);
  const effectiveDays = weekdays + m * weekends;
  const feasible =
    endDate.getTime() >= today.getTime() &&
    effectiveDays > 0 &&
    totalMinutes > 0;
  if (!feasible) {
    return {
      weekdayHours: 0,
      weekendHours: 0,
      workOnWeekends: m > 0,
      daysAvailable: { weekdays, weekends },
      totalMinutes,
      feasible: false,
    };
  }
  const weekdayHours = totalMinutes / 60 / effectiveDays;
  const weekendHours = m * weekdayHours;
  return {
    weekdayHours,
    weekendHours,
    workOnWeekends: m > 0,
    daysAvailable: { weekdays, weekends },
    totalMinutes,
    feasible: true,
  };
}

/** Fresh blank node for the editor. */
export function makeBlankNode(): RoadmapNode {
  return {
    id: crypto.randomUUID(),
    type: "text",
    title: "New step",
    description: "",
    estimatedMinutes: 30,
  };
}
