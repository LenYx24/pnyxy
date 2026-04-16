import { openDB, type IDBPDatabase } from "idb";
import type { Highlight, Comment } from "@/types/annotation";

const DB_NAME = "pnyxy-annotations";
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("highlights")) {
          const hs = db.createObjectStore("highlights", { keyPath: "id" });
          hs.createIndex("documentId", "documentId");
        }
        if (!db.objectStoreNames.contains("comments")) {
          const cs = db.createObjectStore("comments", { keyPath: "id" });
          cs.createIndex("documentId", "documentId");
        }
        if (!db.objectStoreNames.contains("documentMeta")) {
          db.createObjectStore("documentMeta", { keyPath: "documentId" });
        }
        if (!db.objectStoreNames.contains("notes")) {
          db.createObjectStore("notes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("whiteboards")) {
          db.createObjectStore("whiteboards", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// --- Highlights ---

export async function loadHighlights(docId: string): Promise<Highlight[]> {
  const db = await getDB();
  return db.getAllFromIndex("highlights", "documentId", docId);
}

export async function saveHighlight(h: Highlight): Promise<void> {
  const db = await getDB();
  await db.put("highlights", h);
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("highlights", id);
}

// --- Comments ---

export async function loadComments(docId: string): Promise<Comment[]> {
  const db = await getDB();
  return db.getAllFromIndex("comments", "documentId", docId);
}

export async function saveComment(c: Comment): Promise<void> {
  const db = await getDB();
  await db.put("comments", c);
}

export async function deleteComment(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("comments", id);
}

// --- Document Meta (custom titles, etc.) ---

export interface StoredDocumentMeta {
  documentId: string;
  customTitle?: string | null;
  tocWidth?: number;
  zoomMode?: string | null;
  /** Last page the user was viewing — used to resume on reopen. */
  lastPosition?: number;
  /** Furthest page the active tracker has counted as "read". */
  progressPage?: number;
}

export async function loadDocumentMeta(
  documentId: string,
): Promise<StoredDocumentMeta | undefined> {
  const db = await getDB();
  return db.get("documentMeta", documentId);
}

export async function saveDocumentMeta(
  meta: StoredDocumentMeta,
): Promise<void> {
  const db = await getDB();
  await db.put("documentMeta", meta);
}

// --- TOC Width ---

export async function loadTocWidth(
  documentId: string,
): Promise<number | undefined> {
  const meta = await loadDocumentMeta(documentId);
  return meta?.tocWidth;
}

export async function saveTocWidth(
  documentId: string,
  width: number,
): Promise<void> {
  const existing = await loadDocumentMeta(documentId);
  await saveDocumentMeta({
    documentId,
    ...existing,
    tocWidth: width,
  });
}

// --- Notes ---

export interface StoredNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export async function loadAllNotes(): Promise<StoredNote[]> {
  const db = await getDB();
  return db.getAll("notes");
}

export async function loadNote(id: string): Promise<StoredNote | undefined> {
  const db = await getDB();
  return db.get("notes", id);
}

export async function saveNote(note: StoredNote): Promise<void> {
  const db = await getDB();
  await db.put("notes", note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("notes", id);
}
