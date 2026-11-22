"use client";

/**
 * SMARTBUZ — the sync engine.
 *
 * The half of the offline system that talks to the server. It takes the
 * sales the till has been holding and gets them into the books, and it does
 * so without ever losing one and without ever counting one twice.
 *
 * How it behaves:
 *
 *   • **It retries.** A push that fails is not lost; it is scheduled for
 *     another attempt with a growing wait between attempts, so a server
 *     that is down does not get hammered.
 *
 *   • **It remembers across restarts.** The attempt count and the retry
 *     deadline live in IndexedDB, so closing the application does not reset
 *     the backoff or make the engine forget what it still owes.
 *
 *   • **It never assumes.** An interrupted push is not treated as failed —
 *     it is retried, because the server deduplicates on the transaction id.
 *     A sale that reached the server before the crash is recognised as a
 *     duplicate and is not recorded twice.
 *
 *   • **It is honest about the money.** A mobile-money payment made with no
 *     signal comes back as *pending verification*, not as confirmed, and
 *     the till is told so.
 */

import { listTransactions, resetInterruptedTransactions } from "./db";
import { getDeviceId, getDeviceInfo } from "./device";
import { checkConnectivity, isBrowserOnline, watchConnectivity } from "./network";
import {
    markConflict,
    markFailed,
    markSynced,
    markSyncing,
    pruneSentSales,
    queueSummary,
} from "./queue";
import type { QueuedTransaction } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

export interface SyncStatus {
    /** Is the till actually able to reach the server? */
    online: boolean;
    /** Is a push running right now? */
    syncing: boolean;
    /** Waiting to be pushed. */
    pending: number;
    /** Pushed and refused. Needs attention. */
    failed: number;
    /** Pushed and recorded, but with a stock conflict. Needs a person. */
    conflicts: number;
    /** Pushed and accepted. */
    synced: number;
    /** Everything in the local record. */
    total: number;
    /** When the last push finished. */
    lastSyncAt?: string;
    /** Why the last push failed, if it did. */
    lastError?: string;
    /** This installation. */
    deviceId?: string;
    /** Set when the server will not accept this installation. */
    deviceBlocked?: string;
}

/** What the server said about one transaction. */
export interface ServerResult {
    transactionId: string;
    status: "applied" | "duplicate" | "rejected";
    saleId?: string;
    invoiceNumber?: string;
    conflicts?: Array<{
        stockId: string;
        name: string;
        kind: "insufficient" | "drift";
        availableQty: number;
        requestedQty: number;
        expectedQty?: number;
        reason: string;
    }>;
    error?: string;
    paymentConfirmation?: string;
    total?: number;
    clientTotal?: number;
}

/**
 * A sale as it is held in the local queue, ready to be pushed.
 *
 * The ids are plain strings here — IndexedDB stores strings, not Convex
 * ids. The server validates them when the mutation runs.
 */
export interface QueuedSalePayload {
    customerId?: string;
    manualCustomerName?: string;
    shopId?: string;
    userId?: string;
    total: number;
    clientType: string;
    paymentMode: string;
    items: Array<{
        stockId: string;
        name: string;
        productCode?: string;
        price: number;
        quantity: number;
        pv: number;
        bv: number;
        expectedQty?: number;
    }>;
    isLoan?: boolean;
    paymentDueDate?: string;
    initialDeposit?: number;
    packageType?: string;
    deliveryStatus?: string;
    customerPhone?: string;
    customerLocation?: string;
    transactionType?: string;
    clientOfflineId?: string;
    isOfflineSync?: boolean;
    /**
     * The payment provider's reference, when the payment was taken
     * through a provider.
     *
     * An offline sale taken through a provider keeps its reference, so
     * the sale is still awaiting confirmation when it reaches the server
     * — the provider's confirmation, not the till's.
     */
    paymentReference?: string;
    priceOverrides?: Array<{ stockId: string; price: number }>;
}

/** How the engine reaches the server. */
export interface SyncTransport {
    registerDevice(args: {
        deviceId: string;
        platform?: string;
        appVersion?: string;
        deviceName?: string;
    }): Promise<{ deviceId: string; registered: boolean }>;
    pushTransactions(args: {
        deviceId: string;
        transactions: Array<{
            transactionId: string;
            occurredAt: string;
            attempts?: number;
            payload: QueuedSalePayload;
        }>;
    }): Promise<{ results: ServerResult[] }>;
}

/* ────────────────────────────────────────────────────────────────────────
 * The rules
 * ──────────────────────────────────────────────────────────────────────── */

/** How many transactions go up in one push. */
const BATCH_SIZE = 25;

/** The longest wait between two attempts. */
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * After this many attempts a transaction stops being retried automatically.
 *
 * Something is wrong that retrying will not fix — the product was deleted,
 * the price is wrong, the account is suspended. The sale stays in the local
 * record and the cashier is shown it, rather than it being retried for ever.
 */
const MAX_ATTEMPTS = 8;

/** How often the engine looks for work, in milliseconds. */
const TICK_MS = 15_000;

/**
 * How long to wait before the next attempt.
 *
 * The wait grows with each attempt, so a server that is down is not
 * hammered, and a short blip is ridden out without a long pause. The jitter
 * stops every till in the country retrying at the same instant.
 */
export function backoffMs(attempts: number): number {
    const base = Math.min(MAX_BACKOFF_MS, 2_000 * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = Math.floor(Math.random() * Math.min(5_000, base / 4));
    return base + jitter;
}

/** The transactions that are due to be pushed. */
export function dueTransactions(
    transactions: QueuedTransaction[],
    now: Date = new Date()
): QueuedTransaction[] {
    const nowMs = now.getTime();

    return transactions
        .filter((transaction) => {
            if (transaction.status === "pending") return true;
            if (transaction.status !== "failed") return false;
            // A failed transaction waits for its retry deadline.
            if (transaction.attempts >= MAX_ATTEMPTS) return false;
            if (!transaction.nextAttemptAt) return true;
            return new Date(transaction.nextAttemptAt).getTime() <= nowMs;
        })
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/* ────────────────────────────────────────────────────────────────────────
 * The engine
 * ──────────────────────────────────────────────────────────────────────── */

/** What one pass over the queue achieved. */
export interface SyncOutcome {
    pushed: number;
    applied: number;
    duplicates: number;
    rejected: number;
    conflicts: number;
    error?: string;
}

export class SyncEngine {
    private transport: SyncTransport;
    private listeners = new Set<(status: SyncStatus) => void>();
    private stopWatching: (() => void) | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private stopped = false;

    private status: SyncStatus = {
        online: false,
        syncing: false,
        pending: 0,
        failed: 0,
        conflicts: 0,
        synced: 0,
        total: 0,
    };

    constructor(transport: SyncTransport) {
        this.transport = transport;
    }

    /** The current state, for a component that has just mounted. */
    getStatus(): SyncStatus {
        return { ...this.status };
    }

    /** Be told when the state changes. Returns a function to stop listening. */
    subscribe(listener: (status: SyncStatus) => void): () => void {
        this.listeners.add(listener);
        listener(this.getStatus());
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(patch: Partial<SyncStatus> = {}): void {
        this.status = { ...this.status, ...patch };
        const snapshot = this.getStatus();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // A listener that throws must not stop the others.
            }
        }
    }

    /**
     * Start the engine.
     *
     * On start it does three things, in this order, because the order
     * matters:
     *
     *   1. resets any transaction left mid-push by a crash back to
     *      "pending" — it may or may not have reached the server, and the
     *      server is what decides, not us;
     *   2. works out whether the till can reach the server at all;
     *   3. pushes whatever is due.
     */
    async start(): Promise<void> {
        if (this.stopped) return;
        this.stopped = false;

        const deviceId = await getDeviceId();
        this.emit({ deviceId });

        // 1. Recover from an interrupted push.
        try {
            const recovered = await resetInterruptedTransactions();
            if (recovered > 0) {
                this.emit({ lastError: undefined });
            }
        } catch {
            // A failure here must not stop the engine from starting.
        }

        // 2. Register the till, then find out whether the network is there.
        await this.registerDevice();

        const online = await checkConnectivity();
        this.emit({ online });

        // 3. Watch for the network coming back, and keep a slow tick going.
        this.stopWatching = watchConnectivity((isOnline) => {
            this.emit({ online: isOnline });
            if (isOnline) {
                void this.syncNow();
            }
        });

        this.timer = setInterval(() => {
            void this.syncNow();
        }, TICK_MS);

        await this.refreshCounts();
        await this.syncNow();
    }

    /** Stop the engine. The queue itself is untouched. */
    stop(): void {
        this.stopped = true;
        this.stopWatching?.();
        this.stopWatching = null;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Tell the server this till exists. */
    private async registerDevice(): Promise<void> {
        try {
            const info = await getDeviceInfo();
            await this.transport.registerDevice({
                deviceId: info.deviceId,
                platform: info.platform,
                appVersion: info.appVersion,
            });
            this.emit({ deviceBlocked: undefined });
        } catch (error: any) {
            const message = error?.data?.message ?? error?.message ?? "";
            if (/revoked|not allowed|allows \d+ device/i.test(message)) {
                this.emit({ deviceBlocked: message });
            }
        }
    }

    /** Recount the queue, so the badge is right. */
    async refreshCounts(): Promise<void> {
        try {
            const summary = await queueSummary();
            this.emit({
                pending: summary.pending + summary.syncing,
                failed: summary.failed,
                conflicts: summary.conflicts,
                synced: summary.synced,
                total: summary.total,
            });
        } catch {
            // Nothing to report.
        }
    }

    /**
     * Push everything that is due.
     *
     * Safe to call at any time: it does nothing if a push is already
     * running.
     */
    async syncNow(): Promise<SyncOutcome> {
        const empty: SyncOutcome = {
            pushed: 0,
            applied: 0,
            duplicates: 0,
            rejected: 0,
            conflicts: 0,
        };

        if (this.running) return empty;
        this.running = true;
        this.emit({ syncing: true });

        try {
            const deviceId = await getDeviceId();
            const all = await listTransactions();
            const due = dueTransactions(all).slice(0, BATCH_SIZE);

            if (due.length === 0) {
                await this.refreshCounts();
                this.emit({ syncing: false });
                return empty;
            }

            // Tell the local store the attempt has begun, so a crash in the
            // middle leaves a trace rather than an invisible sale.
            await markSyncing(due.map((t) => t.transactionId));

            let response: { results: ServerResult[] };
            try {
                response = await this.transport.pushTransactions({
                    deviceId,
                    transactions: due.map((t) => ({
                        transactionId: t.transactionId,
                        occurredAt: t.occurredAt,
                        attempts: t.attempts + 1,
                        payload: t.payload as unknown as QueuedSalePayload,
                    })),
                });
            } catch (error: any) {
                // The whole push failed — most likely the network. Every
                // transaction in the batch waits its turn again.
                const message =
                    error?.data?.message ??
                    error?.message ??
                    "The server could not be reached.";

                for (const transaction of due) {
                    const attempts = transaction.attempts + 1;
                    await markFailed(
                        transaction.transactionId,
                        message,
                        new Date(Date.now() + backoffMs(attempts)).toISOString()
                    );
                }

                this.emit({ syncing: false, lastError: message, online: false });
                await this.refreshCounts();
                return { ...empty, pushed: due.length, rejected: due.length, error: message };
            }

            const outcome: SyncOutcome = {
                pushed: due.length,
                applied: 0,
                duplicates: 0,
                rejected: 0,
                conflicts: 0,
            };

            for (const result of response.results ?? []) {
                const transaction = due.find((t) => t.transactionId === result.transactionId);
                const attempts = (transaction?.attempts ?? 0) + 1;

                if (result.status === "applied" || result.status === "duplicate") {
                    if (result.status === "applied") outcome.applied += 1;
                    else outcome.duplicates += 1;

                    const conflictCount = result.conflicts?.length ?? 0;
                    if (conflictCount > 0) outcome.conflicts += 1;

                    await markSynced(result.transactionId, {
                        saleId: result.saleId,
                        invoiceNumber: result.invoiceNumber,
                        conflicts: conflictCount,
                    });

                    // A sale that came back with a stock conflict is on the
                    // books, but a person has to look at it.
                    if (conflictCount > 0) {
                        await markConflict(
                            result.transactionId,
                            result.conflicts?.[0]?.reason ??
                                "The stock had already been sold by another device.",
                            {
                                saleId: result.saleId,
                                invoiceNumber: result.invoiceNumber,
                                conflicts: conflictCount,
                            }
                        );
                    }
                } else {
                    outcome.rejected += 1;
                    await markFailed(
                        result.transactionId,
                        result.error ?? "The sale was refused.",
                        new Date(Date.now() + backoffMs(attempts)).toISOString()
                    );
                }
            }

            this.emit({
                syncing: false,
                lastSyncAt: new Date().toISOString(),
                lastError: undefined,
                online: true,
            });

            // The till keeps a record of what it has done, and the record is
            // bounded: the sales that have been sent and are no longer
            // waiting for anything are let go, oldest first, once there are
            // too many of them. The sales that are still waiting are never
            // discarded.
            await pruneSentSales();

            await this.refreshCounts();

            return outcome;
        } finally {
            this.running = false;
        }
    }
}

/* ────────────────────────────────────────────────────────────────────────
 * A module-level engine
 * ──────────────────────────────────────────────────────────────────────── */

let engine: SyncEngine | null = null;

/**
 * The engine for this browser.
 *
 * One engine per page, so the whole application sees the same state. The
 * transport is supplied by the React layer, which is the only place that can
 * hold a Convex mutation.
 */
export function getSyncEngine(transport: SyncTransport): SyncEngine {
    if (!engine) engine = new SyncEngine(transport);
    return engine;
}

/** Forget the engine. Used when the user signs out or the till is rebuilt. */
export function resetSyncEngine(): void {
    engine?.stop();
    engine = null;
}

/** Whether the browser thinks it is online. A hint, not the truth. */
export { isBrowserOnline };
