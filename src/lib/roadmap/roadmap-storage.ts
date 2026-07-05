import type { Enrollment, NodeId, Roadmap } from "@/types/roadmap";
import { getDB } from "../annotation-storage";

/**
 * Lift any legacy `completedNodeIds: { [id]: true }` map into the
 * current `nodeProgress: { [id]: number }` shape, treating every
 * completed node as 100%. Untouched if `nodeProgress` is already
 * populated. Idempotent, safe to run on every load.
 */
function migrateEnrollment(raw: unknown): Enrollment {
  const obj = raw as Enrollment & {
    completedNodeIds?: Record<NodeId, true>;
  };
  const nodeProgress: Record<NodeId, number> = { ...(obj.nodeProgress ?? {}) };
  const legacy = obj.completedNodeIds ?? {};
  for (const id of Object.keys(legacy)) {
    if (legacy[id] && nodeProgress[id] === undefined) {
      nodeProgress[id] = 100;
    }
  }
  return {
    ...obj,
    nodeProgress,
  };
}

// --- Roadmaps ---

export async function loadAllRoadmaps(): Promise<Roadmap[]> {
  const db = await getDB();
  return db.getAll("roadmaps");
}

export async function loadRoadmap(id: string): Promise<Roadmap | undefined> {
  const db = await getDB();
  return db.get("roadmaps", id);
}

export async function saveRoadmap(r: Roadmap): Promise<void> {
  const db = await getDB();
  await db.put("roadmaps", r);
}

export async function deleteRoadmap(id: string): Promise<void> {
  const db = await getDB();
  // Cascade: drop enrollments tied to this roadmap, otherwise they orphan.
  const tx = db.transaction(["roadmaps", "roadmapEnrollments"], "readwrite");
  await tx.objectStore("roadmaps").delete(id);
  const enrollIdx = tx
    .objectStore("roadmapEnrollments")
    .index("roadmapId");
  let cursor = await enrollIdx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// --- Enrollments ---

export async function loadAllEnrollments(): Promise<Enrollment[]> {
  const db = await getDB();
  const raw = await db.getAll("roadmapEnrollments");
  return raw.map(migrateEnrollment);
}

export async function saveEnrollment(e: Enrollment): Promise<void> {
  const db = await getDB();
  await db.put("roadmapEnrollments", e);
}

export async function deleteEnrollment(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("roadmapEnrollments", id);
}
