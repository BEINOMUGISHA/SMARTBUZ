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

/** Keep the last known session, so the till can come up without a network. */
export function cacheSession(session: Omit<CachedSession, "cachedAt">): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ ...session, cachedAt: new Date().toISOString() })
        );
    } catch {
        // A browser that will not let us store it (private mode, a full
        // disk) simply has no offline session. Everything else still works.
    }
}

/** The last known session, or null when there is none. */
export function readCachedSession(): CachedSession | null {
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

/** Forget the session. Called when the user signs out. */
export function clearCachedSession(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch {
        // Nothing to do.
    }
}
