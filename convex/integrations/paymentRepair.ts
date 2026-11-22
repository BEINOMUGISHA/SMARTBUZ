/**
 * SMARTBUZ — the rules the automatic payment repair follows.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why these are rules and not code
 *
 * A payment whose callback never arrived is not a lost payment: the
 * customer may well have paid. The repair asks the provider what happened
 * — the provider is the only party that knows — and these are the three
 * decisions it has to make.
 *
 * They are written down here, on their own, because each of them is a
 * decision about somebody's money and each of them has to be right for a
 * reason that can be read.
 */

/** How many times the repair asks before a person has to look. */
export const DEFAULT_REPAIR_MAX_ATTEMPTS = 3;

/**
 * How long a payment must have been waiting before it is asked about.
 *
 * Two minutes: long enough that a callback which is merely late has
 * arrived, short enough that the customer is still at the counter.
 */
export const DEFAULT_REPAIR_MIN_AGE_MINUTES = 2;

/**
 * Has this payment been waiting long enough to have missed its callback?
 *
 * A payment that is thirty seconds old is still in flight, and asking the
 * provider about it would be asking about a payment that has not settled
 * yet.
 */
export function isOldEnoughToAsk(
    createdAt: string,
    now: number = Date.now(),
    minAgeMinutes: number = DEFAULT_REPAIR_MIN_AGE_MINUTES
): boolean {
    const started = Date.parse(createdAt);
    if (!Number.isFinite(started)) return false;
    return started <= now - minAgeMinutes * 60 * 1000;
}

/**
 * Has this payment been asked about enough times that a person must look?
 *
 * The repair does not give up quietly. After a few attempts it says out
 * loud that this one needs a human, because a payment nobody is looking at
 * is a payment that quietly disappears from the books.
 */
export function needsHumanReview(
    attempts: number,
    maxAttempts: number = DEFAULT_REPAIR_MAX_ATTEMPTS
): boolean {
    return attempts >= maxAttempts;
}

/**
 * What the provider's answer means for the payment.
 *
 * `succeeded` — the money was taken. The sale is confirmed and the money
 * is in the books.
 *
 * `failed` — the money was not taken. Nothing is owed, and the payment is
 * closed.
 *
 * anything else — the provider has not settled either way. The payment is
 * left exactly as it was, and the attempt is counted.
 */
export function classifyProviderStatus(status: string): "repaired" | "failed" | "waiting" {
    if (status === "succeeded") return "repaired";
    if (status === "failed") return "failed";
    return "waiting";
}
