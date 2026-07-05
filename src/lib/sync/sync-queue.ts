import { openDB, type IDBPDatabase } from "idb";
import { logError } from "@/lib/logger";

/**
 * Local-first sync queue. Mutations land in IndexedDB, the drain loop
 * applies each to Supabase via an entity handler and deletes on success.
 * Transient failures retry with exponential backoff; permanent (4xx)
 * failures move to a dead-letter store for the UI to surface.
 */

const DB_NAME = "pnyxy-sync";
const DB_VERSION = 1;
const STORE_PENDING = "pending";
const STORE_DEAD = "dead";

export type SyncOp = "insert" | "update" | "delete";

/** Entities the queue can apply. Register a handler per entity. */
export type SyncEntity =
  | "folder"
  | "note"
  | "book"
  | "book_tag"
  | "user_book_tag";

export interface PendingMutation<P = unknown> {
  /** Stable client-side UUID. */
  id: string;
  entity: SyncEntity;
  op: SyncOp;
  /** Opaque to the queue: full row for insert/update, PK for delete. */
  payload: P;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Earliest retry time, epoch ms. */
  retryAfter: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          const store = db.createObjectStore(STORE_PENDING, {
            keyPath: "id",
          });
          // createdAt = FIFO drain order so ops apply in sequence
          store.createIndex("createdAt", "createdAt");
          store.createIndex("retryAfter", "retryAfter");
        }
        if (!db.objectStoreNames.contains(STORE_DEAD)) {
          db.createObjectStore(STORE_DEAD, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// Entity handler registry. A handler applies one mutation to the
// remote; it throws on failure. If the error has `permanent: true`
// the row is dead-lettered, otherwise retried.

export interface SyncContext {
  /** Current user id, RLS-gates most Supabase tables. */
  userId: string;
}

export type EntityHandler<P = unknown> = (
  op: SyncOp,
  payload: P,
  ctx: SyncContext,
) => Promise<void>;

const handlers = new Map<SyncEntity, EntityHandler>();

export function registerEntityHandler<P>(
  entity: SyncEntity,
  handler: EntityHandler<P>,
): void {
  handlers.set(entity, handler as EntityHandler);
}

export class PermanentSyncError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = "PermanentSyncError";
  }
}

/** Enqueue a mutation and wake the drain loop. Returns the row id. */
export async function enqueueMutation<P>(
  entity: SyncEntity,
  op: SyncOp,
  payload: P,
): Promise<string> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const row: PendingMutation<P> = {
    id,
    entity,
    op,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    retryAfter: 0,
  };
  try {
    const db = await getDB();
    await db.put(STORE_PENDING, row);
  } catch (err) {
    logError("sync-queue:enqueue", err);
    throw err;
  }
  notifyChange();
  return id;
}

/** Backoff by attempt count, in ms. Past the end it stays at 30s. */
const BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000];

/**
 * Apply all due rows (retryAfter <= now) in createdAt order, deleting
 * on success. Only call when online. A failed row doesn't block the rest.
 */
export async function drainQueue(ctx: SyncContext): Promise<{
  processed: number;
  failed: number;
}> {
  const db = await getDB();
  const now = Date.now();
  const allRows = (await db.getAllFromIndex(
    STORE_PENDING,
    "createdAt",
  )) as PendingMutation[];
  const due = allRows.filter((r) => r.retryAfter <= now);
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    const handler = handlers.get(row.entity);
    if (!handler) {
      // no handler yet: dead-letter rather than retry forever
      await moveToDeadLetters(
        row,
        `No handler registered for entity "${row.entity}"`,
      );
      failed += 1;
      continue;
    }
    try {
      await handler(row.op, row.payload, ctx);
      await db.delete(STORE_PENDING, row.id);
      processed += 1;
    } catch (err) {
      if (err instanceof PermanentSyncError) {
        await moveToDeadLetters(row, err.message);
        failed += 1;
        continue;
      }
      const attempts = row.attempts + 1;
      const backoff =
        BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
      await db.put(STORE_PENDING, {
        ...row,
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
        retryAfter: Date.now() + backoff,
      });
      failed += 1;
    }
  }
  if (processed > 0 || failed > 0) notifyChange();
  return { processed, failed };
}

async function moveToDeadLetters(
  row: PendingMutation,
  reason: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_DEAD, { ...row, lastError: reason });
  await db.delete(STORE_PENDING, row.id);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_PENDING);
}

export async function getDeadLetters(): Promise<PendingMutation[]> {
  const db = await getDB();
  return db.getAll(STORE_DEAD) as Promise<PendingMutation[]>;
}

/** Push a dead-lettered row back into the active queue. */
export async function retryDeadLetter(id: string): Promise<void> {
  const db = await getDB();
  const row = (await db.get(STORE_DEAD, id)) as PendingMutation | undefined;
  if (!row) return;
  await db.put(STORE_PENDING, {
    ...row,
    attempts: 0,
    lastError: null,
    retryAfter: 0,
  });
  await db.delete(STORE_DEAD, id);
  notifyChange();
}

// The drain loop (sync-orchestrator.ts) subscribes so an enqueue can
// wake it. Single-process only; no cross-tab BroadcastChannel.

const changeBus = new EventTarget();

export function subscribeToQueueChanges(handler: () => void): () => void {
  const wrapped = () => handler();
  changeBus.addEventListener("change", wrapped);
  return () => changeBus.removeEventListener("change", wrapped);
}

function notifyChange(): void {
  changeBus.dispatchEvent(new Event("change"));
}
