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
import type { Id } from "./_generated/dataModel";
import { logActivity } from "./tenancy";

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
    priceOverrides?: Array<{ stockId: Id<"stocks">; price: number }>;
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
    /** Set when the sale was made offline and is arriving later. */
    offline?: OfflineContext;
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
    offline: boolean
): "confirmed" | "pending_verification" | undefined {
    if (!offline) return undefined; // an online sale is confirmed as it is taken
    if (!paymentMode) return undefined;
    if (paymentMode === "Loan") return undefined; // not a payment at all
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

    const { businessId, userId, allowPriceOverrides, offline } = options;

    // Everything the sale refers to must belong to this business.
    if (args.customerId) {
        const customer = await ctx.db.get(args.customerId);
        if (!customer || customer.businessId !== businessId) {
            throw new ConvexError("Forbidden: that customer belongs to another business.");
        }
    }
    if (args.shopId) {
        const shop = await ctx.db.get(args.shopId);
        if (!shop || shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }
    }

    // Idempotency: if this sale was already recorded — by an earlier push
    // that arrived while this one was in flight — return it as it is.
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
            unitPrice = override;
            appliedOverrides.push({
                stockId: item.stockId,
                name: item.name,
                originalPrice: stock.price,
                price: override,
            });
        }
        computedTotal += unitPrice * item.quantity;
        return {
            ...item,
            price: unitPrice,
            pv: stock.pv,
            bv: stock.bv,
        };
    });

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
    const totalDiffers = Math.abs(computedTotal - args.total) > 0.01;
    if (totalDiffers && !offline) {
        throw new Error(
            `Sale total mismatch: client sent ${args.total} but the server computed ${computedTotal}.`
        );
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
        const updatedStocks = [...shop.issuedStocks];

        for (const item of trustedItems) {
            const stockIndex = updatedStocks.findIndex(s => s.stockId === item.stockId);
            if (stockIndex === -1) {
                throw new Error(`Item ${item.name} not found in shop stock`);
            }

            const currentQty = updatedStocks[stockIndex].qty;
            // Negative stock is allowed by design, so a sale that has
            // already happened is never refused for want of stock. The
            // shortfall is recorded as a conflict instead.

            updatedStocks[stockIndex] = {
                ...updatedStocks[stockIndex],
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

            // Negative stock is allowed by design — see the note above.

            await ctx.db.patch(item.stockId, {
                qty: stock.qty - item.quantity,
            });
        }
    }

    // Record the sale
    const saleId = await ctx.db.insert("sales", {
        businessId,
        customerId: args.customerId,
        manualCustomerName: args.manualCustomerName,
        shopId: shop ? shop._id : args.shopId, // Prioritize found shop, else fallback to arg
        userId,
        total: computedTotal,
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
        clientOfflineId: args.clientOfflineId,
        isOfflineSync: args.isOfflineSync,
        occurredAt: offline?.occurredAt ?? date,
        deviceId: offline?.deviceId,
        clientTransactionId: offline?.transactionId ?? args.clientOfflineId,
        clientTotal: offline && totalDiffers ? args.total : undefined,
        paymentConfirmation: resolvePaymentConfirmation(args.paymentMode, Boolean(offline)),
        syncSource: offline ? "offline" : "online",
        hasPriceOverride: appliedOverrides.length > 0,
        priceOverrides: appliedOverrides.length > 0 ? appliedOverrides : undefined,
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
        const deposit = args.initialDeposit || 0;
        const loanBalance = computedTotal - deposit;

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
                date: new Date().toISOString(),
                balance: loanBalance,
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
