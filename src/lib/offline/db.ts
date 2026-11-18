/**
 * SMARTBUZ — offline storage layer (IndexedDB)
 *
 * Durable, crash-safe storage for sales made while the till has no internet.
 *
 * Design notes
 * ────────────
 *  - IndexedDB only. `localStorage` is synchronous, size-limited and can be
 *    evicted by the browser; it is never used for transaction data here.
 *  - The `transactions` store is keyed by `transactionId`, so the database
 *    itself refuses a duplicate row. We still handle `ConstraintError`
 *    explicitly and turn it into a rejected promise instead of letting an
 *    unhandled DOM exception escape.
 *  - Every write resolves only once the underlying IDB transaction has
 *    COMMITTED. If the tab is killed mid-write the caller must not believe
 *    the write happened, and if it is killed after commit the write survives.
 *  - `synced` rows are never auto-deleted. The store is the cashier's local
 *    history as well as the sync queue.
 *
 * The legacy database `smartbuz_offline_db` (used by the retired
 * `offline-sales-manager.ts`) is a different name and is deliberately NOT
 * read, migrated or deleted from here.
 */

import type { CatalogItem, QueuedTransaction, TransactionStatus } from "./types";

const DB_NAME = "smartbuz_offline";
const DB_VERSION = 2;

const STORE_TRANSACTIONS = "transactions";
const STORE_META = "meta";
const STORE_CATALOG = "catalog";

const INDEX_STATUS = "by_status";
const INDEX_QUEUED_AT = "by_queuedAt";

/** Shape of a row in the `meta` store. */
interface MetaRecord {
  key: string;
  value: unknown;
}

/** Every status a transaction row can be in. */
const ALL_STATUSES: TransactionStatus[] = [
  "pending",
  "syncing",
  "synced",
  "failed",
  "conflict",
];

let dbPromise: Promise<IDBDatabase> | null = null;

/* ── small helpers ───────────────────────────────────────────────────────── */

function isIndexedDbAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    window.indexedDB !== null
  );
}

/** Read the `name` off any thrown value (DOMException is not an Error). */
function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** Best-effort human readable message for any thrown value. */
function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(error);
}

/**
 * IndexedDB rejects a `put`/`add` that would overwrite an existing key with
 * a `ConstraintError`. We recognise it explicitly so callers can treat it as
 * "already queued" rather than as an unknown failure.
 */
class DuplicateTransactionError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(
      `Transaction ${transactionId} is already present in the offline queue; it was not queued twice.`
    );
    this.name = "DuplicateTransactionError";
    this.transactionId = transactionId;
  }
}

/* ── database lifecycle ─────────────────────────────────────────────────── */

/**
 * Open (and cache) the offline database.
 *
 * The returned promise is shared: concurrent callers get the same connection.
 * A failed open is not cached, so the next call retries.
 */
export function openOfflineDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(
      new Error("IndexedDB is not available in this environment.")
    );
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const versionTx = request.transaction;

        if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
          const store = db.createObjectStore(STORE_TRANSACTIONS, {
            keyPath: "transactionId",
          });
          store.createIndex(INDEX_STATUS, "status", { unique: false });
          store.createIndex(INDEX_QUEUED_AT, "queuedAt", { unique: false });
        } else if (versionTx) {
          // A pre-existing database (e.g. a v1 `smartbuz_offline` created by
          // another feature) already has the store: only add what is missing.
          const store = versionTx.objectStore(STORE_TRANSACTIONS);
          if (!store.indexNames.contains(INDEX_STATUS)) {
            store.createIndex(INDEX_STATUS, "status", { unique: false });
          }
          if (!store.indexNames.contains(INDEX_QUEUED_AT)) {
            store.createIndex(INDEX_QUEUED_AT, "queuedAt", { unique: false });
          }
        }

        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains(STORE_CATALOG)) {
          // The last known price list, so the till can keep selling with no
          // network. Keyed by stockId.
          db.createObjectStore(STORE_CATALOG, { keyPath: "stockId" });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // Another tab wants a newer version: let go of the connection so the
        // upgrade is not blocked forever.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        void ensureStoreShape(db).then(resolve, (error: unknown) => {
          dbPromise = null;
          reject(
            error instanceof Error
              ? error
              : new Error(errorMessage(error))
          );
        });
      };

      request.onerror = () => {
        dbPromise = null;
        reject(
          request.error
            ? new Error(errorMessage(request.error))
            : new Error("Could not open the offline database.")
        );
      };
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

/**
 * Make sure the database has the shape this module expects:
 *   - `transactions` keyed by `transactionId`
 *   - a `meta` store
 *   - a `catalog` store
 *
 * A database created by a different feature could carry the same store name
 * with another keyPath, which would make every `add` fail with a DataError.
 * Object stores cannot be added without a version bump, and the version is
 * fixed at 2, so the only repair we can perform is to recreate the database
 * — and we only do that when there is nothing to lose. If real transactions
 * are stored we keep the database as it is and the catalogue helpers degrade
 * to "no catalogue" instead of destroying sales.
 */
async function ensureStoreShape(db: IDBDatabase): Promise<IDBDatabase> {
  const keyPath = db
    .transaction(STORE_TRANSACTIONS, "readonly")
    .objectStore(STORE_TRANSACTIONS).keyPath;

  const shapeIsFine =
    keyPath === "transactionId" &&
    db.objectStoreNames.contains(STORE_META) &&
    db.objectStoreNames.contains(STORE_CATALOG);

  if (shapeIsFine) return db;

  const storedRows = await readAllTransactions(db).catch(() => [] as QueuedTransaction[]);
  if (storedRows.length > 0) {
    console.warn(
      "[smartbuz offline] The offline database has an unexpected shape and holds real transactions; it was left untouched."
    );
    return db;
  }

  db.close();
  dbPromise = null;
  await deleteOfflineDb();
  return openOfflineDb();
}

function deleteOfflineDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not reset the offline database.")
      );
    request.onblocked = () =>
      reject(
        new Error(
          "The offline database is open in another tab; close it and reload the page."
        )
      );
  });
}

/* ── transaction helpers ────────────────────────────────────────────────── */

/** Read every row of the `transactions` store. */
function readAllTransactions(db: IDBDatabase): Promise<QueuedTransaction[]> {
  return new Promise<QueuedTransaction[]>((resolve, reject) => {
    const idbTx = db.transaction(STORE_TRANSACTIONS, "readonly");
    const request = idbTx.objectStore(STORE_TRANSACTIONS).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as QueuedTransaction[]);
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not read the offline queue.")
      );
  });
}

/** Newest `queuedAt` first. */
function byQueuedAtDesc(a: QueuedTransaction, b: QueuedTransaction): number {
  const diff = b.queuedAt.localeCompare(a.queuedAt);
  if (diff !== 0) return diff;
  return b.transactionId.localeCompare(a.transactionId);
}

/** Oldest `queuedAt` first — the order a till should push sales in. */
function byQueuedAtAsc(a: QueuedTransaction, b: QueuedTransaction): number {
  const diff = a.queuedAt.localeCompare(b.queuedAt);
  if (diff !== 0) return diff;
  return a.transactionId.localeCompare(b.transactionId);
}

/* ── public API ─────────────────────────────────────────────────────────── */

/**
 * Store a new transaction in the queue.
 *
 * Idempotent on `transactionId`: the store's keyPath rejects the second
 * insert and we surface that as a `DuplicateTransactionError` (a rejected
 * promise), never as a second row and never as an unhandled DOM exception.
 */
export async function enqueueTransaction(
  tx: QueuedTransaction
): Promise<QueuedTransaction> {
  const db = await openOfflineDb();

  return new Promise<QueuedTransaction>((resolve, reject) => {
    const idbTx = db.transaction(STORE_TRANSACTIONS, "readwrite");
    const request = idbTx.objectStore(STORE_TRANSACTIONS).add(tx);

    request.onsuccess = () => {
      /* the row is written; the commit below resolves the promise */
    };
    request.onerror = () => {
      if (errorName(request.error) === "ConstraintError") {
        // Already queued: reject with a clear error instead of duplicating
        // the row or leaking an unhandled DOM exception.
        reject(new DuplicateTransactionError(tx.transactionId));
        return;
      }
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not queue the transaction.")
      );
    };

    // A promise settles once: whichever of these fires first wins.
    idbTx.oncomplete = () => resolve(tx);
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not queue the transaction.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not queue the transaction.")
      );
  });
}

/** Fetch a single transaction by id. */
export async function getTransaction(
  id: string
): Promise<QueuedTransaction | null> {
  const db = await openOfflineDb();
  return new Promise<QueuedTransaction | null>((resolve, reject) => {
    const idbTx = db.transaction(STORE_TRANSACTIONS, "readonly");
    const request = idbTx.objectStore(STORE_TRANSACTIONS).get(id);
    request.onsuccess = () =>
      resolve((request.result as QueuedTransaction | undefined) ?? null);
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not read the offline queue.")
      );
  });
}

/** The complete local history, newest `queuedAt` first. */
export async function listTransactions(): Promise<QueuedTransaction[]> {
  const db = await openOfflineDb();
  const rows = await readAllTransactions(db);
  return rows.sort(byQueuedAtDesc);
}

/**
 * Transactions that are still awaiting a push to the server.
 *
 * "pending" is waiting for its first attempt; "failed" is waiting for a
 * retry. "syncing" is in flight right now and "conflict" needs a human, so
 * neither is returned. The sync engine is responsible for honouring
 * `nextAttemptAt` before it retries a failed row.
 */
export async function listPendingTransactions(): Promise<QueuedTransaction[]> {
  const db = await openOfflineDb();
  const rows = await readAllTransactions(db);
  return rows
    .filter((row) => row.status === "pending" || row.status === "failed")
    .sort(byQueuedAtAsc);
}

/**
 * Apply a partial update to a stored transaction.
 *
 * Only the given fields change; everything else (attempts, nextAttemptAt, …)
 * is preserved.
 */
export async function updateTransaction(
  id: string,
  patch: Partial<QueuedTransaction>
): Promise<QueuedTransaction> {
  const db = await openOfflineDb();

  return new Promise<QueuedTransaction>((resolve, reject) => {
    let merged: QueuedTransaction | null = null;

    const idbTx = db.transaction(STORE_TRANSACTIONS, "readwrite");
    const store = idbTx.objectStore(STORE_TRANSACTIONS);

    // A promise settles once: the first resolve/reject wins.
    idbTx.oncomplete = () => {
      if (merged) resolve(merged);
      else reject(new Error(`Transaction ${id} not found in the offline queue.`));
    };
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not update the offline queue.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Offline database transaction was aborted.")
      );

    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const existing = getRequest.result as QueuedTransaction | undefined;
      if (!existing) {
        reject(
          new Error(`Transaction ${id} not found in the offline queue.`)
        );
        try {
          idbTx.abort();
        } catch {
          /* already aborting */
        }
        return;
      }
      merged = { ...existing, ...patch };
      store.put(merged);
    };
    getRequest.onerror = () =>
      reject(
        getRequest.error
          ? new Error(errorMessage(getRequest.error))
          : new Error("Could not read the offline queue.")
      );
  });
}

/** Delete a transaction from the local store (explicit discard only). */
export async function removeTransaction(id: string): Promise<void> {
  const db = await openOfflineDb();

  return new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction(STORE_TRANSACTIONS, "readwrite");
    idbTx.objectStore(STORE_TRANSACTIONS).delete(id);
    idbTx.oncomplete = () => resolve();
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not remove the transaction.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Offline database transaction was aborted.")
      );
  });
}

/** How many transactions are in each state. */
export async function countTransactionsByStatus(): Promise<
  Record<TransactionStatus, number>
> {
  const counts = {} as Record<TransactionStatus, number>;
  for (const status of ALL_STATUSES) counts[status] = 0;

  const db = await openOfflineDb();
  const rows = await readAllTransactions(db);
  for (const row of rows) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/** Read a value from the `meta` store. */
export async function readMeta<T>(key: string): Promise<T | null> {
  const db = await openOfflineDb();
  return new Promise<T | null>((resolve, reject) => {
    const idbTx = db.transaction(STORE_META, "readonly");
    const request = idbTx.objectStore(STORE_META).get(key);
    request.onsuccess = () => {
      const record = request.result as MetaRecord | undefined;
      if (!record || record.value === undefined || record.value === null) {
        resolve(null);
        return;
      }
      resolve(record.value as T);
    };
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not read offline metadata.")
      );
  });
}

/** Write a value into the `meta` store. */
export async function writeMeta(key: string, value: unknown): Promise<void> {
  const db = await openOfflineDb();
  const record: MetaRecord = { key, value };

  return new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction(STORE_META, "readwrite");
    idbTx.objectStore(STORE_META).put(record);
    idbTx.oncomplete = () => resolve();
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not write offline metadata.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Offline database transaction was aborted.")
      );
  });
}

/**
 * Restart recovery.
 *
 * Any transaction left in the "syncing" state was interrupted — the tab was
 * closed, the browser crashed, or the process was killed mid-push. We do NOT
 * assume the push failed: the server deduplicates on `transactionId`, so
 * retrying is safe. Flip those rows back to "pending" and leave `attempts`,
 * `nextAttemptAt` and everything else exactly as it was.
 *
 * @returns how many transactions were reset.
 */
export async function resetInterruptedTransactions(): Promise<number> {
  const db = await openOfflineDb();

  return new Promise<number>((resolve, reject) => {
    let reset = 0;

    const idbTx = db.transaction(STORE_TRANSACTIONS, "readwrite");
    const store = idbTx.objectStore(STORE_TRANSACTIONS);
    const index = store.index(INDEX_STATUS);

    idbTx.oncomplete = () => resolve(reset);
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not recover interrupted transactions.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Offline database transaction was aborted.")
      );

    const request = index.openCursor(IDBKeyRange.only("syncing"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const current = cursor.value as QueuedTransaction;
      // Only the status changes — attempts and nextAttemptAt are preserved.
      cursor.update({ ...current, status: "pending" });
      reset += 1;
      cursor.continue();
    };
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not recover interrupted transactions.")
      );
  });
}

/* ── product catalogue cache ────────────────────────────────────────────── */

/** Whether this database actually has a `catalog` store. */
function hasCatalogStore(db: IDBDatabase): boolean {
  return db.objectStoreNames.contains(STORE_CATALOG);
}

/**
 * Replace the cached price list.
 *
 * This is a REPLACE, not a merge: the store is cleared first so a product
 * that has been deleted on the server cannot linger in the local catalogue.
 */
export async function cacheCatalog(items: CatalogItem[]): Promise<void> {
  const db = await openOfflineDb();

  if (!hasCatalogStore(db)) {
    throw new Error(
      "The offline database has no catalogue store; it cannot be repaired without losing the queued sales."
    );
  }

  return new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction(STORE_CATALOG, "readwrite");
    const store = idbTx.objectStore(STORE_CATALOG);

    // Requests run in the order they were issued, so the clear happens first.
    store.clear();
    for (const item of items) store.put(item);

    idbTx.oncomplete = () => resolve();
    idbTx.onerror = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Could not cache the product catalogue.")
      );
    idbTx.onabort = () =>
      reject(
        idbTx.error
          ? new Error(errorMessage(idbTx.error))
          : new Error("Offline database transaction was aborted.")
      );
  });
}

/** Every cached product. Empty when nothing has been cached yet. */
export async function readCatalog(): Promise<CatalogItem[]> {
  const db = await openOfflineDb();

  if (!hasCatalogStore(db)) return [];

  return new Promise<CatalogItem[]>((resolve, reject) => {
    const idbTx = db.transaction(STORE_CATALOG, "readonly");
    const request = idbTx.objectStore(STORE_CATALOG).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as CatalogItem[]);
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not read the cached product catalogue.")
      );
  });
}

/** One cached product, or null when it is not cached. */
export async function readCatalogItem(
  stockId: string
): Promise<CatalogItem | null> {
  const db = await openOfflineDb();

  if (!hasCatalogStore(db)) return null;

  return new Promise<CatalogItem | null>((resolve, reject) => {
    const idbTx = db.transaction(STORE_CATALOG, "readonly");
    const request = idbTx.objectStore(STORE_CATALOG).get(stockId);
    request.onsuccess = () =>
      resolve((request.result as CatalogItem | undefined) ?? null);
    request.onerror = () =>
      reject(
        request.error
          ? new Error(errorMessage(request.error))
          : new Error("Could not read the cached product catalogue.")
      );
  });
}
