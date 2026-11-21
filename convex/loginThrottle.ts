/**
 * SMARTBUZ — brute-force protection for the public sign-in mutation.
 *
 * `users:login` is the one mutation in the system that anybody on the
 * internet may call, as often as they like. Without a throttle it is a
 * password oracle: an attacker can try thousands of guesses a minute
 * against a known address, and the "Invalid email or password" answer still
 * tells them the attempt was *processed*.
 *
 * The Next.js route in front of it keeps a limiter of its own, but that one
 * lives in the memory of a single server instance: it is forgotten on every
 * deploy, and it is forgotten by every other instance that happens to be
 * serving traffic at the same time. The state therefore lives here, in the
 * database, where every instance and every deployment shares it.
 *
 * Two properties matter, and both are about *not leaking*:
 *
 *  1. **Unknown addresses are counted too.** A row is written for an
 *     address whether or not an account exists. If only real accounts were
 *     counted, then "this address locks out" and "this address does not"
 *     would answer the question "does this person have an account here?"
 *     — the enumeration oracle the whole exercise exists to close.
 *  2. **The comparison is always paid for.** A missing account is still
 *     compared against a real bcrypt hash, so the time taken to reject an
 *     address is the same whether the account exists or not.
 */

import { ConvexError } from "convex/values";
import bcrypt from "bcryptjs";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * How many consecutive failures an address may accumulate before it is
 * locked out.
 *
 * Five is deliberately generous for a human who mistypes twice, and
 * deliberately stingy for a script: at five attempts per lockout, an
 * attacker trying a wordlist of ten thousand guesses needs roughly two
 * thousand lockout cycles, each one costing them a quarter of an hour.
 */
export const MAX_FAILED_ATTEMPTS = 5;

/** How long an address stays locked out: 15 minutes. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * How long a counting window lasts. An address that stops being attacked
 * for this long starts again from a clean count.
 */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * A real bcrypt hash, of a value nobody knows, at the same cost factor the
 * stored passwords use.
 *
 * Comparing against this when the account does not exist makes the "no such
 * user" path cost the same as the "wrong password" path. Without it, the
 * difference in work done is a reliable way to tell registered addresses
 * from unregistered ones — and it also tells an attacker which guesses are
 * worth making at all.
 */
const DUMMY_HASH = "$2b$10$3NArBjj3QVfteGS36PfI2.LQ4nx2ShoU5TraxyeQSLzQPr7mPF28e";

/**
 * Spend the time a real password comparison would have cost.
 *
 * Called on the path where no account was found, so that the rejection
 * takes as long as a wrong password does.
 */
export function burnComparisonTime(password: string): void {
    try {
        bcrypt.compareSync(password, DUMMY_HASH);
    } catch {
        // A malformed hash must never throw out of the rejection path —
        // the caller must get the same answer either way.
    }
}

/** The attempt record for an address, if there is one. */
async function findAttempts(
    ctx: MutationCtx,
    email: string
): Promise<Doc<"loginAttempts"> | null> {
    return ctx.db
        .query("loginAttempts")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
}

/**
 * Refuse the sign-in when the address is locked out.
 *
 * The message says how long is left but never says whether the account
 * exists — the caller learns that the address is being rate-limited, and
 * nothing else.
 */
export async function assertLoginAllowed(ctx: MutationCtx, email: string): Promise<void> {
    const record = await findAttempts(ctx, email);
    if (!record?.lockedUntil) return;

    const remainingMs = record.lockedUntil - Date.now();
    if (remainingMs <= 0) {
        // The lockout has expired. Clear it so the next failure starts a
        // fresh count rather than continuing the old one.
        await ctx.db.delete(record._id);
        return;
    }

    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    throw new ConvexError(
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
    );
}

/**
 * Count a failed sign-in and lock the address out when it has failed too
 * many times.
 */
export async function recordLoginFailure(ctx: MutationCtx, email: string): Promise<void> {
    const now = Date.now();
    const record = await findAttempts(ctx, email);

    // A window that has expired starts again from zero.
    const windowExpired =
        record?.lastAttemptAt !== undefined && now - record.lastAttemptAt > ATTEMPT_WINDOW_MS;
    const failedCount = record && !windowExpired ? record.failedCount + 1 : 1;

    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
    const patch = {
        failedCount,
        lastAttemptAt: now,
        firstFailureAt:
            record && !windowExpired && record.firstFailureAt !== undefined
                ? record.firstFailureAt
                : now,
        lockedUntil: shouldLock ? now + LOCKOUT_MS : undefined,
    };

    if (record) {
        await ctx.db.patch(record._id, patch);
    } else {
        await ctx.db.insert("loginAttempts", { email, ...patch });
    }
}

/**
 * Forget the failures for an address after a successful sign-in.
 *
 * A correct password ends the episode; the next mistake starts a new count.
 */
export async function clearLoginFailures(ctx: MutationCtx, email: string): Promise<void> {
    const record = await findAttempts(ctx, email);
    if (record) await ctx.db.delete(record._id);
}
