/**
 * SMARTBUZ — reversing a sale.
 *
 * The same compensation has to happen wherever a sale turns out to be
 * wrong:
 *
 *   - a refund at the till, and
 *   - an offline sale that the owner rejects when the conflict comes back.
 *
 * They used to be two different stories. The refund did the work — the
 * goods went back, the money came off, the ledger was written — and the
 * rejection did nothing at all except mark the conflict "resolved". The
 * sale stood, the stock stayed gone, the money stayed taken, and the owner
 * was told the problem had been dealt with.
 *
 * So the work lives here, once, and both paths call it.
 */

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stripIssuedStockCopies } from "./counterStock";

/** One line of a reversal. */
export interface CompensationLine {
    stockId: Id<"stocks">;
    quantity: number;
}

/** What a reversal did. */
export interface CompensationResult {
    refundedItems: {
        stockId: Id<"stocks">;
        name: string;
        productCode?: string;
        quantity: number;
        amount: number;
    }[];
    refundTotal: number;
    totalRefunded: number;
    fullyRefunded: boolean;
}

/**
 * Restate the running balance on each of a loan's payments.
 *
 * A payment carries the balance that was left after it, so a statement read
 * oldest-first tells the story of the debt. When the loan's amount is
 * corrected — because the sale it belongs to was edited, or refunded — that
 * story has to be told again against the new amount, or the statement and
 * the loan disagree about the same money.
 */
export async function restateLoanPaymentBalances(
    ctx: MutationCtx,
    loanId: Id<"loans">,
    amount: number
): Promise<void> {
    const payments = await ctx.db
        .query("payments")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .collect();

    const ordered = [...payments].sort((a, b) =>
        String(a.date ?? "").localeCompare(String(b.date ?? ""))
    );

    let running = amount;
    for (const payment of ordered) {
        running -= payment.amount ?? 0;
        const balance = Math.max(0, running);
        if (payment.balance !== balance) {
            await ctx.db.patch(payment._id, { balance });
        }
    }
}

/**
 * Reverse the given lines of a sale.
 *
 * Everything the reversal touches is worked out on the server:
 *
 *   - the amount is the price that was actually charged, not the one the
 *     browser sends;
 *   - the goods go back to the place they came from — a counter sale goes
 *     back to its counter, a warehouse sale goes back to the warehouse;
 *   - the movement is written to the ledger;
 *   - and if the sale was on credit, the debt book is corrected, because a
 *     customer who has been given their money back does not still owe it.
 */
export async function reverseSaleLines(
    ctx: MutationCtx,
    args: {
        businessId: Id<"businesses">;
        userId: Id<"users">;
        sale: Doc<"sales">;
        lines: CompensationLine[];
        reason: string;
    }
): Promise<CompensationResult> {
    const { businessId, userId, sale, lines, reason } = args;

    const alreadyRefunded = new Map<string, number>();
    for (const item of sale.refundedItems ?? []) {
        alreadyRefunded.set(item.stockId, (alreadyRefunded.get(item.stockId) ?? 0) + item.quantity);
    }

    const refundedItems: CompensationResult["refundedItems"] = [];
    let refundTotal = 0;

    for (const line of lines) {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            throw new ConvexError("Refund quantities must be positive.");
        }

        const soldLine = sale.items.find((i) => i.stockId === line.stockId);
        if (!soldLine) {
            throw new ConvexError("Forbidden: that product was not on this sale.");
        }

        const already = alreadyRefunded.get(line.stockId) ?? 0;
        if (already + line.quantity > soldLine.quantity) {
            throw new ConvexError(
                `Cannot refund ${line.quantity} of ${soldLine.name} - only ${
                    soldLine.quantity - already
                } remain on this sale.`
            );
        }

        // The stock must belong to this business.
        const stock = await ctx.db.get(line.stockId);
        if (!stock || stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        // The amount refunded is computed on the server from the price that
        // was actually charged, never from the browser.
        const amount = soldLine.price * line.quantity;
        refundTotal += amount;

        refundedItems.push({
            stockId: line.stockId,
            name: soldLine.name,
            productCode: soldLine.productCode,
            quantity: line.quantity,
            amount,
        });

        // -----------------------------------------------------------------
        // THE GOODS GO BACK WHERE THEY CAME FROM
        //
        // A sale made at a counter was deducted from that counter's stock.
        // Crediting the master warehouse instead put the goods in a place
        // the customer never took them from: the counter's stock stayed too
        // low and the warehouse's became too high, so the business looked
        // like it owned more than it did — and the next person to count the
        // shelves would not agree with the books.
        // -----------------------------------------------------------------
        if (sale.shopId) {
            const shop = await ctx.db.get(sale.shopId);
            if (!shop || shop.businessId !== businessId) {
                throw new ConvexError("Forbidden: that shop belongs to another business.");
            }
            const shopStocks = stripIssuedStockCopies(shop.issuedStocks ?? []);
            const index = shopStocks.findIndex((s) => s.stockId === line.stockId);
            if (index >= 0) {
                shopStocks[index] = {
                    stockId: shopStocks[index].stockId,
                    qty: shopStocks[index].qty + line.quantity,
                };
            } else {
                // The counter no longer lists the product — it was sold out
                // and removed. It is still the counter's goods, so they go
                // back on its list.
                shopStocks.push({
                    stockId: line.stockId,
                    qty: line.quantity,
                });
            }
            await ctx.db.patch(shop._id, { issuedStocks: shopStocks });
        } else {
            await ctx.db.patch(line.stockId, { qty: stock.qty + line.quantity });
        }

        await ctx.db.insert("stockLedger", {
            businessId,
            stockId: line.stockId,
            shopId: sale.shopId,
            deltaQty: line.quantity,
            eventType: "SALE_REFUND",
            referenceId: sale.invoiceNumber || sale._id,
            userId,
            timestamp: new Date().toISOString(),
            notes: `Refund of ${soldLine.name} (${line.quantity}) on sale ${
                sale.invoiceNumber || sale._id
            }`,
        });
    }

    const nextRefunded = [...(sale.refundedItems ?? []), ...refundedItems];
    const totalRefunded = (sale.refundAmount ?? 0) + refundTotal;
    const isFullyRefunded = totalRefunded >= sale.total;

    await ctx.db.patch(sale._id, {
        refundedItems: nextRefunded,
        refundAmount: totalRefunded,
        refundedAt: new Date().toISOString(),
        refundedBy: userId,
        refundReason: reason,
        deliveryStatus: isFullyRefunded ? "Refunded" : sale.deliveryStatus,
    });

    // -----------------------------------------------------------------
    // THE DEBT BOOK KNOWS ABOUT THE REFUND
    //
    // A credit sale that is refunded used to keep its full outstanding
    // balance: the customer had already received the money back, the goods
    // had gone back on the shelf, and the books still said they owed the
    // lot. The receivable was inflated by the amount of every refund ever
    // made.
    // -----------------------------------------------------------------
    if (refundTotal > 0 && (sale.isLoan || sale.paymentMode === "Loan")) {
        const loan = await ctx.db
            .query("loans")
            .withIndex("by_salesId", (q) => q.eq("salesId", sale._id))
            .first();
        if (loan) {
            const newAmount = Math.max(0, (loan.amount ?? 0) - refundTotal);
            const newBalance = Math.max(0, (loan.balance ?? 0) - refundTotal);
            await ctx.db.patch(loan._id, {
                amount: newAmount,
                balance: newBalance,
            });
            await restateLoanPaymentBalances(ctx, loan._id, newAmount);
        }
    }

    return {
        refundedItems,
        refundTotal,
        totalRefunded,
        fullyRefunded: isFullyRefunded,
    };
}
