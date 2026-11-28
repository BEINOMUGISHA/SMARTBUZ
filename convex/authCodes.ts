/**
 * SMART_BUZ — the codes that prove an address.
 *
 * A six-digit code is the proof that somebody owns an email address. The
 * rules that make it worth something live here, in one place, so every path
 * that issues a code obeys the same ones:
 *
 *   - the code comes from a cryptographically secure source;
 *   - only its hash is stored, never the code itself;
 *   - it is single-use and time-limited;
 *   - the attempts are counted, so a code that is guessed at is voided.
 *
 * Both the account-registration path and the business-registration path use
 * this, which is why it is a module of its own rather than a function in one
 * of them.
 */

import bcrypt from "bcryptjs";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** How long a reset code stays valid: 1 hour. */
export const RESET_CODE_TTL_MS = 60 * 60 * 1000;

/** How long a verification code stays valid: 24 hours. */
export const VERIFICATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The bcrypt cost factor for a code's hash.
 *
 * Lower than a password's, because a code is only 6 digits: guessing it
 * does not need a big hash to be slow, and the whole point of the attempt
 * counter is to make guessing it pointless anyway.
 */
export const CODE_HASH_COST = 10;

/**
 * Hash a code.
 *
 * The *synchronous* bcrypt is used deliberately. bcryptjs's asynchronous
 * API schedules its work with a timer, and Convex refuses timers inside a
 * mutation — "Can't use setTimeout in queries and mutations". The
 * synchronous API does the same work in one go, which is what a mutation
 * needs.
 */
export function hashCode(code: string): string {
    return bcrypt.hashSync(code, CODE_HASH_COST);
}

/**
 * Check a code against its hash.
 *
 * Synchronous for the same reason as `hashCode`.
 */
export function verifyCode(code: string, codeHash: string): boolean {
    return bcrypt.compareSync(code, codeHash);
}

/**
 * Generate a 6-digit numeric code from a cryptographically secure source.
 * `Math.random()` is predictable and must not be used for security tokens.
 */
export function generateResetCode(): string {
    const range = 900000;
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    return (100000 + (random % range)).toString();
}

/**
 * Issue a verification code for an address and store its hash.
 *
 * The plain code is handed back to the caller, and only a caller holding the
 * server secret may have it — it is the server that mails it, so it never
 * travels through a browser.
 */
export async function issueEmailVerification(
    ctx: MutationCtx,
    userId: Id<"users">,
    email: string
): Promise<string> {
    const code = generateResetCode();
    const codeHash = hashCode(code);
    await ctx.db.insert("emailVerifications", {
        userId,
        email,
        codeHash,
        expiresAt: Date.now() + VERIFICATION_CODE_TTL_MS,
        attempts: 0,
        createdAt: Date.now(),
    });
    return code;
}
