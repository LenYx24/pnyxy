// Persistent on-device store for book binaries (PDF / EPUB / …) so a book that
// has been opened once can be re-opened OFFLINE, even after a full restart.
//
// The open hooks keep an in-memory `blobCache` that only survives the current
// session; this store survives reloads. Keyed by the same identifier the open
// path already uses, uploaded books by `storage_path`, catalog books by their
// id, so a lookup is a single get with no extra bookkeeping.
//
// Kept in its own IndexedDB (not the `pnyxy-annotations` DB) so large binaries
// don't bloat that DB or couple to its version/upgrade cycle. Wiped on sign-out
// with the other per-user caches.

const DB_NAME = "pnyxy-books";
const STORE = "blobs";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Persist a book's binary for offline reading. Best-effort (quota/private
 *  mode just no-op). Files are Blobs, so both blobs and Files store fine. */
export async function saveBookBlob(key: string, blob: Blob): Promise<void> {
  if (!key) return;
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // quota exceeded / private mode, offline persistence is best-effort
  }
}

/** The persisted binary for a book, or null if it was never downloaded. */
export async function loadBookBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  try {
    const db = await getDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function hasBookBlob(key: string): Promise<boolean> {
  return (await loadBookBlob(key)) !== null;
}

export async function deleteBookBlob(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/** Keys of every book currently available offline (for a future "downloaded"
 *  indicator / manage-storage UI). */
export async function listOfflineBookKeys(): Promise<string[]> {
  try {
    const db = await getDB();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Wipe every offline book (called on sign-out so the next account never sees
 *  the previous user's downloaded files). */
export async function clearOfflineBooks(): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
