import { getDB } from "./annotation-storage";
import type { WhiteboardData } from "@/types/whiteboard";

const STORE = "whiteboards";

export async function loadAllWhiteboards(): Promise<WhiteboardData[]> {
  try {
    const db = await getDB();
    return await db.getAll(STORE);
  } catch (err) {
    // Same defensive pattern as `annotation-storage`'s loaders, a
    // half-applied IDB upgrade shouldn't take down the reader sidebar
    // and the workspace's whiteboard list.
    if (
      err instanceof DOMException &&
      (err.name === "NotFoundError" || err.name === "InvalidStateError")
    ) {
      console.warn("[whiteboard-storage] missing store; returning []", err);
      return [];
    }
    throw err;
  }
}

export async function loadWhiteboard(
  id: string,
): Promise<WhiteboardData | undefined> {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function saveWhiteboard(wb: WhiteboardData): Promise<void> {
  const db = await getDB();
  await db.put(STORE, wb);
}

export async function deleteWhiteboard(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}
