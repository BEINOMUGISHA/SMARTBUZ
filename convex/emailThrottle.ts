/**
 * SMARTBUZ — throttling for the email endpoints.
 *
 * Two public routes send mail: the password reset and the email
 * verification code. Both are unauthenticated, and both were unthrottled,
 * which made them a way to make the server send mail to somebody else's
 * inbox, as fast as the connection would carry it.
 *
 * Two rules, and both are needed:
 *
 *  1. **A cooldown per address.** One inbox must not be flooded. A person
 *     who forgets they already asked waits a minute; a script that asks
 *     twice a second gets one email and then a refusal.
 *  2. **A cap per address and per IP over a window.** The cooldown alone
 *     still lets one caller walk a list of a thousand addresses, once a
 *     minute each. The per-IP cap stops that, and the per-address cap
 *     stops the same trick from a different connection.
 *
 * The state lives in the database, so the limit is shared by every instance
 * of the server and survives a deploy. A limiter held in the memory of one
 * instance is forgotten the moment that instance is recycled — which, on
 * serverless, is constantly.
 *
 * The refusal is deliberately **quiet**: the caller is told the same thing
 * either way. An endpoint that says "too many requests" for an address it
 * has never heard of is an endpoint that can be used to find out which
 * addresses have accounts.
 */

import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** The shortest gap between two emails to the same address: one minute. */
export const ADDRESS_COOLDOWN_MS = 60 * 1000;

/** How many emails one address may receive in an hour. */
export const MAX_PER_ADDRESS_PER_HOUR = 5;

/** How many emails one caller may cause in an hour, whatever the address. */
export const MAX_PER_IP_PER_HOUR = 10;

/** The length of the counting window. */
export const WINDOW_MS = 60 * 60 * 1000;

/** The throttle record for a key, if there is one. */
async function findRecord(
    ctx: MutationCtx,
    key: string
): Promise<Doc<"emailThrottle"> | null> {
    return ctx.db
        .query("emailThrottle")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
}

/** How many have been sent in the window that `now` falls in. */
function countInWindow(record: Doc<"emailThrottle"> | null, now: number): number {
    if (!record) return 0;
    if (record.windowStart === undefined) return 0;
    if (now - record.windowStart > WINDOW_MS) return 0;
    return record.sentCount ?? 0;
}

/**
 * Refuse the send when it is not allowed.
 *
 * `address` is the address the mail is going to. `clientIp` is the
 * caller's address — already hashed by the server, because an IP address
 * has no business being readable in a table.
 */
export async function assertEmailAllowed(
    ctx: MutationCtx,
    address: string,
    ip?: string
): Promise<void> {
    const now = Date.now();

    // The cooldown on the address itself.
    const addressKey = `address:${address}`;
    const addressRecord = await findRecord(ctx, addressKey);
    if (
        addressRecord?.lastSentAt !== undefined &&
        now - addressRecord.lastSentAt < ADDRESS_COOLDOWN_MS
    ) {
        throw new ConvexError(
            "An email has already been sent to this address. Please wait a minute before asking for another."
        );
    }

    // The cap on the address over the window.
    if (countInWindow(addressRecord, now) >= MAX_PER_ADDRESS_PER_HOUR) {
        throw new ConvexError(
            "Too many emails have been requested for this address. Please try again later."
        );
    }

    // The cap on the caller over the window.
    if (ip) {
        // The caller sends an opaque, already-hashed key, so it is used as
        // it stands — hashing it twice would be pointless, and storing the
        // raw address would be worse.
        const ipRecord = await findRecord(ctx, ip);
        if (countInWindow(ipRecord, now) >= MAX_PER_IP_PER_HOUR) {
            throw new ConvexError(
                "Too many emails have been requested from this connection. Please try again later."
            );
        }
    }
}

/** Record that an email was sent, for the keys that were checked. */
export async function recordEmailSent(
    ctx: MutationCtx,
    address: string,
    ip?: string
): Promise<void> {
    const now = Date.now();

    for (const key of [`address:${address}`, ...(ip ? [ip] : [])]) {
        const record = await findRecord(ctx, key);
        const windowExpired =
            record?.windowStart === undefined || now - record.windowStart > WINDOW_MS;

        const patch = {
            sentCount: windowExpired ? 1 : (record?.sentCount ?? 0) + 1,
            windowStart: windowExpired ? now : record?.windowStart,
            lastSentAt: now,
        };

        if (record) {
            await ctx.db.patch(record._id, patch);
        } else {
            await ctx.db.insert("emailThrottle", { key, ...patch });
        }
    }
}
