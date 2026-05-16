import { openDB, type IDBPDatabase } from "idb";
import type { AiCitation, Highlight, Comment } from "@/types/annotation";

const DB_NAME = "pnyxy-annotations";
// Bump 9 → 10 to force the upgrade callback to re-run on clients
// whose v8 → v9 migration didn't complete (e.g. interrupted by a
// strict-mode parallel `openDB` race that left some object stores
// uncreated). The upgrade callback is fully idempotent — every store
// is created with `if (!objectStoreNames.contains(...))`, so this
// re-run only fills in whatever's missing without touching existing
// data.
const DB_VERSION = 10;

/**
 * Defensive wrapper: turn an IndexedDB `NotFoundError` (= the queried
 * object store doesn't exist) into an empty result. This stops a
 * half-applied migration from cascading into the whole annotation
 * subsystem — the doc loads, just without whatever the missing store
 * would have contained.
 */
function isMissingStoreError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "NotFoundError" || err.name === "InvalidStateError")
  );
}

async function loadOrEmpty<T>(
  fn: () => Promise<T[]>,
  label: string,
): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingStoreError(err)) {
      // Visible warning so a broken upgrade is at least discoverable
      // in DevTools; the user still gets a working app.
      console.warn(`[annotation-storage] missing store for ${label}; returning []`, err);
      return [];
    }
    throw err;
  }
}

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
        // v8: folders mirrored locally so the library tree renders
        // offline and folder ops are optimistic (write IDB +
        // enqueue Supabase mutation via the sync queue).
        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }
        // v9: ai_citations — selections that were actually sent to
        // the AI in a chat. Indexed by documentId for the per-doc
        // citation layer; the popover lookup uses the loaded list
        // directly so we don't need a messageId index.
        if (!db.objectStoreNames.contains("ai_citations")) {
          const cs = db.createObjectStore("ai_citations", { keyPath: "id" });
          cs.createIndex("documentId", "documentId");
          cs.createIndex("messageId", "messageId");
        }
      },
    });
  }
  return dbPromise;
}

// --- Highlights ---

export async function loadHighlights(docId: string): Promise<Highlight[]> {
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAllFromIndex("highlights", "documentId", docId);
  }, "highlights");
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
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAllFromIndex("comments", "documentId", docId);
  }, "comments");
}

export async function saveComment(c: Comment): Promise<void> {
  const db = await getDB();
  await db.put("comments", c);
}

export async function deleteComment(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("comments", id);
}

// --- AI citations ---

export async function loadAiCitations(docId: string): Promise<AiCitation[]> {
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAllFromIndex("ai_citations", "documentId", docId);
  }, "ai_citations");
}

export async function saveAiCitation(c: AiCitation): Promise<void> {
  const db = await getDB();
  await db.put("ai_citations", c);
}

export async function deleteAiCitation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("ai_citations", id);
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
  /** 0..1 fractional position WITHIN `lastPosition` — together they
   *  give a pixel-precise resume point instead of just snapping to
   *  the top of the page. Null/undefined = top of page. */
  scrollOffset?: number;
  /** EPUB Canonical Fragment Identifier — the canonical position
   *  inside an EPUB's spine. Null/undefined for PDFs. */
  cfi?: string;
  /** Epoch ms — used to reconcile with the cloud sync row. The cloud
   *  side has its own `updated_at`; whichever is newer wins on open. */
  updatedAt?: number;
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
  // Stamp updatedAt on every write so the cloud-vs-local merge can
  // make a timestamp comparison without each caller having to
  // remember to set it.
  await db.put("documentMeta", { ...meta, updatedAt: Date.now() });
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
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAll("notes");
  }, "notes");
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
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAllFromIndex("bookmarks", "documentId", docId);
  }, "bookmarks");
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
  return loadOrEmpty(async () => {
    const db = await getDB();
    return db.getAll("vocab");
  }, "vocab");
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

// --- Folders (local mirror of the Supabase `folders` table) ---
//
// Stored shape exactly matches `Folder` from types/database.ts so
// the library store can write/read it without conversion.

export async function loadAllFolders<T = unknown>(): Promise<T[]> {
  return loadOrEmpty(async () => {
    const db = await getDB();
    return (await db.getAll("folders")) as T[];
  }, "folders");
}

export async function saveFolderLocal<T = unknown>(folder: T): Promise<void> {
  const db = await getDB();
  await db.put("folders", folder);
}

export async function deleteFolderLocal(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("folders", id);
}

/** Replace the local folders mirror in one transaction. Used after
 *  a successful `fetchFolders` to keep the IDB cache up to date. */
export async function replaceAllFoldersLocal<T extends { id: string }>(
  folders: T[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("folders", "readwrite");
  await tx.objectStore("folders").clear();
  for (const f of folders) {
    await tx.objectStore("folders").put(f);
  }
  await tx.done;
}
