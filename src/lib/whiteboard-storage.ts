import { getDB } from "./annotation-storage";
import type { WhiteboardData } from "@/types/whiteboard";

const STORE = "whiteboards";

export async function loadAllWhiteboards(): Promise<WhiteboardData[]> {
  const db = await getDB();
  return db.getAll(STORE);
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
