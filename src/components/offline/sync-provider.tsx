"use client";

/**
 * SMARTBUZ — the sync provider.
 *
 * The React half of the offline engine. It holds the Convex mutations (only
 * React can), starts the engine once, and gives the rest of the application
 * one place to ask "how is the queue doing?" and "push it now".
 *
 * Mounting this provider is what makes a till offline-capable: from the
 * moment it is mounted, sales made without a network are kept locally and
 * pushed when the network returns.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
    getSyncEngine,
    resetSyncEngine,
    type SyncOutcome,
    type SyncStatus,
    type SyncTransport,
} from "@/lib/offline/sync";
import {
    discardTransaction,
    listLocalHistory,
    resetToPending,
} from "@/lib/offline/queue";
import type { QueuedTransaction } from "@/lib/offline/types";

interface SyncContextValue {
    /** The state of the queue, for the banner and the sales screen. */
    status: SyncStatus;
    /** Every sale in the local record, newest first. */
    history: QueuedTransaction[];
    /** Push everything that is due, now. */
    syncNow: () => Promise<SyncOutcome>;
    /** Put a failed sale back in the queue and push it again. */
    retry: (transactionId: string) => Promise<void>;
    /** Throw a local record away. Only ever done on purpose. */
    discard: (transactionId: string) => Promise<void>;
    /** Recount and re-read the local record. */
    refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
    const registerDeviceMutation = useMutation(api.sync.registerDevice);
    const pushTransactionsMutation = useMutation(api.sync.pushTransactions);
    /**
     * Settle the payments that are still waiting for the provider.
     *
     * A mobile-money collection whose callback never arrived leaves the
     * customer having paid and the books not knowing. The repair asks the
     * provider what happened — and the till asks for it every time it
     * talks to the server, so the payment is settled by the next moment of
     * contact rather than by somebody remembering.
     */
    const repairPayments = useAction(api.integrations.payments.repairUnsettledPayments);

    const [status, setStatus] = useState<SyncStatus>({
        online: false,
        syncing: false,
        pending: 0,
        failed: 0,
        conflicts: 0,
        synced: 0,
        total: 0,
    });
    const [history, setHistory] = useState<QueuedTransaction[]>([]);

    // The transport is held in a ref so that the engine is created once and
    // never torn down by a re-render.
    const transportRef = useRef<SyncTransport>({
        registerDevice: async (args) => registerDeviceMutation(args),
        pushTransactions: async (args) =>
            pushTransactionsMutation(
                // The local queue stores ids as plain strings; Convex checks
                // them when the mutation runs.
                args as Parameters<typeof pushTransactionsMutation>[0]
            ),
    });

    // Keep the transport pointing at the live mutations.
    transportRef.current = {
        registerDevice: async (args) => registerDeviceMutation(args),
        pushTransactions: async (args) =>
            pushTransactionsMutation(
                args as Parameters<typeof pushTransactionsMutation>[0]
            ),
    };

    const refresh = useCallback(async () => {
        try {
            const rows = await listLocalHistory();
            setHistory(rows);
        } catch {
            // A browser with no IndexedDB (or a private window that has
            // blocked it) simply has no local record.
        }
    }, []);

    useEffect(() => {
        const engine = getSyncEngine({
            registerDevice: (args) => transportRef.current.registerDevice(args),
            pushTransactions: (args) => transportRef.current.pushTransactions(args),
        });

        const unsubscribe = engine.subscribe(setStatus);

        void engine.start().then(() => {
            void refresh();
        });

        return () => {
            unsubscribe();
        };
    }, [refresh]);

    const syncNow = useCallback(async () => {
        const engine = getSyncEngine({
            registerDevice: (args) => transportRef.current.registerDevice(args),
            pushTransactions: (args) => transportRef.current.pushTransactions(args),
        });
        const outcome = await engine.syncNow();
        await refresh();
        return outcome;
    }, [refresh]);

    /**
     * Ask the server to settle the payments that are waiting.
     *
     * Best-effort on purpose: a repair that cannot run leaves the payments
     * pending and the next heartbeat tries again. It is never worth
     * interrupting a sync to report that a payment is still waiting.
     */
    const repair = useCallback(async () => {
        try {
            await repairPayments({});
        } catch {
            // Nothing to say: the payments are still pending, and the next
            // time the till talks to the server it will try again.
        }
    }, [repairPayments]);

    // The till repairs the payments while it is online anyway: every time a
    // sync finishes, the payments that are waiting are settled too.
    const wasSyncing = useRef(false);
    useEffect(() => {
        const finished = wasSyncing.current && !status.syncing;
        wasSyncing.current = status.syncing;
        if (finished && status.online) void repair();
    }, [status.syncing, status.online, repair]);

    const retry = useCallback(
        async (transactionId: string) => {
            await resetToPending(transactionId);
            await refresh();
            await syncNow();
        },
        [refresh, syncNow]
    );

    const discard = useCallback(
        async (transactionId: string) => {
            await discardTransaction(transactionId);
            await refresh();
        },
        [refresh]
    );

    const value = useMemo<SyncContextValue>(
        () => ({ status, history, syncNow, retry, discard, refresh }),
        [status, history, syncNow, retry, discard, refresh]
    );

    return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * The state of the offline queue.
 *
 * Outside the provider this returns an empty state rather than throwing, so
 * a component that is rendered outside the dashboard does not have to know
 * whether the provider is there.
 */
export function useSync(): SyncContextValue {
    const context = useContext(SyncContext);
    if (context) return context;

    return {
        status: {
            online: false,
            syncing: false,
            pending: 0,
            failed: 0,
            conflicts: 0,
            synced: 0,
            total: 0,
        },
        history: [],
        syncNow: async () => ({
            pushed: 0,
            applied: 0,
            duplicates: 0,
            rejected: 0,
            conflicts: 0,
        }),
        retry: async () => {},
        discard: async () => {},
        refresh: async () => {},
    };
}

/** Forget the engine. Used when the till is rebuilt or the user signs out. */
export { resetSyncEngine };
