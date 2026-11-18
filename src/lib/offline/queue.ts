/**
 * SMARTBUZ — offline sale queue
 *
 * The layer the sales page and the sync engine talk to. It owns the
 * lifecycle of a locally stored sale:
 *
 *   queueSale()      -> a new row, "pending", waiting to be pushed
 *   markSyncing()    -> the sync engine picked it up (attempts is bumped)
 *   markSynced()     -> the server accepted it; the row STAYS as history
 *   markFailed()     -> the push failed; the row waits for its retry
 *   markConflict()   -> the server reported a stock conflict; needs a human
 *   resetToPending() -> put it back in the queue
 *   discardTransaction() -> the cashier explicitly throws it away
 *
 * Nothing is deleted when a sale syncs. The store is the cashier's local
 * record of what was sold; a synced row simply moves to "synced" and stays.
 */

import {
  countTransactionsByStatus,
  enqueueTransaction,
  getTransaction,
  listPendingTransactions,
  listTransactions,
  removeTransaction,
  updateTransaction,
} from "./db";
import type { QueuedTransaction } from "./types";

/** `SBZ-` + 16 hex characters (64 bits of `crypto.getRandomValues` entropy). */
function generateTransactionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `SBZ-${hex}`.toUpperCase();
}

/** A transaction id that a caller wants to keep (idempotent re-queue). */
function isUsableTransactionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.startsWith("SBZ-")
  );
}

/**
 * Queue a sale made on the till.
 *
 * The transaction id is generated BEFORE the row is stored and is stored with
 * it, so the row is identified by the same id all the way to the server.
 *
 * Idempotency: if the payload already carries a `transactionId`, that id is
 * reused. Queueing the same payload twice then hits the store's keyPath
 * constraint and is REJECTED (a rejected promise) instead of producing a
 * second local row.
 *
 * @param payload the sale arguments.
 * @param options the till identity and, optionally, the time the sale happened.
 */
export async function queueSale(
  payload: Record<string, unknown>,
  options: {
    businessId?: string;
    shopId?: string;
    deviceId: string;
    occurredAt?: string;
  }
): Promise<QueuedTransaction> {
  const queuedAt = new Date().toISOString();

  const transactionId = isUsableTransactionId(payload.transactionId)
    ? payload.transactionId
    : generateTransactionId();

  const transaction: QueuedTransaction = {
    transactionId,
    deviceId: options.deviceId,
    businessId: options.businessId,
    shopId: options.shopId,
    occurredAt: options.occurredAt ?? queuedAt,
    queuedAt,
    payload: {
      ...payload,
      // The server needs both to deduplicate; keep any value the caller
      // supplied, otherwise stamp ours on.
      transactionId:
        typeof payload.transactionId === "string"
          ? payload.transactionId
          : transactionId,
      deviceId:
        typeof payload.deviceId === "string"
          ? payload.deviceId
          : options.deviceId,
    },
    status: "pending",
    attempts: 0,
  };

  return enqueueTransaction(transaction);
}

/** The complete local history, newest first. */
export async function listLocalHistory(): Promise<QueuedTransaction[]> {
  return listTransactions();
}

/** The transactions still awaiting a push to the server, oldest first. */
export async function listPendingForSync(): Promise<QueuedTransaction[]> {
  return listPendingTransactions();
}

/**
 * Mark transactions as being pushed right now.
 *
 * `attempts` is incremented and `lastAttemptAt` is stamped here, because this
 * is the moment an attempt begins. The sync engine should compute the retry
 * delay from the attempts count it reads back after this call.
 */
export async function markSyncing(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const now = new Date().toISOString();

  for (const id of ids) {
    const current = await getTransaction(id);
    if (!current) continue;
    await updateTransaction(id, {
      status: "syncing",
      attempts: current.attempts + 1,
      lastAttemptAt: now,
    });
  }
}

/**
 * The server accepted the sale.
 *
 * The row is NOT deleted: it becomes part of the local history.
 */
export async function markSynced(
  id: string,
  result: QueuedTransaction["result"]
): Promise<void> {
  const now = new Date().toISOString();
  await updateTransaction(id, {
    status: "synced",
    result: { ...(result ?? {}), syncedAt: result?.syncedAt ?? now },
    lastError: undefined,
    nextAttemptAt: undefined,
  });
}

/**
 * The push failed. The row waits until `nextAttemptAt` before it is retried.
 *
 * The backoff itself is computed by the caller (the sync engine); the storage
 * only persists the deadline so a restart does not reset it.
 */
export async function markFailed(
  id: string,
  error: string,
  nextAttemptAt: string
): Promise<void> {
  await updateTransaction(id, {
    status: "failed",
    lastError: error,
    nextAttemptAt,
  });
}

/** The server reported a conflict on this sale. Needs a human. */
export async function markConflict(
  id: string,
  error: string,
  result: QueuedTransaction["result"]
): Promise<void> {
  await updateTransaction(id, {
    status: "conflict",
    lastError: error,
    result: { ...(result ?? {}) },
  });
}

/**
 * Put a failed or conflicted transaction back in the queue.
 *
 * The error and the retry deadline are cleared so it is retried on the next
 * pass; `attempts` is kept as the record of how often it has been tried.
 */
export async function resetToPending(id: string): Promise<void> {
  await updateTransaction(id, {
    status: "pending",
    lastError: undefined,
    nextAttemptAt: undefined,
  });
}

/** Explicitly throw a transaction away. Never called automatically. */
export async function discardTransaction(id: string): Promise<void> {
  await removeTransaction(id);
}

/** A snapshot of the queue, for the offline banner and the sales screen. */
export async function queueSummary(): Promise<{
  pending: number;
  failed: number;
  conflicts: number;
  synced: number;
  syncing: number;
  total: number;
}> {
  const counts = await countTransactionsByStatus();
  return {
    pending: counts.pending,
    failed: counts.failed,
    conflicts: counts.conflict,
    synced: counts.synced,
    syncing: counts.syncing,
    total:
      counts.pending +
      counts.failed +
      counts.conflict +
      counts.synced +
      counts.syncing,
  };
}
