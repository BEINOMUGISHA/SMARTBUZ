/**
 * SMARTBUZ — the cached session.
 *
 * A till that has lost its network still has to come up and let the cashier
 * sell. That means the app has to be able to answer "who is signed in, and
 * what may they do?" without asking the server.
 *
 * So the last known session is kept locally and used as a fallback while the
 * server cannot be reached.
 *
 * What is kept: the user's own name and contact details, the businesses
 * they belong to, and the permissions the server granted them. **The
 * session cookie is not kept** — nothing here can be used to reach the
 * server. Every write still goes through the server's own checks when the
 * network comes back, so a stale cache grants nothing; it only decides what
 * the interface shows while the till is cut off.
 *
 * The cache is also an external store: React can subscribe to it, so a
 * component that shows the cached session re-renders when the cache
 * changes without anybody having to copy it into state by hand.
 */

const SESSION_KEY = "smartbuz_offline_session";

export interface CachedSession {
    /** The signed-in user's email. */
    email: string;
    user: Record<string, unknown> | null;
    businesses: unknown[];
    activeBusiness: unknown;
    permissions: readonly string[];
    /** When this was written. */
    cachedAt: string;
}

/**
 * The cached session, held in memory as well as on disk.
 *
 * Holding it in memory is what makes it an external store: `getSnapshot`
 * has to answer with the *same* object every time, or React will re-render
 * forever looking for a change that is not there.
 */
let snapshot: CachedSession | null = null;
let snapshotLoaded = false;

/** The components that are watching the cache. */
const listeners = new Set<() => void>();

/** Read the cache from disk. */
function readFromStorage(): CachedSession | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.email !== "string") return null;
        return parsed as CachedSession;
    } catch {
        return null;
    }
}

/** Tell everything that is watching the cache that it has changed. */
function publish(next: CachedSession | null) {
    snapshot = next;
    snapshotLoaded = true;
    for (const listener of listeners) listener();
}

/**
 * Keep the last known session, so the till can come up without a network.
 */
export function cacheSession(session: Omit<CachedSession, "cachedAt">): void {
    if (typeof window === "undefined") return;

    const entry: CachedSession = { ...session, cachedAt: new Date().toISOString() };

    // If nothing actually changed, do not write and do not wake anybody.
    //
    // The live session is re-read from the server on every Convex update, and
    // the result arrives as a fresh object each time. Writing that back to
    // the cache and telling every subscriber about it produced a loop:
    // a new session object woke the subscribers, the subscribers re-read the
    // session, the session came back as a new object, and around again.
    //
    // The content of the session is what matters, not its identity. When the
    // content is the same, there is nothing to say.
    const current = readCachedSession();
    if (current && sameSessionContent(current, entry)) {
        return;
    }

    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(entry));
    } catch {
        // A browser that will not let us store it (private mode, a full
        // disk) simply has no offline session. Everything else still works.
    }

    publish(entry);
}

/**
 * Are these two snapshots the same session?
 *
 * `cachedAt` is excluded: it says when the entry was written, not what the
 * session is.
 */
function sameSessionContent(a: CachedSession, b: CachedSession): boolean {
    return (
        a.email === b.email &&
        JSON.stringify(a.user ?? null) === JSON.stringify(b.user ?? null) &&
        JSON.stringify(a.businesses ?? []) === JSON.stringify(b.businesses ?? []) &&
        JSON.stringify(a.activeBusiness ?? null) ===
            JSON.stringify(b.activeBusiness ?? null) &&
        JSON.stringify(a.permissions ?? []) ===
            JSON.stringify(b.permissions ?? [])
    );
}

/** The last known session, or null when there is none. */
export function readCachedSession(): CachedSession | null {
    if (!snapshotLoaded) {
        snapshot = readFromStorage();
        snapshotLoaded = true;
    }
    return snapshot;
}

/** Forget the session. Called when the user signs out. */
export function clearCachedSession(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch {
        // Nothing to do.
    }
    publish(null);
}

/**
 * Watch the cache.
 *
 * Returns the function that stops watching. React calls this when the
 * component that subscribed goes away.
 */
export function subscribeSessionCache(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The cached session, for `useSyncExternalStore`.
 *
 * The same object every time — that is the contract.
 */
export function getSessionCacheSnapshot(): CachedSession | null {
    return readCachedSession();
}

/**
 * The cached session as the server sees it.
 *
 * There is no cache on the server, and there is no local storage on the
 * server either, so the answer is always "none". React uses this for the
 * first render of a page and then swaps in the real value, which is what
 * keeps the page from flashing between "signed in" and "signed out".
 */
export function getSessionCacheServerSnapshot(): CachedSession | null {
    return null;
}
