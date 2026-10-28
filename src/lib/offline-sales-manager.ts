/**
 * SMARTBUZ Offline Sales Manager
 * Provides reliable, zero-dependency IndexedDB storage for POS sales
 * when internet or local connectivity drops in Uganda branch offices.
 */

const DB_NAME = "smartbuz_offline_db";
const DB_VERSION = 1;
const STORE_SALES = "offline_sales";

export interface QueuedSale {
    clientOfflineId: string;
    queuedAt: string;
    payload: any;
    status: "pending" | "syncing" | "failed";
    lastError?: string;
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof window === "undefined" || !window.indexedDB) {
            return reject(new Error("IndexedDB not supported in this environment"));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_SALES)) {
                db.createObjectStore(STORE_SALES, { keyPath: "clientOfflineId" });
            }
        };

        request.onsuccess = (event: any) => resolve(event.target.result);
        request.onerror = (event: any) => reject(event.target.error);
    });
}

/**
 * Generate a collision-proof offline client transaction ID
 */
export function generateOfflineId(shopPrefix: string = "SHOP"): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `OFFLINE-${shopPrefix}-${timestamp}-${random}`;
}

/**
 * Add a sale to the local offline IndexedDB queue
 */
export async function queueOfflineSale(payload: any, shopPrefix: string = "SHOP"): Promise<string> {
    const db = await openDB();
    const clientOfflineId = generateOfflineId(shopPrefix);

    const queuedSale: QueuedSale = {
        clientOfflineId,
        queuedAt: new Date().toISOString(),
        payload: {
            ...payload,
            clientOfflineId,
            isOfflineSync: true,
        },
        status: "pending",
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SALES, "readwrite");
        const store = tx.objectStore(STORE_SALES);
        const req = store.add(queuedSale);

        req.onsuccess = () => resolve(clientOfflineId);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all queued offline sales awaiting synchronization
 */
export async function getQueuedSales(): Promise<QueuedSale[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SALES, "readonly");
        const store = tx.objectStore(STORE_SALES);
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Remove an offline sale from the queue once successfully synced to Convex
 */
export async function removeQueuedSale(clientOfflineId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SALES, "readwrite");
        const store = tx.objectStore(STORE_SALES);
        const req = store.delete(clientOfflineId);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Synchronize all pending offline sales to the backend Convex mutation.
 * Guarantees idempotency via clientOfflineId.
 */
export async function syncOfflineQueue(
    createSaleMutation: (payload: any) => Promise<any>
): Promise<{ synced: number; failed: number; total: number }> {
    const queue = await getQueuedSales();
    if (queue.length === 0) return { synced: 0, failed: 0, total: 0 };

    let synced = 0;
    let failed = 0;

    for (const item of queue) {
        try {
            await createSaleMutation(item.payload);
            await removeQueuedSale(item.clientOfflineId);
            synced++;
        } catch (error: any) {
            console.error(`Failed to sync offline sale ${item.clientOfflineId}:`, error);
            failed++;
        }
    }

    return { synced, failed, total: queue.length };
}
