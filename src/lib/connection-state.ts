/**
 * SMART_BUZ — why the application cannot talk to the backend.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The problem this exists to solve
 * ────────────────────────────────────────────────────────────────────────
 *
 * The browser cannot hold the signing key, so the server mints a Convex
 * access token for it at `/api/auth/convex-token`. When the deployment is
 * missing that key — which is exactly what happened on 19 November 2026 —
 * the token endpoint answers 503 and says, in plain words, which
 * environment variable is missing.
 *
 * That answer used to stop at the console. The Convex client then asked for
 * a token, got nothing, and treated every request as anonymous; the
 * backend replied "Unauthorized: you must be signed in to access business
 * data" — which is not merely unhelpful, it is **false**. The person *is*
 * signed in. The server simply cannot mint a token for them.
 *
 * So the reason is kept here, where the interface can reach it, and shown to
 * the person. A deployment that is missing a variable should say so on the
 * screen, not in a console tab nobody has open.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why a module-level value rather than React state
 * ────────────────────────────────────────────────────────────────────────
 *
 * The Convex client asks for a token from outside React — it is a callback
 * the client library holds. There is no component to set state on at that
 * moment, and the provider cannot know a token will be needed before the
 * first query goes out. So the reason lives here, and the boundary that
 * renders it subscribes to it.
 */

export interface ConnectionFailure {
    /** What the server said, in its own words. */
    reason: string;
    /** The HTTP status, when there was one. */
    status?: number;
    /** The environment variables the server named as missing. */
    missing?: string[];
    /** When the failure happened. */
    at: number;
}

let current: ConnectionFailure | null = null;
const listeners = new Set<() => void>();

/** Record why the application cannot reach the backend. */
export function reportConnectionFailure(
    reason: string,
    status?: number,
    missing?: string[]
): void {
    current = { reason, status, missing, at: Date.now() };
    for (const listener of listeners) listener();
}

/** Record that the application can reach the backend again. */
export function clearConnectionFailure(): void {
    if (!current) return;
    current = null;
    for (const listener of listeners) listener();
}

/** The current failure, or null when there is none. */
export function connectionFailure(): ConnectionFailure | null {
    return current;
}

/** Be told when the failure state changes. Returns an unsubscribe function. */
export function subscribeToConnectionFailure(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The message to show a person.
 *
 * When the server named the missing variable, that name is the whole
 * message: it is the thing the owner has to act on, and nothing else the
 * application could say would be as useful.
 */
export function connectionFailureMessage(failure: ConnectionFailure | null): string {
    if (!failure) return "";
    if (failure.missing?.length) {
        return `The server is not configured for Convex authentication. Missing: ${failure.missing.join(", ")}. Add it to the deployment's environment variables and redeploy.`;
    }
    return failure.reason;
}
