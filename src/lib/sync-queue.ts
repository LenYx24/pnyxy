import { openDB, type IDBPDatabase } from "idb";
import { logError } from "@/lib/logger";

/**
 * Local-first sync queue.
 *
 * Mutations that the user makes while offline (and successful but
 * provisional writes when online) land in IndexedDB first. The drain
 * loop reads them out and applies each to Supabase via an
 * entity-specific handler; on success the row is removed. On
 * transient failure the row stays with an incremented `attempts`
 * counter — the loop retries with exponential backoff. On 4xx
 * "this will never succeed" failures the row is moved to a dead-
 * letter store so the UI can surface it.
 *
 * Tier 2 scope: folders + notes route through here. The dispatch
 * table is intentionally open so new entities (book metadata,
 * tags, reading sessions, …) can be added incrementally without
 * touching this file.
 *
 * Future / Tier 3 hook: the same queue shape works for true local-
 * first apps if we swap the drain target from "REST upsert" to a
 * sync engine (PowerSync, ElectricSQL). Don't bake REST assumptions
 * into the entity handlers — pass the payload and let the handler
 * decide.
 */

const DB_NAME = "pnyxy-sync";
const DB_VERSION = 1;
const STORE_PENDING = "pending";
const STORE_DEAD = "dead";

export type SyncOp = "insert" | "update" | "delete";

/** Catalog of entities the queue knows how to apply. Extend this
 *  type as new local-first entities are added, then register a
 *  handler with `registerEntityHandler`. */
export type SyncEntity = "folder" | "note" | "book_tag" | "user_book_tag";

export interface PendingMutation<P = unknown> {
  /** Stable client-side id. UUID. */
  id: string;
  entity: SyncEntity;
  op: SyncOp;
  /** Whatever the entity handler needs to apply the op — typically
   *  the full row for insert/update, just the primary key for
   *  delete. Shape is opaque to the queue. */
  payload: P;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Next time we're willing to retry, in epoch ms. Backoff-driven. */
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
          // `createdAt` for FIFO drain order; queue should preserve
          // user intent ("I created folder A then renamed it") so
          // entity handlers see ops in the right sequence.
          store.createIndex("createdAt", "createdAt");
          // `retryAfter` for the drain loop's "skip rows still in
          // their backoff window" query.
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

// ── Entity handler registry ─────────────────────────────────────
//
// Each registered handler knows how to apply one mutation to the
// remote (typically Supabase). Returns void on success; throws on
// failure. The queue inspects the thrown error: if it has
// `permanent: true` the row goes to dead letters, otherwise it's
// retried.

export interface SyncContext {
  /** Current user id — most Supabase tables RLS-gate by this. */
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

// ── Enqueue ─────────────────────────────────────────────────────

/** Drop a new mutation onto the queue. Returns the row id (caller
 *  rarely needs it). Safe to call from anywhere — the queue does
 *  the IndexedDB write, then signals the drain loop to wake up. */
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
  // Wake up any listening drain loop so the mutation flushes the
  // moment we're online — no need to wait for the next poll tick.
  notifyChange();
  return id;
}

// ── Drain ───────────────────────────────────────────────────────

/** Backoff schedule in ms, indexed by attempt count. After this
 *  list, mutations stay at 30s intervals forever (or until the
 *  user clicks "retry now"). Tuned for Supabase: most transient
 *  failures (network, 5xx) resolve within a few seconds. */
const BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000];

/**
 * Drain the queue: read all rows whose `retryAfter <= now`, apply
 * them in createdAt order, and delete on success. Caller is
 * responsible for only invoking this when online (the drain loop
 * gates on `useNetworkStore.online()`). Best-effort — a single
 * failed row doesn't stop subsequent rows.
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
      // No registered handler — likely a feature that hasn't been
      // migrated to local-first yet. Park the row in dead letters
      // rather than retrying forever. Users can drain by hand
      // once the handler ships.
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

// ── Counts & inspection ────────────────────────────────────────

export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_PENDING);
}

export async function getDeadLetters(): Promise<PendingMutation[]> {
  const db = await getDB();
  return db.getAll(STORE_DEAD) as Promise<PendingMutation[]>;
}

/** Push a dead-lettered row back into the active queue. Useful for
 *  "the underlying bug was fixed, please try again." */
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

// ── Change notification ────────────────────────────────────────
// The drain loop (in sync-orchestrator.ts) subscribes here so an
// `enqueueMutation` call from one tab can wake up the drain loop
// in another. Single-process for now via EventTarget; cross-tab
// coordination would need BroadcastChannel — deferred until we
// actually see two tabs causing duplicate Supabase writes.

const changeBus = new EventTarget();

export function subscribeToQueueChanges(handler: () => void): () => void {
  const wrapped = () => handler();
  changeBus.addEventListener("change", wrapped);
  return () => changeBus.removeEventListener("change", wrapped);
}

function notifyChange(): void {
  changeBus.dispatchEvent(new Event("change"));
}
