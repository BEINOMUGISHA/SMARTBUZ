/**
 * SMARTBUZ — a price that moved while the sale was being rung up.
 *
 * The till shows a price, the customer agrees to it, and the sale is rung
 * up against whatever the catalogue says *now*. When those two figures
 * differ, the server refuses the sale and sends back what changed.
 *
 * The till then has to do the only sensible thing: put the new figure to
 * the customer and find out whether they will pay it. That is a decision
 * for the person at the till and the person at the counter, not something
 * the software can decide on its own.
 */

/** One line whose price had moved. */
export interface PriceChangeLine {
    stockId: string;
    name: string;
    /** The price the till showed. */
    quotedPrice: number;
    /** The price the catalogue held when the sale arrived. */
    chargedPrice: number;
    quantity: number;
}

/** What the server said had changed. */
export interface PriceChangeNotice {
    changes: PriceChangeLine[];
    /** The total the server computed at the new prices. */
    total: number;
}

/**
 * Is this the server refusing a sale because a price moved?
 *
 * The server sends the refusal as a Convex error carrying a payload, so the
 * details arrive with the error rather than having to be parsed out of a
 * sentence.
 */
export function readPriceChange(error: unknown): PriceChangeNotice | null {
    const data = (error as { data?: unknown } | null)?.data;
    if (!data || typeof data !== "object") return null;

    const payload = data as { code?: unknown; changes?: unknown; total?: unknown };
    if (payload.code !== "PRICE_CHANGED") return null;
    if (!Array.isArray(payload.changes)) return null;

    const changes = payload.changes.filter(isPriceChangeLine);
    if (changes.length === 0) return null;

    return {
        changes,
        total: typeof payload.total === "number" ? payload.total : 0,
    };
}

function isPriceChangeLine(value: unknown): value is PriceChangeLine {
    if (!value || typeof value !== "object") return false;
    const line = value as Partial<PriceChangeLine>;
    return (
        typeof line.name === "string" &&
        typeof line.quotedPrice === "number" &&
        typeof line.chargedPrice === "number" &&
        typeof line.quantity === "number"
    );
}

/**
 * Did the request fail because the network failed?
 *
 * This matters because the till keeps a failed sale in a durable queue, to
 * be sent when the network comes back. That is the right thing to do when
 * the network is down — the goods have gone and the customer has paid.
 *
 * It is the wrong thing to do when the server *refused* the sale. A sale
 * that was refused for a reason — not enough stock, over the credit limit,
 * a price that moved — must not be queued and retried as an offline sale:
 * the offline path is deliberately more forgiving, and it would go ahead
 * and record the very sale the server just said no to.
 */
export function isNetworkFailure(error: unknown): boolean {
    if (!error) return false;

    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();

    // The browser's own wording for a request that never left the device.
    const networkPhrases = [
        "failed to fetch",
        "networkerror",
        "network request failed",
        "err_internet_disconnected",
        "err_network_changed",
        "load failed",
        "the internet connection appears to be offline",
        "connection closed",
        "websocket",
        "timed out",
        "timeout",
        "econnrefused",
        "econnreset",
    ];

    return networkPhrases.some((phrase) => lowered.includes(phrase));
}
