/**
 * SMARTBUZ — offline POS types
 *
 * Shared vocabulary for the local (IndexedDB) half of the offline-first POS.
 * The server sync engine and the offline UI are written against exactly these
 * names, so they must not be renamed casually.
 *
 * A "queued transaction" is one row in the local store. It is BOTH:
 *   - the queue entry waiting to be pushed to the server, and
 *   - the cashier's permanent local record of the sale.
 *
 * A synced row is never deleted automatically: it transitions to "synced" and
 * stays in the history until the cashier explicitly discards it.
 */

/** Lifecycle of a locally stored sale. */
export type TransactionStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict";

/** One line item of a sale, as it was captured on the till. */
export interface QueuedLine {
  stockId: string;
  name: string;
  productCode: string;
  price: number;
  quantity: number;
  pv: number;
  bv: number;
  /** The stock quantity the till believed was on hand when this sale was made. */
  expectedQty?: number;
}

/** A sale that lives in the local store. */
export interface QueuedTransaction {
  /** Unique across every transaction this installation has ever created. */
  transactionId: string;
  /** The stable id of this installation. */
  deviceId: string;
  businessId?: string;
  shopId?: string;
  /** When the sale actually happened on the till (not when it was synced). */
  occurredAt: string;
  /** When it was written into the local queue. */
  queuedAt: string;
  /** The sale arguments, verbatim, ready to hand to the server. */
  payload: Record<string, unknown>;
  status: TransactionStatus;
  attempts: number;
  lastAttemptAt?: string;
  /** ISO time before which this transaction should not be retried. */
  nextAttemptAt?: string;
  lastError?: string;
  /** Set once the server has accepted the transaction. */
  result?: {
    saleId?: string;
    invoiceNumber?: string;
    syncedAt?: string;
    conflicts?: number;
  };
}

/** Identity of the till this browser is running on. */
export interface DeviceInfo {
  deviceId: string;
  platform: string;
  appVersion: string;
}

/**
 * A cached product from the shop's price list.
 *
 * The cached price is ONLY what the till shows the customer on the receipt.
 * The server always recomputes the price from the `stocks` table when the
 * sale is pushed, so a stale cached price can never change the books.
 */
export interface CatalogItem {
  stockId: string;
  name: string;
  productCode: string;
  price: number;
  pv: number;
  bv: number;
  /** How many the till believed were on hand when the list was cached. */
  qty: number;
  halfPrice?: boolean;
  /** When this list was cached. */
  cachedAt: string;
}
