/**
 * SMARTBUZ — the restaurant package.
 *
 * Tables, menus, orders and the kitchen.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The kitchen ticket
 * ────────────────────────────────────────────────────────────────────────
 *
 * A waiter fires an order and the kitchen sees it on a screen. The
 * ticket carries **its own copy** of the lines, not a reference back to
 * the table order.
 *
 * That is deliberate. If the waiter adds a dessert after the food is
 * already cooking, the ticket the kitchen is looking at must not change
 * underneath them — the kitchen would plate a different dish from the
 * one that was ordered. The added dish goes on a new ticket.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * No splits and no split bills — a table order is one bill. No waiter
 * tips. No order of the dishes within a ticket, and no way to plate two
 * tickets together. The kitchen display is a screen that refreshes, not
 * a terminal with its own login.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * Tickets
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The states a ticket moves through.
 *
 * The order matters: a ticket may only move forwards, except that a
 * ticket may always be cancelled — a customer who walks out must not
 * leave a ticket cooking.
 */
export const TICKET_STATES = [
    "queued",
    "preparing",
    "ready",
    "served",
    "cancelled",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

/**
 * May a ticket move from one state to another?
 *
 * A ticket cannot go back from `ready` to `preparing`, because the food
 * is already plated. It can always be cancelled, because the customer
 * may have left.
 */
export function canTransition(from: string, to: string): boolean {
    if (to === "cancelled") return true;

    const order: Record<string, number> = {
        queued: 0,
        preparing: 1,
        ready: 2,
        served: 3,
        cancelled: 4,
    };

    const fromIndex = order[from];
    const toIndex = order[to];

    if (fromIndex === undefined || toIndex === undefined) return false;

    // Forward one step at a time, or straight to the end.
    return toIndex > fromIndex;
}

/**
 * The next ticket number for this business.
 *
 * The number is unique within the business, which is what the kitchen
 * calls out. It is derived from the number of tickets already fired plus
 * the prefix, so it is readable rather than random.
 */
async function nextTicketNumber(
    ctx: any,
    businessId: Id<"businesses">,
    prefix: string
): Promise<string> {
    const existing = await ctx.db
        .query("kitchenTickets")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect();

    const highest = existing.reduce((max: number, ticket: any) => {
        const match = /(\d+)\s*$/.exec(ticket.ticketNumber ?? "");
        const value = match ? Number(match[1]) : 0;
        return value > max ? value : max;
    }, 0);

    return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Fire an order to the kitchen.
 *
 * The lines are copied onto the ticket so that a later change to the
 * table order cannot change what the kitchen is cooking.
 */
export const fireTicket = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        orderId: v.id("tableOrders"),
        /** Only fire these lines — for a course at a time. */
        itemIndexes: v.optional(v.array(v.number())),
        ticketPrefix: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(ctx, businessId, "sales.create");

        const order = await ctx.db.get(args.orderId);
        if (!order || order.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that order belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["tables"]);
        }

        if (order.status !== "open") {
            throw new ConvexError(
                "This order is closed, so there is nothing to send to the kitchen."
            );
        }

        const items = order.items ?? [];
        if (items.length === 0) {
            throw new ConvexError(
                "This order has no items on it yet, so there is nothing to send to the kitchen."
            );
        }

        // A waiter may fire part of an order — the starters first, say.
        const selected =
            args.itemIndexes && args.itemIndexes.length > 0
                ? args.itemIndexes
                      .map((index) => items[index])
                      .filter((item): item is NonNullable<typeof item> => Boolean(item))
                : items;

        if (selected.length === 0) {
            throw new ConvexError("No items were selected to send to the kitchen.");
        }

        const prefix = args.ticketPrefix ?? "T";
        const ticketNumber = await nextTicketNumber(ctx, businessId, prefix);
        const now = new Date().toISOString();

        const ticketId = await ctx.db.insert("kitchenTickets", {
            businessId,
            orderId: order._id,
            outletId: order.outletId,
            outletName: order.outletName,
            ticketNumber,
            status: "queued",
            items: selected.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                notes: item.notes,
            })),
            firedAt: now,
            firedBy: args.userId ?? membership.userId,
            createdAt: now,
        });

        return { id: ticketId, ticketNumber, itemCount: selected.length };
    },
});

/**
 * Move a ticket along.
 *
 * A ticket that is `ready` cannot go back to `preparing` — the food is
 * already plated. It may always be cancelled.
 */
export const updateTicketStatus = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        ticketId: v.id("kitchenTickets"),
        status: v.string(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const ticket = await ctx.db.get(args.ticketId);
        if (!ticket || ticket.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that ticket belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["tables"]);
        }

        if (!TICKET_STATES.includes(args.status as TicketState)) {
            throw new ConvexError(
                `A ticket's status must be one of: ${TICKET_STATES.join(", ")}.`
            );
        }

        if (!canTransition(ticket.status, args.status)) {
            throw new ConvexError(
                `A ticket that is "${ticket.status}" cannot become "${args.status}".`
            );
        }

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { status: args.status };

        if (args.status === "preparing" && !ticket.startedAt) {
            patch.startedAt = now;
        }
        if (args.status === "ready") {
            patch.readyAt = now;
        }

        await ctx.db.patch(ticket._id, patch);

        return null;
    },
});

/**
 * The tickets on the kitchen display.
 *
 * The kitchen cares about what is waiting, so the ones that have not
 * been served come first, oldest first — a ticket that has been waiting
 * longest is the one to cook next.
 */
export const listTickets = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
        outletId: v.optional(v.id("serviceOutlets")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.view");

        let rows = await ctx.db
            .query("kitchenTickets")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.status) {
            rows = rows.filter((ticket) => ticket.status === args.status);
        } else {
            // The display shows what still needs attention.
            rows = rows.filter((ticket) => ticket.status !== "served");
        }

        if (args.outletId) {
            rows = rows.filter((ticket) => ticket.outletId === args.outletId);
        }

        rows.sort((a, b) => a.firedAt.localeCompare(b.firedAt));

        const now = Date.now();

        return rows.map((ticket) => ({
            id: ticket._id,
            ticketNumber: ticket.ticketNumber,
            status: ticket.status,
            outletName: ticket.outletName,
            orderId: ticket.orderId,
            items: ticket.items,
            firedAt: ticket.firedAt,
            startedAt: ticket.startedAt,
            readyAt: ticket.readyAt,
            /** How long the ticket has been waiting, in minutes. */
            waitingMinutes: Math.max(
                0,
                Math.round((now - new Date(ticket.firedAt).getTime()) / 60000)
            ),
        }));
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * The menu
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The menu, with each item's availability.
 *
 * An item that is marked sold out is hidden from the till, and an item
 * whose product has run out is shown as unavailable even if nobody
 * marked it — the menu should not offer something the shop does not
 * have.
 */
export const listMenuWithAvailability = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        category: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        const items = await ctx.db
            .query("menuItems")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const filtered = args.category
            ? items.filter((item) => item.category === args.category)
            : items;

        return filtered.map((item) => {
            const stock = item.stockId
                ? stocks.find((s) => s._id === item.stockId)
                : undefined;

            const markedUnavailable = item.available === false;
            const outOfStock = stock !== undefined && (stock.qty ?? 0) <= 0;

            return {
                id: item._id,
                name: item.name,
                category: item.category,
                price: item.price,
                description: item.description,
                dietary: item.dietary ?? [],
                preparationMinutes: item.preparationMinutes,
                available: !markedUnavailable && !outOfStock,
                /** Why it is unavailable, so the waiter can say why. */
                unavailableReason: markedUnavailable
                    ? "marked as sold out"
                    : outOfStock
                      ? "out of stock"
                      : undefined,
                stockId: item.stockId,
                qtyOnHand: stock?.qty,
            };
        });
    },
});

/** The Id type is used in the argument shapes above. */
export type RestaurantTicketId = Id<"kitchenTickets">;
