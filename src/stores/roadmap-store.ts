import { create } from "zustand";
import type {
  Enrollment,
  Roadmap,
  RoadmapEdge,
  RoadmapNode,
  SchedulePrefs,
} from "@/types/roadmap";
import { DEFAULT_SCHEDULE_PREFS } from "@/types/roadmap";
import {
  deleteEnrollment as dbDeleteEnrollment,
  deleteRoadmap as dbDeleteRoadmap,
  loadAllEnrollments,
  loadAllRoadmaps,
  saveEnrollment,
  saveRoadmap,
} from "@/lib/roadmap-storage";
import { useAuthStore } from "@/stores/auth-store";
import { ymd } from "@/features/roadmaps/lib/scheduler";

interface RoadmapState {
  roadmaps: Map<string, Roadmap>;
  enrollments: Map<string, Enrollment>;
  loaded: boolean;

  load(): Promise<void>;

  createRoadmap(title: string): Roadmap;
  updateRoadmap(id: string, patch: Partial<Roadmap>): void;
  deleteRoadmap(id: string): void;

  upsertNode(roadmapId: string, node: RoadmapNode): void;
  removeNode(roadmapId: string, nodeId: string): void;
  upsertEdge(roadmapId: string, edge: RoadmapEdge): void;
  removeEdge(roadmapId: string, edgeId: string): void;
  setNodePosition(
    roadmapId: string,
    nodeId: string,
    position: { x: number; y: number },
  ): void;

  enroll(roadmapId: string, prefs?: Partial<SchedulePrefs>): Enrollment;
  unenroll(enrollmentId: string): void;
  toggleNodeComplete(enrollmentId: string, nodeId: string): void;
  updateSchedulePrefs(
    enrollmentId: string,
    patch: Partial<SchedulePrefs>,
  ): void;
  setNodeDateOverride(
    enrollmentId: string,
    nodeId: string,
    date: string | null,
  ): void;
}

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function persistRoadmap(r: Roadmap): void {
  void saveRoadmap(r);
}

function persistEnrollment(e: Enrollment): void {
  void saveEnrollment(e);
}

export const useRoadmapStore = create<RoadmapState>((set, get) => ({
  roadmaps: new Map(),
  enrollments: new Map(),
  loaded: false,

  async load() {
    const [roadmaps, enrollments] = await Promise.all([
      loadAllRoadmaps(),
      loadAllEnrollments(),
    ]);
    set({
      roadmaps: new Map(roadmaps.map((r) => [r.id, r])),
      enrollments: new Map(enrollments.map((e) => [e.id, e])),
      loaded: true,
    });
  },

  createRoadmap(title) {
    const now = Date.now();
    const roadmap: Roadmap = {
      id: crypto.randomUUID(),
      title: title.trim() || "Untitled roadmap",
      description: "",
      ownerUserId: currentUserId(),
      ownerSpaceId: null,
      visibility: "private",
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = new Map(get().roadmaps);
    next.set(roadmap.id, roadmap);
    set({ roadmaps: next });
    persistRoadmap(roadmap);
    return roadmap;
  },

  updateRoadmap(id, patch) {
    const existing = get().roadmaps.get(id);
    if (!existing) return;
    const updated: Roadmap = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: Date.now(),
    };
    const next = new Map(get().roadmaps);
    next.set(id, updated);
    set({ roadmaps: next });
    persistRoadmap(updated);
  },

  deleteRoadmap(id) {
    const nextRoadmaps = new Map(get().roadmaps);
    nextRoadmaps.delete(id);
    // Drop dependent enrollments from in-memory state too.
    const nextEnrollments = new Map(get().enrollments);
    for (const [eid, e] of nextEnrollments) {
      if (e.roadmapId === id) nextEnrollments.delete(eid);
    }
    set({ roadmaps: nextRoadmaps, enrollments: nextEnrollments });
    void dbDeleteRoadmap(id);
  },

  upsertNode(roadmapId, node) {
    const r = get().roadmaps.get(roadmapId);
    if (!r) return;
    const idx = r.nodes.findIndex((n) => n.id === node.id);
    const nodes =
      idx === -1
        ? [...r.nodes, node]
        : r.nodes.map((n, i) => (i === idx ? node : n));
    get().updateRoadmap(roadmapId, { nodes });
  },

  removeNode(roadmapId, nodeId) {
    const r = get().roadmaps.get(roadmapId);
    if (!r) return;
    const nodes = r.nodes.filter((n) => n.id !== nodeId);
    const edges = r.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    get().updateRoadmap(roadmapId, { nodes, edges });
  },

  upsertEdge(roadmapId, edge) {
    const r = get().roadmaps.get(roadmapId);
    if (!r) return;
    // Drop self-loops; deduplicate matching source/target pairs.
    if (edge.source === edge.target) return;
    const existingDup = r.edges.find(
      (e) => e.source === edge.source && e.target === edge.target,
    );
    if (existingDup) return;
    const edges = [...r.edges.filter((e) => e.id !== edge.id), edge];
    get().updateRoadmap(roadmapId, { edges });
  },

  removeEdge(roadmapId, edgeId) {
    const r = get().roadmaps.get(roadmapId);
    if (!r) return;
    const edges = r.edges.filter((e) => e.id !== edgeId);
    get().updateRoadmap(roadmapId, { edges });
  },

  setNodePosition(roadmapId, nodeId, position) {
    const r = get().roadmaps.get(roadmapId);
    if (!r) return;
    const nodes = r.nodes.map((n) =>
      n.id === nodeId ? { ...n, position } : n,
    );
    get().updateRoadmap(roadmapId, { nodes });
  },

  enroll(roadmapId, prefs) {
    // If already enrolled, return existing.
    for (const e of get().enrollments.values()) {
      if (e.roadmapId === roadmapId) return e;
    }
    const now = Date.now();
    const enrollment: Enrollment = {
      id: crypto.randomUUID(),
      roadmapId,
      userId: currentUserId(),
      startDate: ymd(new Date()),
      completedNodeIds: {},
      schedulePrefs: { ...DEFAULT_SCHEDULE_PREFS, ...prefs },
      createdAt: now,
      updatedAt: now,
    };
    const next = new Map(get().enrollments);
    next.set(enrollment.id, enrollment);
    set({ enrollments: next });
    persistEnrollment(enrollment);
    return enrollment;
  },

  unenroll(enrollmentId) {
    const next = new Map(get().enrollments);
    next.delete(enrollmentId);
    set({ enrollments: next });
    void dbDeleteEnrollment(enrollmentId);
  },

  toggleNodeComplete(enrollmentId, nodeId) {
    const e = get().enrollments.get(enrollmentId);
    if (!e) return;
    const completedNodeIds = { ...e.completedNodeIds };
    if (completedNodeIds[nodeId]) delete completedNodeIds[nodeId];
    else completedNodeIds[nodeId] = true;
    const updated: Enrollment = {
      ...e,
      completedNodeIds,
      updatedAt: Date.now(),
    };
    const next = new Map(get().enrollments);
    next.set(enrollmentId, updated);
    set({ enrollments: next });
    persistEnrollment(updated);
  },

  updateSchedulePrefs(enrollmentId, patch) {
    const e = get().enrollments.get(enrollmentId);
    if (!e) return;
    const updated: Enrollment = {
      ...e,
      schedulePrefs: { ...e.schedulePrefs, ...patch },
      updatedAt: Date.now(),
    };
    const next = new Map(get().enrollments);
    next.set(enrollmentId, updated);
    set({ enrollments: next });
    persistEnrollment(updated);
  },

  setNodeDateOverride(enrollmentId, nodeId, date) {
    const e = get().enrollments.get(enrollmentId);
    if (!e) return;
    const overrides = { ...e.schedulePrefs.nodeDateOverrides };
    if (date) overrides[nodeId] = date;
    else delete overrides[nodeId];
    get().updateSchedulePrefs(enrollmentId, { nodeDateOverrides: overrides });
  },
}));

// Convenience selectors
export function useRoadmap(id: string | undefined): Roadmap | undefined {
  return useRoadmapStore((s) => (id ? s.roadmaps.get(id) : undefined));
}

export function useEnrollmentForRoadmap(
  roadmapId: string | undefined,
): Enrollment | undefined {
  return useRoadmapStore((s) => {
    if (!roadmapId) return undefined;
    for (const e of s.enrollments.values()) {
      if (e.roadmapId === roadmapId) return e;
    }
    return undefined;
  });
}
