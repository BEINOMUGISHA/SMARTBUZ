/**
 * SMARTBUZ — mobile money, from the till's side.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What changed, and why
 * ────────────────────────────────────────────────────────────────────────
 *
 * This used to hold an `initiateMoMoPush` that posted to `/api/momo` and,
 * when the request failed, **returned a successful response anyway**:
 *
 *     return {
 *         success: true,
 *         transactionId: `TXN-${Date.now()}`,
 *         status: "PENDING",
 *         message: `Prompt sent to ${msisdn}. Customer should enter PIN.`,
 *     };
 *
 * The `/api/momo` route behind it never called a provider either — it
 * logged the request and invented a transaction id. So the till told the
 * cashier "Prompt sent! Customer should enter PIN" for a push that was
 * never sent, and recorded a reference that meant nothing.
 *
 * That is exactly the thing this phase must not do. A payment that was
 * never requested is not a pending payment — it is a sale that will
 * never be settled.
 *
 * Now the prompt is sent by the **payment adapter** on the server
 * (`api.integrations.payments.initiatePayment`), which:
 *
 *   • refuses to run unless the adapter has been proved against the real
 *     provider with a live test,
 *   • makes a real call to MTN or Airtel,
 *   • records the intent against a reference of ours, and
 *   • reports what the provider actually said.
 *
 * If the call fails, the till says so. It never pretends.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The confirmation rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * A prompt being sent is **not** a payment being confirmed. The customer
 * still has to enter their PIN, and only the provider knows whether they
 * did.
 *
 * So the till offers two ways forward, and neither of them is the
 * cashier saying "paid":
 *
 *   • **Ask the provider** — a status query against the provider. If it
 *     says succeeded, the sale is confirmed.
 *   • **Record a reference** — for a customer who paid and sent their
 *     own confirmation. The sale is recorded as *awaiting confirmation*,
 *     and somebody with the right permission checks it later.
 */

/** The Uganda Mobile Money networks SMARTBUZ can talk to. */
export type MobileMoneyNetwork = "MTN" | "AIRTEL";

/**
 * Put a Ugandan phone number into the form the providers use.
 *
 * `0772123456`, `+256772123456` and `256772123456` all become
 * `256772123456`.
 */
export function formatUgandaPhone(phone: string): string {
    const cleaned = (phone ?? "").replace(/[^0-9]/g, "");
    if (cleaned.startsWith("256") && cleaned.length === 12) {
        return cleaned;
    }
    if (cleaned.startsWith("0") && cleaned.length === 10) {
        return `256${cleaned.slice(1)}`;
    }
    if (cleaned.length === 9) {
        return `256${cleaned}`;
    }
    return cleaned;
}

/**
 * Which network a phone number belongs to.
 *
 * The prefixes are MTN Uganda's and Airtel Uganda's. A number that
 * matches neither is `UNKNOWN`, and the cashier is asked to choose the
 * network by hand rather than the till guessing.
 */
export function detectCarrier(phone: string): MobileMoneyNetwork | "UNKNOWN" {
    const formatted = formatUgandaPhone(phone);
    if (!formatted.startsWith("256") || formatted.length !== 12) return "UNKNOWN";

    const prefix = formatted.slice(3, 5);

    // MTN Uganda prefixes: 77, 78, 76, 39
    if (["77", "78", "76", "39"].includes(prefix)) {
        return "MTN";
    }

    // Airtel Uganda prefixes: 70, 75, 74
    if (["70", "75", "74"].includes(prefix)) {
        return "AIRTEL";
    }

    return "UNKNOWN";
}

/**
 * The adapter that collects money for this network.
 *
 * The adapter key is what the server uses to find the right provider.
 */
export function adapterKeyForNetwork(network: MobileMoneyNetwork): string {
    return network === "AIRTEL" ? "airtel.money" : "mtn.momo";
}

/**
 * What came back from a collection request.
 *
 * `status` is the provider's own answer. `"pending"` means the provider
 * accepted the request and is waiting for the customer to enter their
 * PIN — it does **not** mean the money has arrived.
 */
export interface MobileMoneyOutcome {
    /** Our reference for this payment. */
    reference: string;
    /** `pending` | `succeeded` | `failed`. */
    status: string;
    /** The provider's own message. */
    message?: string;
    /** True when the provider was called in a sandbox. */
    sandbox: boolean;
}

/**
 * A message for the operator, in words rather than codes.
 *
 * The till shows this, so it says what happened and what to do next.
 */
export function describeOutcome(
    outcome: MobileMoneyOutcome,
    network: MobileMoneyNetwork
): string {
    switch (outcome.status) {
        case "succeeded":
            return `The ${network} payment was confirmed by the provider.`;
        case "failed":
            return outcome.message
                ? `The ${network} payment failed: ${outcome.message}`
                : `The ${network} payment failed.`;
        case "pending":
            return outcome.message
                ? outcome.message
                : `The prompt was sent. The customer still has to enter their ${network} PIN, and the money is confirmed only once the provider says so.`;
        default:
            return outcome.message ?? "The provider did not report a status.";
    }
}
