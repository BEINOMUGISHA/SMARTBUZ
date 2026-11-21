/**
 * SMARTBUZ — the sale, applied.
 *
 * The rules for turning a basket of goods into a sale live here, in one
 * place, so that the till and the offline synchroniser cannot disagree
 * about them.
 *
 * Both paths go through `applySale`:
 *
 *   • `sales.create` — a sale made with the network up.
 *   • `sync.pushTransactions` — a sale made while offline, arriving later.
 *
 * A sale that arrives late must be recorded *exactly* as if it had arrived
 * on time: the same prices, the same total, the same stock movement, the
 * same promotion triggers. If the two paths were written separately they
 * would drift apart within a release, and the books would stop matching the
 * tills.
 *
 * Two things are different for an offline sale, and both are passed in
 * through `options.offline`:
 *
 *   • **When it happened.** An offline sale belongs to the day it was rung
 *     up, not the day it found the network.
 *   • **Whether the money is confirmed.** An offline mobile-money payment
 *     has been seen by nobody but the customer and the cashier. It is
 *     recorded as pending verification, never as confirmed.
 */

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logActivity } from "./tenancy";
import { outstandingBalance } from "./customers";
import { salePaymentModeToMethod } from "./paymentRules";
import { stripIssuedStockCopies } from "./counterStock";

/**
 * How far back a till may date an offline sale.
 *
 * Without a bound, a client could date a sale to any day in the past and
 * move revenue between reporting periods.
 */
export const MAX_OFFLINE_BACKDATE_DAYS = 30;

/** How far into the future a till may date an offline sale. */
export const MAX_OFFLINE_FUTURE_MINUTES = 5;

/**
 * Payment methods whose money has not been seen by anybody else.
 *
 * Cash in the drawer is the business's money. A mobile-money transfer that
 * was made on a phone that had no signal is a promise, not a payment, until
 * it is checked against the provider's own record.
 */
export const UNCONFIRMED_PAYMENT_MODES = [
    "Mobile Money",
    "Bank Transfer",
    "Card",
    "Cheque",
];

export interface SaleLineInput {
    stockId: Id<"stocks">;
    name: string;
    productCode?: string;
    price: number;
    quantity: number;
    pv: number;
    bv: number;
    /** What the till believed was on hand, for an offline sale. */
    expectedQty?: number;
}

export interface SaleInput {
    customerId?: Id<"customers">;
    manualCustomerName?: string;
    shopId?: Id<"shops">;
    userId: Id<"users">;
    total: number;
    clientType: string;
    paymentMode: string;
    items: SaleLineInput[];
    isLoan?: boolean;
    paymentDueDate?: string;
    initialDeposit?: number;
    packageType?: string;
    deliveryStatus?: string;
    customerPhone?: string;
    customerLocation?: string;
    transactionType?: string;
    clientOfflineId?: string;
    isOfflineSync?: boolean;
    /**
     * The payment provider's reference, when the payment was taken
     * through a provider.
     */
    paymentReference?: string;
    priceOverrides?: Array<{ stockId: Id<"stocks">; price: number }>;
    /**
     * The seller has seen that a price changed and has agreed to the new one.
     *
     * Without this, a live sale whose price moved between filling the basket
     * and ringing it up is refused: the customer agreed to one figure and
     * cannot be charged another without being told. With it, the sale goes
     * through at the catalogue's price and the change is recorded on the
     * sale.
     */
    acceptPriceChanges?: boolean;
}

export interface OfflineContext {
    /** The installation that made the sale. */
    deviceId: string;
    /** The unique id of the transaction. */
    transactionId: string;
    /** When the sale happened on the till. */
    occurredAt: string;
}

export interface ApplySaleOptions {
    businessId: Id<"businesses">;
    userId: Id<"users">;
    /** Whether this business allows till-level price overrides. */
    allowPriceOverrides: boolean;
    /**
     * Whether the seller may take a line below the price floor.
     *
     * The floor is what stops a till giving the goods away; going under it
     * is a manager's decision, so the permission is checked on the server
     * and never taken from the browser.
     */
    canOverrideBelowFloor?: boolean;
    /** Set when the sale was made offline and is arriving later. */
    offline?: OfflineContext;
}

/**
 * The floor used when the business does not know what a product cost.
 *
 * Half the list price: a discount is still a discount, but a seller cannot
 * halve the price of everything without somebody noticing.
 */
const PRICE_OVERRIDE_FALLBACK_RATIO = 0.5;

/**
 * The lowest price a till may sell an item for on its own authority.
 *
 * The floor exists because an override without one is a blank cheque: a
 * seller can type zero and hand the goods over for nothing, and the books
 * then show a sale that earns nothing.
 *
 * The cost price sets the floor when the business knows it — selling below
 * cost loses money on every unit — and half the list price stands in when
 * it does not. The floor is never above the list price, so the list price
 * itself is always allowed.
 */
export function priceOverrideFloor(stock: {
    price: number;
    purchasePrice?: number;
}): number {
    const listPrice = stock.price;
    const cost = stock.purchasePrice ?? 0;
    const floor = cost > 0 ? cost : listPrice * PRICE_OVERRIDE_FALLBACK_RATIO;
    return Math.min(listPrice, floor);
}


export interface StockConflict {
    stockId: Id<"stocks">;
    name: string;
    /** What the till believed was on hand. */
    expectedQty?: number;
    /** What the server says is on hand now. */
    availableQty: number;
    /** What the sale needed. */
    requestedQty: number;
    /** insufficient | drift */
    kind: "insufficient" | "drift";
    reason: string;
}

export interface ApplySaleResult {
    saleId: Id<"sales">;
    invoiceNumber?: string;
    redemptions: any[];
    /** True when this sale had already been recorded. */
    isDuplicateSync?: boolean;
    /** The stock conflicts this sale ran into. */
    conflicts: StockConflict[];
    /** What the books say the sale came to. */
    total: number;
    /** What the till said it came to, when they differ. */
    clientTotal?: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Invoice numbers
 * ──────────────────────────────────────────────────────────────────────── */

export async function generateInvoiceNumber(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    shopId?: Id<"shops">
) {
    let prefix = "HQ";

    if (shopId) {
        const shop = await ctx.db.get(shopId);
        if (shop && shop.serialNumber) {
            // Extract the first part of the serial number (e.g., "MBR" from "MBR-101")
            prefix = shop.serialNumber.split("-")[0];
        }
    }

    const counterName = `invoice_${prefix}`;
    // Invoice sequences are per business: two businesses may both issue
    // "MBR-001" without colliding.
    const counter = await ctx.db
        .query("counters")
        .withIndex("by_businessId_name", (q) =>
            q.eq("businessId", businessId).eq("name", counterName)
        )
        .first();

    let nextValue = 1; // Start from 001
    if (counter) {
        nextValue = counter.lastValue + 1;
        await ctx.db.patch(counter._id, { lastValue: nextValue });
    } else {
        await ctx.db.insert("counters", { businessId, name: counterName, lastValue: nextValue });
    }

    return `${prefix}-${String(nextValue).padStart(3, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Promotions
 * ──────────────────────────────────────────────────────────────────────── */

interface ProcessPromotionParams {
    businessId: Id<"businesses">;
    salesId: Id<"sales">;
    customerId?: Id<"customers">;
    userId: Id<"users">;
    shopId?: Id<"shops">;
    date: string;
    items: Array<{
        stockId: Id<"stocks">;
        name: string;
        productCode?: string;
        quantity: number;
        pv: number;
        bv: number;
    }>;
}

export async function processPromotionTriggers(ctx: MutationCtx, params: ProcessPromotionParams) {
    const triggeredRedemptions: any[] = [];
    // Only the promotions of this business can trigger.
    const activePromotions = await ctx.db
        .query("promotions")
        .withIndex("by_businessId", (q) => q.eq("businessId", params.businessId))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();

    if (activePromotions.length === 0) return triggeredRedemptions;

    const activePromoIds = new Set(activePromotions.map((p) => p._id));
    const cartStockIds = new Set(params.items.map((i) => i.stockId));
    const allPromotionProducts = await ctx.db
        .query("promotionProducts")
        .withIndex("by_businessId", (q) => q.eq("businessId", params.businessId))
        .collect();
    const relevantPromoProducts = allPromotionProducts.filter(
        (pp) => activePromoIds.has(pp.promotionId) && cartStockIds.has(pp.stockId)
    );

    // 1. Product Triggers
    for (const item of params.items) {
        const triggers = relevantPromoProducts.filter((pp) => pp.stockId === item.stockId);
        for (const trigger of triggers) {
            const promotion = activePromotions.find((p) => p._id === trigger.promotionId);
            if (!promotion) continue;
            const redemptionCount = Math.floor(item.quantity / trigger.requiredQuantity);
            if (redemptionCount > 0) {
                const redemptionData = {
                    promotionId: promotion._id,
                    salesId: params.salesId,
                    customerId: params.customerId,
                    userId: params.userId,
                    shopId: params.shopId,
                    date: params.date,
                    redeemedQuantity: redemptionCount,
                    productName: item.name,
                    productCode: item.productCode,
                    prize: promotion.prize,
                };
                await ctx.db.insert("promotionRedemptions", { businessId: params.businessId, ...redemptionData });
                triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
            }
        }
    }

    // 2. Global Threshold Triggers (Total PV/BV)
    const totalPV = params.items.reduce((sum, item) => sum + item.pv * item.quantity, 0);
    const totalBV = params.items.reduce((sum, item) => sum + item.bv * item.quantity, 0);

    for (const promotion of activePromotions) {
        if (promotion.triggerType === "TotalPV" && promotion.threshold && totalPV >= promotion.threshold) {
            const redemptionCount = Math.floor(totalPV / promotion.threshold);
            if (redemptionCount > 0) {
                const redemptionData = {
                    promotionId: promotion._id,
                    salesId: params.salesId,
                    customerId: params.customerId,
                    userId: params.userId,
                    shopId: params.shopId,
                    date: params.date,
                    redeemedQuantity: redemptionCount,
                    productName: "WHOLE SALE (PV)",
                    productCode: "THRESHOLD",
                    prize: promotion.prize,
                };
                await ctx.db.insert("promotionRedemptions", { businessId: params.businessId, ...redemptionData });
                triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
            }
        } else if (promotion.triggerType === "TotalBV" && promotion.threshold && totalBV >= promotion.threshold) {
            const redemptionCount = Math.floor(totalBV / promotion.threshold);
            if (redemptionCount > 0) {
                const redemptionData = {
                    promotionId: promotion._id,
                    salesId: params.salesId,
                    customerId: params.customerId,
                    userId: params.userId,
                    shopId: params.shopId,
                    date: params.date,
                    redeemedQuantity: redemptionCount,
                    productName: "WHOLE SALE (BV)",
                    productCode: "THRESHOLD",
                    prize: promotion.prize,
                };
                await ctx.db.insert("promotionRedemptions", { businessId: params.businessId, ...redemptionData });
                triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
            }
        }
    }

    return triggeredRedemptions;
}

/* ────────────────────────────────────────────────────────────────────────
 * The date an offline sale belongs to
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The moment an offline sale happened, checked against the clock.
 *
 * A till may be a little out of time, and it may have been switched off for
 * a while — but it may not date a sale to last year, or to next week.
 */
export function resolveOccurredAt(
    occurredAt: string | undefined,
    now: Date = new Date()
): { date: string; adjusted: boolean } {
    const serverNow = now.toISOString();
    if (!occurredAt) return { date: serverNow, adjusted: false };

    const parsed = new Date(occurredAt);
    if (Number.isNaN(parsed.getTime())) {
        return { date: serverNow, adjusted: true };
    }

    const earliest = now.getTime() - MAX_OFFLINE_BACKDATE_DAYS * 86_400_000;
    const latest = now.getTime() + MAX_OFFLINE_FUTURE_MINUTES * 60_000;

    if (parsed.getTime() < earliest || parsed.getTime() > latest) {
        return { date: serverNow, adjusted: true };
    }

    return { date: parsed.toISOString(), adjusted: false };
}

/**
 * Whether the money behind a sale has actually been confirmed.
 *
 * An offline sale paid by mobile money has **not** been confirmed by a
 * payment provider — nobody at the provider has seen it. It is recorded as
 * pending, and it stays pending until somebody checks it.
 */
export function resolvePaymentConfirmation(
    paymentMode: string | undefined,
    offline: boolean,
    hasProviderReference = false
): "confirmed" | "pending_verification" | undefined {
    if (!paymentMode) return undefined;
    if (paymentMode === "Loan") return undefined; // not a payment at all

    // A sale taken through a payment provider is only confirmed when the
    // provider says so. The cashier watching a prompt is not the same
    // thing as the provider confirming the money.
    if (hasProviderReference && UNCONFIRMED_PAYMENT_MODES.includes(paymentMode)) {
        return "pending_verification";
    }

    if (!offline) return undefined; // an online sale is confirmed as it is taken

    if (UNCONFIRMED_PAYMENT_MODES.includes(paymentMode)) {
        return "pending_verification";
    }
    return "confirmed";
}

/* ────────────────────────────────────────────────────────────────────────
 * Stock conflicts
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Compare what the till believed about the stock with what the server
 * knows.
 *
 * Two devices selling the same stock offline is the normal case in a busy
 * shop, not an error. The point is to *notice* it, not to refuse the sale:
 * the customer already has the goods.
 *
 *   • `drift`       — the stock moved since the till last saw it, but there
 *                     is still enough to cover the sale.
 *   • `insufficient` — there is not enough stock to cover the sale. The
 *                     sale is still applied (the goods have gone), but the
 *                     shortfall is recorded so the owner can act on it.
 */
export function detectStockConflicts(
    items: Array<{
        stockId: Id<"stocks">;
        name: string;
        quantity: number;
        expectedQty?: number;
    }>,
    available: Map<Id<"stocks">, number>
): StockConflict[] {
    const conflicts: StockConflict[] = [];

    for (const item of items) {
        const onHand = available.get(item.stockId);
        if (onHand === undefined) continue;

        if (onHand < item.quantity) {
            conflicts.push({
                stockId: item.stockId,
                name: item.name,
                expectedQty: item.expectedQty,
                availableQty: onHand,
                requestedQty: item.quantity,
                kind: "insufficient",
                reason: `Only ${onHand} on hand, but ${item.quantity} were sold. Another device may have sold the same stock while offline.`,
            });
            continue;
        }

        if (item.expectedQty !== undefined && item.expectedQty !== onHand) {
            conflicts.push({
                stockId: item.stockId,
                name: item.name,
                expectedQty: item.expectedQty,
                availableQty: onHand,
                requestedQty: item.quantity,
                kind: "drift",
                reason: `The till thought ${item.expectedQty} were on hand; the server says ${onHand}. The stock moved while this device was offline.`,
            });
        }
    }

    return conflicts;
}

/* ────────────────────────────────────────────────────────────────────────
 * The sale itself
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Check the shape of a sale before anything is done with it.
 *
 * The sale comes off a till that may have been running for days without a
 * network, and the record may have been corrupted along the way. The checks
 * are here rather than in the argument validator so that a malformed sale is
 * refused **on its own** — one bad record must not stop the rest of the
 * queue from being recorded.
 */
export function validateSaleInput(args: any): void {
    if (!args || typeof args !== "object") {
        throw new ConvexError("That sale was not readable.");
    }
    if (!Array.isArray(args.items) || args.items.length === 0) {
        throw new ConvexError("That sale had no items on it.");
    }
    if (!Number.isFinite(args.total) || args.total < 0) {
        throw new ConvexError("That sale had no valid total.");
    }
    if (typeof args.clientType !== "string" || !args.clientType) {
        throw new ConvexError("That sale had no customer type.");
    }
    if (typeof args.paymentMode !== "string" || !args.paymentMode) {
        throw new ConvexError("That sale had no payment method.");
    }

    for (const item of args.items) {
        if (!item || typeof item !== "object") {
            throw new ConvexError("One of the items on that sale was not readable.");
        }
        if (typeof item.stockId !== "string" || !item.stockId) {
            throw new ConvexError("One of the items on that sale had no product.");
        }
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
            throw new ConvexError(
                `Invalid quantity for ${item.name ?? "one of the items"}.`
            );
        }
    }
}

/* ────────────────────────────────────────────────────────────────────────
 * Idempotency
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How long two matching sale requests are treated as one sale.
 *
 * A till that loses the network sends the same request again, and a
 * cashier who taps the keypad twice sends it twice. Both arrive within a
 * few seconds of each other and carry the same body. Recording the
 * second one would take the stock a second time and put a second sale in
 * the books, so the server answers with the sale it already has.
 *
 * The window is deliberately short. Two genuinely separate sales of the
 * same basket by the same cashier must never be mistaken for one, so the
 * answer only stands for as long as a retry plausibly takes.
 */
export const IDEMPOTENCY_WINDOW_MS = 10_000;

/**
 * The prefix of a key the server made up for itself.
 *
 * A key that starts with this was not sent by a till, so it can never be
 * confused with a device's own transaction id.
 */
const SERVER_IDEMPOTENCY_PREFIX = "srv-";

/**
 * A short, stable fingerprint of a sale request.
 *
 * Two requests that describe the same sale in the same words must get the
 * same fingerprint, so that the second one can be recognised as a repeat
 * of the first. The operator and the shop are part of it on purpose: the
 * same basket sold by two different cashiers is two sales, not one.
 */
function saleRequestFingerprint(args: SaleInput, options: ApplySaleOptions): string {
    const items = args.items
        .map((i) => `${i.stockId}:${i.quantity}:${i.price}:${i.pv}:${i.bv}`)
        .sort()
        .join(",");
    const overrides = (args.priceOverrides ?? [])
        .map((o) => `${o.stockId}:${o.price}`)
        .sort()
        .join(",");
    return [
        options.businessId,
        args.shopId ?? "hq",
        options.userId,
        args.customerId ?? args.manualCustomerName ?? "walk-in",
        args.clientType ?? "",
        args.paymentMode ?? "",
        args.transactionType ?? "Sale",
        String(args.total ?? 0),
        items,
        overrides,
    ].join("|");
}

/**
 * A 64-bit hash of a fingerprint, written out as hex.
 *
 * The fingerprint is far too long to keep in an index, and it holds names
 * and prices, which are nobody else's business but the business's.
 */
function fingerprintHash(text: string): string {
    let low = 0x811c9dc5;
    let high = 0x01000193;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        low = Math.imul(low ^ code, 0x01000193) >>> 0;
        high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
    return (
        low.toString(16).padStart(8, "0") + high.toString(16).padStart(8, "0")
    );
}

/**
 * The key the server uses to recognise a repeat of this sale.
 *
 * A till that can name its own transaction sends that name and the server
 * believes it. A till that cannot (the online path today) gets a key made
 * from the shape of the request, so that a retry of the same request is
 * still recognised as the same sale rather than as a new one.
 */
export function deriveServerIdempotencyKey(
    args: SaleInput,
    options: ApplySaleOptions
): string {
    return (
        SERVER_IDEMPOTENCY_PREFIX +
        fingerprintHash(saleRequestFingerprint(args, options))
    );
}

/**
 * The VAT on a sale, worked out from the business's own tax settings.
 *
 * The settings on the business record were themselves decided by the
 * server when the business was set up — `convex/verticals/tax.ts` holds
 * the URA registry, and the rate in force for the business's trade is
 * whatever that registry says. So this function reads a stored rate; it
 * does not accept one.
 *
 * An **inclusive** price is one the customer paid with the tax already in
 * it: the tax is inside the total, and the net is what is left once it is
 * taken out. An **exclusive** price is one the tax is added on top of, so
 * the net is the price and the tax is on top of it.
 */
async function resolveSaleTax(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    grossTotal: number
): Promise<{
    amount: number;
    net: number;
    rate: number;
    inclusive: boolean;
    note?: string;
}> {
    const business = await ctx.db.get(businessId);
    if (!business || business.taxEnabled !== true) {
        // No tax on this business's account. The split is still recorded —
        // as zero — so that a report never has to guess whether a missing
        // figure means "no tax" or "never recorded".
        return { amount: 0, net: grossTotal, rate: 0, inclusive: false };
    }

    const rate = Number(business.taxRate ?? 0);
    if (!Number.isFinite(rate) || rate <= 0) {
        return { amount: 0, net: grossTotal, rate: 0, inclusive: false };
    }

    const inclusive = business.taxInclusive !== false;

    if (inclusive) {
        const amount = round2((grossTotal * rate) / (100 + rate));
        return {
            amount,
            net: round2(grossTotal - amount),
            rate,
            inclusive: true,
            note: business.taxNote,
        };
    }

    const amount = round2((grossTotal * rate) / 100);
    return {
        amount,
        net: round2(grossTotal),
        rate,
        inclusive: false,
        note: business.taxNote,
    };
}

/** Two decimal places, without the floating-point dust. */
function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Is this sale one the customer is going to owe for?
 *
 * Two things mark it: the till saying it is a loan, and the till naming
 * `Loan` as the payment mode. They are recorded separately — a sale can be
 * a loan without a due date, and a payment mode can be `Loan` on a sale that
 * was paid in full — so both are checked.
 */
function isCreditSale(args: {
    isLoan?: boolean;
    paymentMode?: string;
}): boolean {
    if (args.isLoan === true) return true;
    const mode = (args.paymentMode ?? "").trim().toLowerCase();
    return mode === "loan" || mode === "credit";
}

/**
 * Record a sale.
 *
 * The client is never trusted for money: prices are re-read from the
 * `stocks` table and the total is recomputed here. Everything the sale
 * refers to is checked against the tenant.
 */
export async function applySale(
    ctx: MutationCtx,
    args: SaleInput,
    options: ApplySaleOptions
): Promise<ApplySaleResult> {
    validateSaleInput(args);

    const {
        businessId,
        userId,
        allowPriceOverrides,
        canOverrideBelowFloor = false,
        offline,
    } = options;

    // Everything the sale refers to must belong to this business.
    let saleCustomer: Doc<"customers"> | null = null;
    if (args.customerId) {
        const customer = await ctx.db.get(args.customerId);
        if (!customer || customer.businessId !== businessId) {
            throw new ConvexError("Forbidden: that customer belongs to another business.");
        }
        saleCustomer = customer;
    }
    if (args.shopId) {
        const shop = await ctx.db.get(args.shopId);
        if (!shop || shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }
    }

    // Idempotency: if this sale was already recorded — by an earlier push
    // that arrived while this one was in flight — return it as it is.
    //
    // The same thing happens on the online path: a till that loses the
    // network sends the request again, and a cashier who taps the keypad
    // twice sends it twice. Recording the second one would take the stock a
    // second time and put a second sale in the books, so the sale the
    // server already has is handed back instead.
    //
    // A till that names its own transaction is believed: that name is its
    // key for good. A till that does not — the online path today — gets a
    // key made from the shape of the request, so a retry of that same
    // request is recognised as the same sale rather than as a new one.
    const serverKey = offline
        ? undefined
        : deriveServerIdempotencyKey(args, options);
    const idempotencyKey = args.clientOfflineId ?? serverKey;

    if (args.clientOfflineId) {
        const existingSale = await ctx.db
            .query("sales")
            .withIndex("by_clientOfflineId", (q) => q.eq("clientOfflineId", args.clientOfflineId!))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .first();
        if (existingSale) {
            return {
                saleId: existingSale._id,
                invoiceNumber: existingSale.invoiceNumber,
                redemptions: [],
                isDuplicateSync: true,
                conflicts: [],
                total: existingSale.total,
            };
        }
    } else if (serverKey) {
        // A key the server made up only stands for as long as a retry
        // plausibly takes. After that the same basket is a new sale again.
        const cutoff = Date.now() - IDEMPOTENCY_WINDOW_MS;
        const candidates = await ctx.db
            .query("sales")
            .withIndex("by_clientOfflineId", (q) => q.eq("clientOfflineId", serverKey))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .collect();
        const repeated = candidates
            .map((sale) => ({
                sale,
                at: Date.parse(sale.occurredAt ?? sale.date),
            }))
            .filter((entry) => Number.isFinite(entry.at) && entry.at >= cutoff)
            .sort((a, b) => b.at - a.at)[0];
        if (repeated) {
            return {
                saleId: repeated.sale._id,
                invoiceNumber: repeated.sale.invoiceNumber,
                redemptions: [],
                isDuplicateSync: true,
                conflicts: [],
                total: repeated.sale.total,
            };
        }
    }

    // When did it happen? An offline sale belongs to the day it was rung up.
    const { date } = resolveOccurredAt(offline?.occurredAt);

    // -----------------------------------------------------------------
    // SERVER-SIDE PRICE + TOTAL VALIDATION
    // The client is not trusted for money. Prices are re-read from the
    // `stocks` table and the total is recomputed server-side, so a
    // tampered client cannot record a sale for less than it is worth
    // (or inflate profit reports).
    // -----------------------------------------------------------------
    const stockIdsForPricing = [...new Set(args.items.map((i) => i.stockId))];
    const pricingDocs = await Promise.all(stockIdsForPricing.map((id) => ctx.db.get(id)));
    const pricingMap = new Map(
        pricingDocs.filter((s): s is NonNullable<typeof s> => s !== null).map((s) => [s._id, s])
    );

    // -----------------------------------------------------------------
    // PRICE OVERRIDES (opt-in per business)
    // A cashier may lower a line price at the till, but only when the
    // business has explicitly enabled overrides. When the setting is off,
    // any override sent by the client is ignored and the master price is
    // charged — the client still cannot falsify revenue.
    // -----------------------------------------------------------------
    const overrideMap = new Map<Id<"stocks">, number>();
    if (allowPriceOverrides) {
        for (const override of args.priceOverrides ?? []) {
            if (!Number.isFinite(override.price) || override.price < 0) {
                throw new Error(`Invalid price override for ${override.stockId}`);
            }
            overrideMap.set(override.stockId, override.price);
        }
    }

    const appliedOverrides: {
        stockId: Id<"stocks">;
        name: string;
        originalPrice: number;
        price: number;
    }[] = [];

    let computedTotal = 0;
    // The unrounded sum, kept only to compare against the total the client
    // sent. The money that is stored is rounded; the comparison is not, so a
    // client that summed the basket at full precision is not refused over a
    // fraction of a cent.
    let rawTotal = 0;
    // The lines whose price had moved since the till showed the basket.
    // Collected here, because this is the one place where the price the
    // customer was quoted and the price the catalogue holds are both to
    // hand.
    const priceChanges: {
        stockId: Id<"stocks">;
        name: string;
        quotedPrice: number;
        chargedPrice: number;
        quantity: number;
    }[] = [];
    const trustedItems = args.items.map((item) => {
        const stock = pricingMap.get(item.stockId);
        if (!stock) {
            throw new Error(`Item ${item.name} not found`);
        }
        if (stock.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that product belongs to another business."
            );
        }
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
            throw new Error(`Invalid quantity for ${item.name}`);
        }
        // Trust the server-side price, not the client-supplied one.
        let unitPrice = stock.price;
        const override = overrideMap.get(item.stockId);
        if (override !== undefined) {
            if (override > stock.price) {
                throw new Error(
                    `Price override for ${item.name} is above the list price (${stock.price}).`
                );
            }

            // The floor is the lowest price a seller may use on their own
            // authority. Under it, only a seller with the discount
            // permission may go.
            const floor = priceOverrideFloor(stock);
            let effectiveOverride = override;
            if (override < floor) {
                if (canOverrideBelowFloor) {
                    // Somebody with the discount permission is behind this
                    // till: the price they chose is the price charged.
                } else if (offline) {
                    // The sale has already happened: the goods are gone and
                    // the customer has paid. Refusing to record it would
                    // lose a real sale and leave the books short, so the
                    // price is raised to the floor and the difference is
                    // recorded with the sale, exactly as a stale price list
                    // on the till is handled.
                    effectiveOverride = floor;
                } else {
                    // A live sale. The customer agreed to a price, and a
                    // seller may not give the goods away: charging the
                    // customer something they did not agree to is not an
                    // option either, so the sale is refused and the till
                    // is told why.
                    throw new ConvexError(
                        `The price of ${item.name} may not be reduced below ${floor} without a discount permission.`
                    );
                }
            }
            unitPrice = effectiveOverride;
            appliedOverrides.push({
                stockId: item.stockId,
                name: item.name,
                originalPrice: stock.price,
                price: effectiveOverride,
            });
        }
        const lineAmount = unitPrice * item.quantity;
        rawTotal += lineAmount;
        // Each line is rounded to the currency and the total is the sum of
        // the rounded lines, so the figure on the receipt is the figure in
        // the ledger, to the cent.
        computedTotal += round2(lineAmount);

        // -----------------------------------------------------------------
        // HAS THE PRICE MOVED SINCE THE TILL SHOWED IT?
        //
        // The till showed the customer a price and the customer agreed to
        // it. The catalogue may have been changed since — by somebody in the
        // office, by another till, or by a price list that was updated while
        // this basket was being filled.
        //
        // When that happens, the sale does not quietly take the new price.
        // The difference is noticed, and a live sale is held until the
        // seller has put the new price to the customer. A customer who was
        // quoted 5,000 and is charged 5,500 has been short-changed, and the
        // person who can be asked about it is the one at the till.
        // -----------------------------------------------------------------
        const quotedPrice = Number.isFinite(item.price) ? item.price : unitPrice;
        if (Math.abs(quotedPrice - unitPrice) > 0.005) {
            priceChanges.push({
                stockId: item.stockId,
                name: stock.name,
                quotedPrice,
                chargedPrice: unitPrice,
                quantity: item.quantity,
            });
        }

        return {
            ...item,
            // The product's identity comes from the server's catalogue, not
            // from the browser. A client that renamed a line in transit would
            // otherwise put a name on the receipt that does not match the
            // product it was charged for — and that receipt is the record the
            // customer and the tax authority both rely on.
            name: stock.name,
            productCode: stock.productCode,
            price: unitPrice,
            pv: stock.pv,
            bv: stock.bv,
        };
    });
    computedTotal = round2(computedTotal);

    // -----------------------------------------------------------------
    // A PRICE THAT MOVED UNDER THE BASKET
    //
    // A live sale is held: the customer agreed to a price, and the only
    // person who can agree to a different one is the seller standing in
    // front of them. The error carries the new figures so the till can put
    // them to the customer and re-send the sale once the customer has been
    // told.
    //
    // An offline sale cannot be held. The goods have gone and the customer
    // has paid what the till's price list said. Refusing to record it now
    // would lose a real sale and leave the books short, so the catalogue's
    // price wins and the difference is recorded on the sale, where it can
    // be seen and explained.
    // -----------------------------------------------------------------
    if (priceChanges.length > 0 && !offline && !args.acceptPriceChanges) {
        throw new ConvexError({
            code: "PRICE_CHANGED",
            message:
                "The price of " +
                priceChanges
                    .map((c) => `${c.name} (was ${c.quotedPrice}, now ${c.chargedPrice})`)
                    .join(", ") +
                " changed while the sale was being rung up. Confirm the new price with the customer and try again.",
            changes: priceChanges,
            total: computedTotal,
        });
    }

    // Guard against a client submitting a mismatched total (e.g. 0).
    //
    // A live sale that does not add up is refused: the cashier can be told
    // straight away and nothing has happened yet.
    //
    // An offline sale is different. The goods have gone and the customer
    // has been charged what the till's price list said. Refusing to record
    // it now would lose a real sale and leave the books wrong. The
    // server's price wins — that is what the books say the sale was — and
    // the difference is recorded so it can be explained.
    const totalDiffers = Math.abs(rawTotal - args.total) > 0.01;
    if (totalDiffers && !offline) {
        throw new Error(
            priceChanges.length > 0
                ? `Sale total mismatch: the client sent ${args.total} but the server computed ${rawTotal}. The prices changed, so the total has to be re-sent at the new prices.`
                : `Sale total mismatch: client sent ${args.total} but the server computed ${rawTotal}.`
        );
    }

    // -----------------------------------------------------------------
    // CREDIT LIMIT
    //
    // A credit limit that is displayed but never enforced is worse than no
    // limit at all: the owner believes the shop is protected, and the books
    // say otherwise. The limit is checked here, at the point of sale,
    // because that is the only moment at which refusing the sale is still
    // possible.
    //
    // A limit of zero means "no limit" — that is what the customer screens
    // show, and it is what a business that does not extend credit has.
    // -----------------------------------------------------------------
    if (saleCustomer && isCreditSale(args)) {
        const limit = saleCustomer.creditLimit ?? 0;
        if (limit > 0) {
            const outstanding = await outstandingBalance(ctx, saleCustomer._id);
            const deposit = Math.max(0, args.initialDeposit ?? 0);
            const adding = Math.max(0, computedTotal - deposit);
            if (outstanding + adding > limit) {
                throw new ConvexError(
                    `${saleCustomer.name} is over their credit limit. They owe ${outstanding}, this sale adds ${adding}, and their limit is ${limit}.`
                );
            }
        }
    }

    // Check if user is assigned to a shop in this business
    const shop = await ctx.db
        .query("shops")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("businessId"), businessId))
        .first();

    // What is on hand, right now, as the server sees it.
    const available = new Map<Id<"stocks">, number>();
    if (shop) {
        for (const issued of shop.issuedStocks) {
            available.set(issued.stockId as Id<"stocks">, issued.qty);
        }
    } else {
        for (const item of trustedItems) {
            const stock = await ctx.db.get(item.stockId);
            if (stock) available.set(item.stockId, stock.qty);
        }
    }

    // Did the stock move under this device while it was offline?
    const conflicts = offline
        ? detectStockConflicts(trustedItems, available)
        : [];

    // Deduct Stock
    if (shop) {
        // SHOP SALE: Deduct from shop.issuedStocks (ALLOW NEGATIVE)
        const updatedStocks = stripIssuedStockCopies(shop.issuedStocks);

        for (const item of trustedItems) {
            const stockIndex = updatedStocks.findIndex(s => s.stockId === item.stockId);
            if (stockIndex === -1) {
                throw new Error(`Item ${item.name} not found in shop stock`);
            }

            const currentQty = updatedStocks[stockIndex].qty;
            // A live sale may not sell what is not there.
            //
            // Selling stock that does not exist takes the position
            // negative, hides the shortfall, and leaves the books showing
            // more goods than were ever bought. The cashier is told which
            // product ran out and how many are left, so the sale can be put
            // right before the customer pays.
            //
            // The one exception is a position that is *already* negative:
            // the books are already wrong there, and refusing to sell it
            // would strand the product for good — it could never be sold
            // again until somebody counted the shelves. So the sale goes
            // through and the shortfall is recorded as a conflict, which is
            // what the conflict list is for.
            //
            // An offline sale is a different matter again: the goods have
            // gone and the customer has paid. Refusing it now would lose a
            // real sale and leave the books short, so the shortfall is
            // allowed and recorded as a conflict too.
            if (!offline && currentQty >= 0 && currentQty < item.quantity) {
                throw new ConvexError(
                    `Not enough ${item.name} in stock at ${shop.name}: ${currentQty} left, ${item.quantity} requested.`
                );
            }

            updatedStocks[stockIndex] = {
                stockId: updatedStocks[stockIndex].stockId,
                qty: currentQty - item.quantity
            };
        }

        // Update shop stocks
        await ctx.db.patch(shop._id, {
            issuedStocks: updatedStocks
        });

    } else {
        // HQ SALE: Deduct from main warehouse 'stocks' (ALLOW NEGATIVE)
        // [OPTIMIZED] Batch fetch all stocks first to avoid N+1
        const stockIds = trustedItems.map(i => i.stockId);
        const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s]));

        for (const item of trustedItems) {
            const stock = stockMap.get(item.stockId);
            if (!stock) {
                throw new Error(`Item ${item.name} not found in warehouse`);
            }

            // The same rule as the counter above: a live sale may not sell
            // stock that is not there. An offline sale may, because the goods
            // have already gone out of the door — and so may a sale of a
            // product whose position is already negative, because the books
            // are already wrong and refusing would strand it for good.
            if (!offline && stock.qty >= 0 && stock.qty < item.quantity) {
                throw new ConvexError(
                    `Not enough ${item.name} in stock: ${stock.qty} left, ${item.quantity} requested.`
                );
            }

            await ctx.db.patch(item.stockId, {
                qty: stock.qty - item.quantity,
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // The VAT on this sale
    // ────────────────────────────────────────────────────────────────────
    //
    // There used to be no VAT figure anywhere: the sale recorded a total,
    // and nothing said how much of it was tax. A business that has to file
    // a return had to work it out from the price list afterwards, and a
    // price list that has since changed gives the wrong answer.
    //
    // So the split is worked out **here**, at the moment the sale happens,
    // from the business's own stored tax configuration — never from
    // anything the browser sent — and it is stored on the sale. A report
    // then reads what was actually charged, which is the only figure that
    // can be defended.
    const tax = await resolveSaleTax(ctx, businessId, computedTotal);

    // Record the sale
    const saleId = await ctx.db.insert("sales", {
        businessId,
        customerId: args.customerId,
        manualCustomerName: args.manualCustomerName,
        shopId: shop ? shop._id : args.shopId, // Prioritize found shop, else fallback to arg
        userId,
        total: computedTotal,
        taxAmount: tax.amount,
        netAmount: tax.net,
        taxRate: tax.rate,
        taxInclusive: tax.inclusive,
        taxNote: tax.note,
        date,
        clientType: args.clientType,
        paymentMode: args.paymentMode,
        items: trustedItems,
        isLoan: args.isLoan,
        paymentDueDate: args.paymentDueDate,
        initialDeposit: args.initialDeposit,
        packageType: args.packageType,
        deliveryStatus: args.deliveryStatus,
        customerPhone: args.customerPhone,
        customerLocation: args.customerLocation,
        transactionType: args.transactionType || "Sale",
        invoiceNumber: await generateInvoiceNumber(ctx, businessId, shop ? shop._id : args.shopId),
        // The key that identifies this sale, so that a repeat of the same
        // request is answered with this sale instead of a second one. For
        // an offline sale it is the till's own transaction id; for an
        // online sale it is the key the server derived, unless the client
        // named the sale itself.
        clientOfflineId: idempotencyKey,
        isOfflineSync: args.isOfflineSync,
        occurredAt: offline?.occurredAt ?? date,
        deviceId: offline?.deviceId,
        clientTransactionId: offline?.transactionId ?? idempotencyKey,
        clientTotal: offline && totalDiffers ? args.total : undefined,
        paymentConfirmation: resolvePaymentConfirmation(
            args.paymentMode,
            Boolean(offline),
            Boolean(args.paymentReference)
        ),
        paymentReference: args.paymentReference,
        syncSource: offline ? "offline" : "online",
        hasPriceOverride: appliedOverrides.length > 0,
        priceOverrides: appliedOverrides.length > 0 ? appliedOverrides : undefined,
        // The lines whose price had moved between the basket being filled
        // and the sale being rung up. Written on the sale so that the
        // difference is a fact in the books and not a mystery on a till.
        priceChanges: priceChanges.length > 0 ? priceChanges : undefined,
    });

    const invoiceNumberValue = (await ctx.db.get(saleId))?.invoiceNumber;

    // Record immutable stock movements in stockLedger
    for (const item of trustedItems) {
        await ctx.db.insert("stockLedger", {
            businessId,
            stockId: item.stockId,
            shopId: shop ? shop._id : args.shopId,
            deltaQty: -item.quantity,
            eventType: "SALE",
            referenceId: invoiceNumberValue || saleId,
            userId,
            timestamp: date,
            notes: `Sale ${invoiceNumberValue || ""} to ${args.manualCustomerName || "Customer"}`,
        });
    }

    // ---------------------------------------------------------
    // PROMOTION TRIGGER LOGIC
    // ---------------------------------------------------------
    const triggeredRedemptions = await processPromotionTriggers(ctx, {
        businessId,
        salesId: saleId,
        customerId: args.customerId,
        userId,
        shopId: shop ? shop._id : args.shopId,
        date,
        items: trustedItems,
    });
    // ---------------------------------------------------------

    // Handle Loans
    if (args.isLoan && args.paymentDueDate) {
        // -----------------------------------------------------------------
        // THE DEPOSIT IS A MONEY FIELD
        //
        // The deposit is what the customer handed over against the credit
        // sale, and it was taken from the browser without being checked. A
        // deposit larger than the sale produced a **negative** loan balance,
        // which is a negative receivable in the financial summary and a
        // credit sale that can never be settled: the customer statement only
        // looks at loans with a positive balance, and refuses any payment
        // above it, so the account is stuck for ever.
        //
        // So the deposit is bounded here, between nothing and the whole
        // sale, and the balance is never allowed below zero.
        // -----------------------------------------------------------------
        const deposit = args.initialDeposit ?? 0;
        if (!Number.isFinite(deposit) || deposit < 0) {
            throw new ConvexError("The deposit on a credit sale cannot be negative.");
        }
        if (deposit > computedTotal) {
            throw new ConvexError(
                `The deposit (${deposit}) is more than the sale (${computedTotal}).`
            );
        }
        const loanBalance = Math.max(0, computedTotal - deposit);

        const loanId = await ctx.db.insert("loans", {
            businessId,
            customerId: args.customerId !== undefined ? args.customerId : undefined, // Explicitly undefined if missing
            manualCustomerName: args.manualCustomerName,
            salesId: saleId,
            amount: computedTotal,
            balance: loanBalance,
            date: new Date().toISOString(),
        });

        // If there's an initial deposit, record it as a payment
        if (deposit > 0) {
            await ctx.db.insert("payments", {
                businessId,
                loanId: loanId,
                shopId: shop?._id,
                customerId: args.customerId,
                amount: deposit,
                // The server stamps the payment; the date of the sale it was
                // taken with is kept beside it.
                date: new Date().toISOString(),
                paymentDate: date,
                balance: loanBalance,
                method: salePaymentModeToMethod(args.paymentMode),
            });
        }
    }

    // Log activity
    await logActivity(
        ctx,
        businessId,
        userId,
        "Create Sale",
        `${args.clientType} sale of ${computedTotal.toLocaleString()} created at ${shop ? shop.name : "HQ"}.`
    );

    return {
        saleId,
        invoiceNumber: invoiceNumberValue,
        redemptions: triggeredRedemptions,
        conflicts,
        total: computedTotal,
        clientTotal: offline && totalDiffers ? args.total : undefined,
    };
}
