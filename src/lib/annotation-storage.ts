import { openDB, type IDBPDatabase } from "idb";
import type { Highlight, Comment } from "@/types/annotation";

const DB_NAME = "pnyxy-annotations";
const DB_VERSION = 7;

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
        if (!db.objectStoreNames.contains("bookmarks")) {
          const bms = db.createObjectStore("bookmarks", { keyPath: "id" });
          bms.createIndex("documentId", "documentId");
        }
        if (!db.objectStoreNames.contains("vocab")) {
          const vs = db.createObjectStore("vocab", { keyPath: "id" });
          // Composite "user + word + lang" isn't expressible as an
          // IDB index, so dedupe is enforced at the store layer.
          vs.createIndex("dueAt", "dueAt");
          vs.createIndex("sourceDocumentId", "sourceDocumentId");
        }
        if (!db.objectStoreNames.contains("roadmaps")) {
          db.createObjectStore("roadmaps", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("roadmapEnrollments")) {
          const es = db.createObjectStore("roadmapEnrollments", {
            keyPath: "id",
          });
          es.createIndex("roadmapId", "roadmapId");
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

// --- Bookmarks ---

export interface StoredBookmark {
  id: string;
  documentId: string;
  page: number;
  label: string;
  /** Hex color (#rrggbb). UI offers a swatch picker. */
  color: string;
  createdAt: number;
}

export async function loadBookmarks(docId: string): Promise<StoredBookmark[]> {
  const db = await getDB();
  return db.getAllFromIndex("bookmarks", "documentId", docId);
}

export async function saveBookmark(bm: StoredBookmark): Promise<void> {
  const db = await getDB();
  await db.put("bookmarks", bm);
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("bookmarks", id);
}

// --- Vocabulary entries ---

export interface StoredVocabEntry {
  id: string;
  userId: string | null;
  word: string;
  lang: string;
  definition: string;
  contextSentence: string;
  sourceDocumentId: string | null;
  sourceTitle: string | null;
  sourcePage: number | null;
  /** Opaque ts-fsrs Card blob. Dates are ISO strings on disk. */
  fsrsCard: unknown;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
}

export async function loadAllVocabEntries(): Promise<StoredVocabEntry[]> {
  const db = await getDB();
  return db.getAll("vocab");
}

export async function saveVocabEntry(entry: StoredVocabEntry): Promise<void> {
  const db = await getDB();
  await db.put("vocab", entry);
}

export async function deleteVocabEntry(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("vocab", id);
}

export async function findVocabEntryByWord(
  word: string,
  lang: string,
): Promise<StoredVocabEntry | undefined> {
  const db = await getDB();
  const all = await db.getAll("vocab");
  const norm = word.trim().toLowerCase();
  return all.find((e) => e.word === norm && e.lang === lang);
}
