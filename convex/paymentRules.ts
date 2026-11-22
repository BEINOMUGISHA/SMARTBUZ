
import { ConvexError } from "convex/values";

/**
 * SMARTBUZ — the rules every repayment of customer credit follows.
 *
 * Customer money used to be able to arrive through two different mutations
 * written at different times by different hands: `customers.recordPayment`
 * and `loans.makePayment`. One of them checked the amount, the other did
 * not; one recorded how the money was paid, the other did not; one refused a
 * repeated reference, the other did not.
 *
 * A business that takes the same action through two doors gets two sets of
 * answers, and the looser door is the one somebody will find. So the rules
 * live here, once, and both doors use them.
 *
 * Three of them are worth stating plainly:
 *
 *   1. **A payment is money, so it is positive.** A negative payment would
 *      *increase* what the customer owes.
 *   2. **A payment is dated by the server.** A client that may date a
 *      payment anywhere in the past can move money into a reporting period
 *      that has already been closed. The server's stamp is the one the
 *      books use; the operator's own date is kept beside it, but only when
 *      it is close enough to the server's clock to be believable.
 *   3. **A payment says how it was paid.** Without a method, a repayment is
 *      invisible to the reconciliation that matches a provider's statement
 *      against the ledger.
 */

/** How the money was paid. The reconciliation matches on exactly these. */
export const PAYMENT_METHODS = [
    "cash",
    "mobile_money",
    "bank",
    "card",
    "cheque",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * How far a client-supplied transaction date may sit from the server's own
 * clock.
 *
 * Two days covers a payment taken at the counter and entered the next
 * morning, and a payment entered before the transfer cleared. Anything
 * further away is not a transaction date — it is a different entry, and it
 * has to be made as one.
 */
export const MAX_PAYMENT_DATE_DRIFT_HOURS = 48;

/**
 * The server's own stamp, and the operator's date beside it when it can be
 * trusted.
 *
 * The authoritative `date` is always the server's. When the client supplied
 * a date and it is within the permitted drift, that date is kept in
 * `paymentDate` so the two can be compared; when it is outside it, the
 * entry is refused rather than quietly accepted.
 */
export function resolvePaymentDates(
    claimedDate: string | undefined,
    now: number = Date.now()
): { date: string; paymentDate?: string } {
    const serverDate = new Date(now).toISOString();
    if (!claimedDate) return { date: serverDate };

    const claimed = Date.parse(claimedDate);
    if (!Number.isFinite(claimed)) {
        throw new ConvexError("The payment date could not be read.");
    }

    const driftHours = Math.abs(now - claimed) / (1000 * 60 * 60);
    if (driftHours > MAX_PAYMENT_DATE_DRIFT_HOURS) {
        throw new ConvexError(
            `A payment may not be dated more than ${MAX_PAYMENT_DATE_DRIFT_HOURS} hours away from today. ` +
                `The date given (${claimedDate}) is ${Math.round(driftHours)} hours away. ` +
                "Record it against today's date, or enter the days separately."
        );
    }

    return { date: serverDate, paymentDate: new Date(claimed).toISOString() };
}

/**
 * The method a payment was made by.
 *
 * A payment with no method cannot be reconciled against a provider's
 * statement, so one is required rather than guessed. The values are the
 * ones the rest of the codebase already uses.
 */
export function assertPaymentMethod(method: string | undefined): PaymentMethod {
    const normalised = (method ?? "").trim().toLowerCase();
    if (!normalised) {
        throw new ConvexError("Say how this payment was made — cash, mobile money, bank, card or cheque.");
    }
    if (!(PAYMENT_METHODS as readonly string[]).includes(normalised)) {
        throw new ConvexError(
            `"${method}" is not a way of paying. Use one of: ${PAYMENT_METHODS.join(", ")}.`
        );
    }
    return normalised as PaymentMethod;
}

/**
 * The method behind a sale's payment mode.
 *
 * A till names the payment mode in its own words — "Cash", "Mobile Money",
 * "M-Pesa" — while the ledger speaks in the vocabulary of the
 * reconciliation. This translates between them so that the deposit taken
 * with a credit sale carries the same method as the sale it belongs to.
 *
 * A credit sale has no money to reconcile against, and a deposit taken at
 * the counter is cash unless the till said otherwise.
 */
export function salePaymentModeToMethod(paymentMode: string | undefined): PaymentMethod {
    const mode = (paymentMode ?? "").trim().toLowerCase();
    if (mode.includes("mobile") || mode.includes("m-pesa") || mode.includes("mpesa") || mode.includes("airtel")) {
        return "mobile_money";
    }
    if (mode.includes("card") || mode.includes("visa")) return "card";
    if (mode.includes("bank") || mode.includes("transfer")) return "bank";
    if (mode.includes("cheque") || mode.includes("check")) return "cheque";
    return "cash";
}

