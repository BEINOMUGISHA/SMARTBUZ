/**
 * SMARTBUZ — the caller's address.
 *
 * The email endpoints are throttled per caller as well as per address, so
 * the server needs to know who is asking. Behind a proxy or a load
 * balancer the socket address is the proxy's, so the forwarded header is
 * what identifies the caller.
 *
 * `x-forwarded-for` is a list, and the first entry is the original client.
 * That entry is taken because it is the one the proxy chain agrees on.
 *
 * The value is used only as a throttle key and is stored in the same way
 * a password would be — hashed, not in the clear. It is not a reliable
 * identity: a caller can send any header it likes. It only has to be
 * stable enough that one caller is counted as one.
 */
import { createHash } from "node:crypto";

/** The address the request came from, if the headers say. */
export function clientIp(request: Request): string | undefined {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) return first;
    }

    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;

    return undefined;
}

/**
 * A throttle key for an address.
 *
 * The address is hashed rather than stored: the key is only ever compared
 * with another key, so there is no reason to keep the address itself in a
 * table that anybody with database access could read.
 */
export function throttleKey(prefix: string, value: string): string {
    const digest = createHash("sha256").update(value).digest("hex").slice(0, 32);
    return `${prefix}:${digest}`;
}
