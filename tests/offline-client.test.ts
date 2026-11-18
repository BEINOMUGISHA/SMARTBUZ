/**
 * SMARTBUZ — Phase 7, the till half.
 *
 * The rules the sync engine follows on the browser side: which transaction
 * is due to be sent, and how long to wait before trying again.
 *
 * These are the rules that decide whether a sale is eventually sent or
 * quietly left behind, so they are checked directly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { backoffMs, dueTransactions } from "../src/lib/offline/sync";
import type { QueuedTransaction } from "../src/lib/offline/types";

const NOW = Date.now();
const HOUR = 3_600_000;

/** A queued transaction, for the rules to be applied to. */
function queued(overrides: Partial<QueuedTransaction> = {}): QueuedTransaction {
    return {
        transactionId: "SBZ-0000000000000001",
        deviceId: "SBZ-DEVICE",
        occurredAt: new Date(NOW).toISOString(),
        queuedAt: new Date(NOW).toISOString(),
        payload: {},
        status: "pending",
        attempts: 0,
        ...overrides,
    };
}

describe("which transaction is due", () => {
    it("sends the ones that are waiting", () => {
        const due = dueTransactions(
            [queued({ transactionId: "a" }), queued({ transactionId: "b" })],
            new Date(NOW)
        );
        assert.equal(due.length, 2);
    });

    it("sends the oldest first", () => {
        const due = dueTransactions(
            [
                queued({
                    transactionId: "newer",
                    queuedAt: new Date(NOW).toISOString(),
                }),
                queued({
                    transactionId: "older",
                    queuedAt: new Date(NOW - HOUR).toISOString(),
                }),
            ],
            new Date(NOW)
        );
        assert.equal(due[0].transactionId, "older");
    });

    it("waits for a failed one until its time is up", () => {
        const due = dueTransactions(
            [
                queued({
                    transactionId: "not-yet",
                    status: "failed",
                    attempts: 2,
                    nextAttemptAt: new Date(NOW + HOUR).toISOString(),
                }),
            ],
            new Date(NOW)
        );
        assert.equal(due.length, 0, "it is still waiting its turn");
    });

    it("sends a failed one once its time is up", () => {
        const due = dueTransactions(
            [
                queued({
                    transactionId: "ready",
                    status: "failed",
                    attempts: 2,
                    nextAttemptAt: new Date(NOW - 1000).toISOString(),
                }),
            ],
            new Date(NOW)
        );
        assert.equal(due.length, 1);
    });

    it("sends a failed one that has no deadline set", () => {
        const due = dueTransactions(
            [queued({ transactionId: "no-deadline", status: "failed", attempts: 1 })],
            new Date(NOW)
        );
        assert.equal(due.length, 1);
    });

    it("leaves the ones that are already through alone", () => {
        const due = dueTransactions(
            [
                queued({ transactionId: "sent", status: "synced" }),
                queued({ transactionId: "held", status: "conflict" }),
                queued({ transactionId: "busy", status: "syncing" }),
            ],
            new Date(NOW)
        );
        assert.equal(due.length, 0);
    });

    it("stops after eight attempts, so a person can look at it", () => {
        const due = dueTransactions(
            [
                queued({
                    transactionId: "exhausted",
                    status: "failed",
                    attempts: 8,
                    nextAttemptAt: new Date(NOW - HOUR).toISOString(),
                }),
            ],
            new Date(NOW)
        );
        assert.equal(due.length, 0, "it is not retried for ever");
    });
});

describe("how long to wait between attempts", () => {
    it("waits longer each time", () => {
        const first = backoffMs(1);
        const second = backoffMs(2);
        const third = backoffMs(3);

        assert.ok(second > first, "the second wait is longer");
        assert.ok(third > second, "the third wait is longer");
    });

    it("does not wait forever", () => {
        assert.ok(backoffMs(30) <= 5 * 60_000 + 5_000, "the wait is capped");
    });

    it("is never negative", () => {
        assert.ok(backoffMs(0) > 0);
    });
});
