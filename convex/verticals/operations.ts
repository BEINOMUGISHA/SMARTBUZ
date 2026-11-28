/**
 * SMARTBUZ — Vertical Module 4: Operations
 *
 * The procurement, logistics and asset workflows that separate a real
 * operating business from a bare till:
 *   - deliveries / dispatch runs
 *   - asset register (vehicles, pumps, equipment)
 *   - fuel dispensing log with attendant reconciliation
 *   - vehicle register with servicing
 *   - till / cash-shift sessions for daily cash reconciliation
 *   - service tickets (repair, laundry, cleaning jobs)
 *   - rental/hire records
 *
 * ────────────────────────────────────────────────────────────────────────
 * Suppliers and purchasing moved out
 * ────────────────────────────────────────────────────────────────────────
 *
 * The supplier book and the whole purchasing cycle used to live here as
 * thin implementations with no permission checks. They now live in
 * `convex/suppliers.ts` and `convex/purchasing.ts`, where they are
 * properly guarded, tenant-scoped and audited.
 *
 * The functions below remain as **delegating wrappers** with their
 * original names and arguments, so every existing caller keeps working
 * while gaining the real implementation.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "../packages/manage";
import {
  listSuppliersHandler,
  upsertSupplierHandler,
} from "../suppliers";
import {
  createPurchaseOrderHandler,
  listGoodsReceiptsHandler,
  listPurchaseOrdersHandler,
  receiveGoodsHandler,
  updatePurchaseOrderStatusHandler,
} from "../purchasing";

/* ───────────────────────── suppliers ───────────────────────── */

/**
 * The supplier book.
 *
 * @deprecated Use `api.suppliers.listAll` instead. Kept so existing
 * callers keep working; it delegates to the real implementation.
 */
export const listSuppliers = query({
    args: { search: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        return listSuppliersHandler(ctx, {
            searchTerm: args.search,
            businessId: args.businessId,
        });
    },
});

/**
 * Register or update a supplier.
 *
 * @deprecated Use `api.suppliers.upsert` instead.
 */
export const upsertSupplier = mutation({
    args: {
        id: v.optional(v.id("suppliers")),
        name: v.string(),
        contact: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        paymentTerms: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const { userId, ...rest } = args;
        return upsertSupplierHandler(ctx, rest);
    },
});

/* ───────────────────────── purchase orders ───────────────────────── */

/**
 * The purchase order book.
 *
 * @deprecated Use `api.purchasing.listPurchaseOrders` instead.
 */
export const listPurchaseOrders = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        // The legacy contract was a plain array; the new implementation
        // also reports a status summary.
        const result = await listPurchaseOrdersHandler(ctx, args);
        return result.page;
    },
});

/**
 * Raise a purchase order.
 *
 * @deprecated Use `api.purchasing.createPurchaseOrder` instead.
 */
export const createPurchaseOrder = mutation({
    args: {
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.string(),
        expectedDate: v.optional(v.string()),
        notes: v.optional(v.string()),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            quantity: v.number(),
            unitCost: v.number(),
        })),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const { userId, ...rest } = args;
        return createPurchaseOrderHandler(ctx, rest);
    },
});

/**
 * Change a purchase order's status.
 *
 * @deprecated Use `api.purchasing.updatePurchaseOrderStatus` instead.
 */
export const updatePurchaseOrderStatus = mutation({
    args: { id: v.id("purchaseOrders"), status: v.string(), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        return updatePurchaseOrderStatusHandler(ctx, args);
    },
});

/**
 * Receive goods against a purchase order.
 *
 * @deprecated Use `api.purchasing.receiveGoods` instead. The new
 * implementation supports partial receipts, branch and warehouse
 * targeting, and preserves the purchase cost of every receipt.
 */
export const receiveGoods = mutation({
    args: {
        poId: v.id("purchaseOrders"),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            quantity: v.number(),
            unitCost: v.number(),
        })),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const { userId, ...rest } = args;
        return receiveGoodsHandler(ctx, rest);
    },
});

/**
 * The goods received notes.
 *
 * @deprecated Use `api.purchasing.listGoodsReceipts` instead.
 */
export const listGoodsReceipts = query({
    args: { limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        // The legacy contract was a plain array.
        const result = await listGoodsReceiptsHandler(ctx, args);
        return result.page;
    },
});

/* ───────────────────────── deliveries ───────────────────────── */

export const listDeliveries = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("deliveries").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return rows;
    },
});

export const createDelivery = mutation({
    args: {
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        shopId: v.optional(v.id("shops")),
        destination: v.optional(v.string()),
        assignedTo: v.optional(v.id("users")),
        assignedToName: v.optional(v.string()),
        amount: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "purchasing.manage");
        const businessId = tenant.businessId;
        const count = (await ctx.db.query("deliveries").collect()).length + 1;
        const reference = `DEL-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("deliveries", {
            businessId,
            reference,
            customerId: args.customerId,
            customerName: args.customerName,
            shopId: args.shopId,
            destination: args.destination,
            status: "pending",
            assignedTo: args.assignedTo,
            assignedToName: args.assignedToName,
            amount: args.amount,
            notes: args.notes,
            createdAt: new Date().toISOString(),
        });
        return { id, reference };
    },
});

export const updateDeliveryStatus = mutation({
    args: {
        id: v.id("deliveries"),
        status: v.string(),
        dispatchDate: v.optional(v.string()),
        deliveryDate: v.optional(v.string()),
        notes: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "purchasing.manage");
        const businessId = tenant.businessId;
        const delivery = await ctx.db.get(args.id);
        if (!delivery) throw new ConvexError("Delivery not found");
        if (delivery.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        const patch: Record<string, unknown> = { status: args.status, notes: args.notes };
        if (args.status === "dispatched") patch.dispatchDate = args.dispatchDate || new Date().toISOString();
        if (args.status === "delivered") patch.deliveryDate = args.deliveryDate || new Date().toISOString();
        await ctx.db.patch(args.id, patch);
        return args.id;
    },
});

/* ───────────────────────── assets ───────────────────────── */

export const listAssets = query({
    args: { category: v.optional(v.string()), status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("assets").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.category) rows = rows.filter((r) => r.category === args.category);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => a.assetTag.localeCompare(b.assetTag));
        return rows;
    },
});

export const upsertAsset = mutation({
    args: {
        id: v.optional(v.id("assets")),
        assetTag: v.string(),
        name: v.string(),
        category: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        status: v.optional(v.string()),
        purchaseDate: v.optional(v.string()),
        purchaseCost: v.optional(v.number()),
        currentValue: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "hardware.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["assets"]);
        const payload = {
            businessId,
            assetTag: args.assetTag,
            name: args.name,
            category: args.category,
            serialNumber: args.serialNumber,
            status: args.status ?? "in_use",
            purchaseDate: args.purchaseDate,
            purchaseCost: args.purchaseCost,
            currentValue: args.currentValue,
            notes: args.notes,
        };
        if (args.id) {
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("assets", payload);
    },
});

/* ───────────────────────── fuel ───────────────────────── */

export const recordFuelDispense = mutation({
    args: {
        pumpName: v.string(),
        fuelType: v.string(),
        litres: v.number(),
        pricePerLitre: v.number(),
        attendantId: v.optional(v.id("users")),
        attendantName: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
        vehicleReg: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["fuelPump"]);
        if (args.litres <= 0) throw new ConvexError("Litres must be greater than zero");

        const total = Math.round(args.litres * args.pricePerLitre);
        const id = await ctx.db.insert("fuelDispenses", {
            businessId,
            pumpName: args.pumpName,
            fuelType: args.fuelType,
            litres: args.litres,
            pricePerLitre: args.pricePerLitre,
            total,
            attendantId: args.attendantId,
            attendantName: args.attendantName,
            customerId: args.customerId,
            vehicleReg: args.vehicleReg,
            date: new Date().toISOString(),
            saleId: args.saleId,
        });
        return { id, total };
    },
});

export const getFuelSummary = query({
    args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("fuelDispenses").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.startDate) rows = rows.filter((r) => r.date >= args.startDate!);
        if (args.endDate) rows = rows.filter((r) => r.date <= args.endDate!);

        const byType = rows.reduce((acc: Record<string, { litres: number; revenue: number; count: number }>, r) => {
            const cur = acc[r.fuelType] ?? { litres: 0, revenue: 0, count: 0 };
            cur.litres += r.litres;
            cur.revenue += r.total;
            cur.count += 1;
            acc[r.fuelType] = cur;
            return acc;
        }, {});

        const byAttendant = rows.reduce((acc: Record<string, { name: string; litres: number; revenue: number }>, r) => {
            const key = r.attendantId ?? "unknown";
            const cur = acc[key] ?? { name: r.attendantName ?? "Unattributed", litres: 0, revenue: 0 };
            cur.litres += r.litres;
            cur.revenue += r.total;
            acc[key] = cur;
            return acc;
        }, {});

        return {
            totalLitres: rows.reduce((s, r) => s + r.litres, 0),
            totalRevenue: rows.reduce((s, r) => s + r.total, 0),
            count: rows.length,
            byType,
            byAttendant: Object.entries(byAttendant).map(([id, v]) => ({ id, ...v })),
        };
    },
});

/* ───────────────────────── vehicles ───────────────────────── */

export const listVehicles = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("vehicles").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => a.registration.localeCompare(b.registration));
        return rows;
    },
});

export const upsertVehicle = mutation({
    args: {
        id: v.optional(v.id("vehicles")),
        registration: v.string(),
        make: v.optional(v.string()),
        model: v.optional(v.string()),
        type: v.optional(v.string()),
        driverId: v.optional(v.id("users")),
        driverName: v.optional(v.string()),
        route: v.optional(v.string()),
        status: v.optional(v.string()),
        nextServiceDate: v.optional(v.string()),
        notes: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "hardware.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["assets"]);
        const payload = {
            businessId,
            registration: args.registration,
            make: args.make,
            model: args.model,
            type: args.type,
            driverId: args.driverId,
            driverName: args.driverName,
            route: args.route,
            status: args.status ?? "active",
            nextServiceDate: args.nextServiceDate,
            notes: args.notes,
        };
        if (args.id) {
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("vehicles", payload);
    },
});

export const upsertRouteFare = mutation({
    args: {
        id: v.optional(v.id("routeFares")),
        routeName: v.string(),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        fare: v.number(),
        vehicleType: v.optional(v.string()),
        active: v.optional(v.boolean()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "hardware.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        const payload = {
            businessId,
            routeName: args.routeName,
            from: args.from,
            to: args.to,
            fare: args.fare,
            vehicleType: args.vehicleType,
            active: args.active ?? true,
        };
        if (args.id) {
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("routeFares", payload);
    },
});

export const listRouteFares = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("routeFares").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        rows.sort((a, b) => a.routeName.localeCompare(b.routeName));
        return rows;
    },
});

/* ───────────────────────── till sessions (cash reconciliation) ───────────────────────── */

export const openTillSession = mutation({
    args: {
        userId: v.id("users"),
        userName: v.string(),
        shopId: v.optional(v.id("shops")),
        openingFloat: v.number(),
        notes: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");
        const businessId = tenant.businessId;

        // Only one open session per user per shop.
        const open = await ctx.db
            .query("tillSessions")
            .filter((q) => q.and(q.eq(q.field("userId"), args.userId), q.eq(q.field("status"), "open")))
            .collect();
        if (open.length > 0) {
            throw new ConvexError("You already have an open till session. Close it before opening another.");
        }

        const count = (await ctx.db.query("tillSessions").collect()).length + 1;
        const sessionNumber = `TILL-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("tillSessions", {
            businessId,
            sessionNumber,
            userId: tenant.user._id,
            userName: args.userName,
            shopId: args.shopId,
            openedAt: new Date().toISOString(),
            openingFloat: args.openingFloat,
            status: "open",
            notes: args.notes,
        });
        return { id, sessionNumber };
    },
});

export const closeTillSession = mutation({
    args: {
        id: v.id("tillSessions"),
        expectedCash: v.number(),
        countedCash: v.number(),
        notes: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");
        const businessId = tenant.businessId;
        const session = await ctx.db.get(args.id);
        if (!session) throw new ConvexError("Till session not found");
        if (session.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (session.status === "closed") throw new ConvexError("This till session is already closed");

        const variance = args.countedCash - args.expectedCash;
        await ctx.db.patch(args.id, {
            status: "closed",
            closedAt: new Date().toISOString(),
            expectedCash: args.expectedCash,
            countedCash: args.countedCash,
            variance,
            notes: args.notes,
        });
        return { variance };
    },
});

export const listTillSessions = query({
    args: { status: v.optional(v.string()), limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("tillSessions").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

/* ───────────────────────── service tickets ───────────────────────── */

export const listServiceTickets = query({
    args: { status: v.optional(v.string()), limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("serviceTickets").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const createServiceTicket = mutation({
    args: {
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        serviceType: v.string(),
        description: v.optional(v.string()),
        estimatedCost: v.optional(v.number()),
        priority: v.optional(v.string()),
        assignedTo: v.optional(v.id("users")),
        assignedToName: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        const count = (await ctx.db.query("serviceTickets").collect()).length + 1;
        const ticketNumber = `JOB-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("serviceTickets", {
            businessId,
            ticketNumber,
            customerId: args.customerId,
            customerName: args.customerName,
            customerPhone: args.customerPhone,
            serviceType: args.serviceType,
            description: args.description,
            status: "received",
            priority: args.priority ?? "normal",
            estimatedCost: args.estimatedCost,
            assignedTo: args.assignedTo,
            assignedToName: args.assignedToName,
            receivedDate: new Date().toISOString(),
            dueDate: args.dueDate,
        });

        await ctx.db.insert("activityLogs", {
            businessId,
            userId: tenant.user._id,
            action: "Create Service Ticket",
            details: `${ticketNumber} — ${args.serviceType} for ${args.customerName}`,
            timestamp: new Date().toISOString(),
        });

        return { id, ticketNumber };
    },
});

export const updateServiceTicket = mutation({
    args: {
        id: v.id("serviceTickets"),
        status: v.optional(v.string()),
        finalCost: v.optional(v.number()),
        deliveredDate: v.optional(v.string()),
        notes: v.optional(v.string()),
        customerName: v.optional(v.string()),
        customerPhone: v.optional(v.string()),
        serviceType: v.optional(v.string()),
        description: v.optional(v.string()),
        priority: v.optional(v.string()),
        estimatedCost: v.optional(v.number()),
        assignedToName: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;

        const ticket = await ctx.db.get(args.id);
        if (!ticket) throw new ConvexError("Job ticket not found");
        if (ticket.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        // Amending the job details is a change to a customer's job, so it is
        // permission-checked. Moving the ticket along its workflow is not.
        const amending =
            args.customerName !== undefined ||
            args.customerPhone !== undefined ||
            args.serviceType !== undefined ||
            args.description !== undefined ||
            args.priority !== undefined ||
            args.estimatedCost !== undefined ||
            args.assignedToName !== undefined ||
            args.dueDate !== undefined;
        if (amending) {
            await requirePermission(ctx, businessId, "sales.create");
        }

        const patch: Record<string, unknown> = {};
        if (args.status) patch.status = args.status;
        if (args.finalCost !== undefined) patch.finalCost = args.finalCost;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.customerName !== undefined) patch.customerName = args.customerName;
        if (args.customerPhone !== undefined) patch.customerPhone = args.customerPhone;
        if (args.serviceType !== undefined) patch.serviceType = args.serviceType;
        if (args.description !== undefined) patch.description = args.description;
        if (args.priority !== undefined) patch.priority = args.priority;
        if (args.estimatedCost !== undefined) patch.estimatedCost = args.estimatedCost;
        if (args.assignedToName !== undefined) patch.assignedToName = args.assignedToName;
        if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
        if (args.status === "delivered") patch.deliveredDate = args.deliveredDate || new Date().toISOString();
        await ctx.db.patch(args.id, patch);

        if (amending) {
            await logActivity(
                ctx,
                businessId,
                tenant.user._id,
                "Update Job Ticket",
                `${ticket.ticketNumber} — ${args.serviceType ?? ticket.serviceType} amended`
            );
        await assertScreenAvailable(ctx, businessId, ["services"]);
            await writeAudit(ctx, {
                businessId,
                actorUserId: tenant.user._id,
                actorRole: tenant.membership.role,
                action: "service_ticket.update",
                targetType: "service_ticket",
                targetId: args.id,
                metadata: {
                    ticketNumber: ticket.ticketNumber,
                    customerName: args.customerName ?? ticket.customerName,
                    serviceType: args.serviceType ?? ticket.serviceType,
                    priority: args.priority ?? ticket.priority,
                },
            });
        }

        return args.id;
    },
});

/* ───────────────────────── rentals ───────────────────────── */

export const listRentals = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db
            .query("rentals")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
        return rows;
    },
});

export const createRental = mutation({
    args: {
        assetId: v.optional(v.id("assets")),
        assetName: v.string(),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        startDate: v.string(),
        endDate: v.optional(v.string()),
        rate: v.number(),
        deposit: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "hardware.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["rentals"]);
        const id = await ctx.db.insert("rentals", {
            businessId,
            assetId: args.assetId,
            assetName: args.assetName,
            customerId: args.customerId,
            customerName: args.customerName,
            startDate: args.startDate,
            endDate: args.endDate,
            rate: args.rate,
            deposit: args.deposit,
            status: "out",
            notes: args.notes,
        });

        if (args.assetId) {
            await ctx.db.patch(args.assetId, { status: "idle" });
        }
        return id;
    },
});

export const returnRental = mutation({
    args: { id: v.id("rentals"), condition: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "hardware.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["rentals"]);
        const rental = await ctx.db.get(args.id);
        if (!rental) throw new ConvexError("Rental not found");
        if (rental.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        await ctx.db.patch(args.id, { status: "returned" });
        if (rental.assetId) {
            await ctx.db.patch(rental.assetId, { status: "in_use" });
        }
        return args.id;
    },
});

/* ───────────────────────── attendance & classes ───────────────────────── */

export const recordAttendance = mutation({
    args: {
        personId: v.optional(v.id("members")),
        personName: v.string(),
        className: v.optional(v.string()),
        date: v.string(),
        status: v.string(),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["attendance"]);

        // One record per person per day — update if it already exists.
        const existing = await ctx.db
            .query("attendance")
            .filter((q) =>
                q.and(
                    q.eq(q.field("personName"), args.personName),
                    q.eq(q.field("date"), args.date),
                    q.eq(q.field("className"), args.className ?? "")
                )
            )
            .collect();

        if (existing.length > 0) {
            await ctx.db.patch(existing[0]._id, { status: args.status });
            return existing[0]._id;
        }

        const id = await ctx.db.insert("attendance", {
            businessId,
            personId: args.personId,
            personName: args.personName,
            className: args.className,
            date: args.date,
            status: args.status,
            recordedBy: args.userId,
        });
        return id;
    },
});

export const listAttendance = query({
    args: { date: v.optional(v.string()), className: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("attendance").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.date) rows = rows.filter((r) => r.date === args.date);
        if (args.className) rows = rows.filter((r) => r.className === args.className);
        rows.sort((a, b) => a.personName.localeCompare(b.personName));

        const present = rows.filter((r) => r.status === "present" || r.status === "late").length;
        return {
            rows,
            total: rows.length,
            present,
            absent: rows.filter((r) => r.status === "absent").length,
            attendanceRate: rows.length ? Math.round((present / rows.length) * 100) : 0,
        };
    },
});

export const listEnrolments = query({
    args: { className: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("classEnrolments").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.className) rows = rows.filter((r) => r.className === args.className);
        rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
        return rows;
    },
});

export const createEnrolment = mutation({
    args: {
        className: v.string(),
        studentId: v.optional(v.id("members")),
        studentName: v.string(),
        term: v.optional(v.string()),
        amountDue: v.optional(v.number()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["classes"]);
        const id = await ctx.db.insert("classEnrolments", {
            businessId,
            className: args.className,
            studentId: args.studentId,
            studentName: args.studentName,
            term: args.term,
            amountDue: args.amountDue ?? 0,
            amountPaid: 0,
            status: "active",
            enrolledDate: new Date().toISOString(),
        });
        return id;
    },
});

/* ───────────────────────── production batches ───────────────────────── */

export const listProductionBatches = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("productionBatches").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return rows;
    },
});

export const createProductionBatch = mutation({
    args: {
        productName: v.string(),
        category: v.optional(v.string()),
        quantityProduced: v.number(),
        unit: v.optional(v.string()),
        batchNumber: v.optional(v.string()),
        expiryDate: v.optional(v.string()),
        costPerUnit: v.optional(v.number()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["production"]);
        const id = await ctx.db.insert("productionBatches", {
            businessId,
            productName: args.productName,
            category: args.category,
            quantityProduced: args.quantityProduced,
            quantitySold: 0,
            unit: args.unit,
            batchNumber: args.batchNumber,
            expiryDate: args.expiryDate,
            costPerUnit: args.costPerUnit,
            date: new Date().toISOString(),
            userId: tenant.user._id,
            status: "active",
        });
        return id;
    },
});

/* ───────────────────────── recurring charges ───────────────────────── */

export const listRecurringCharges = query({
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("recurringCharges").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
        return rows;
    },
});

export const upsertRecurringCharge = mutation({
    args: {
        id: v.optional(v.id("recurringCharges")),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        description: v.string(),
        amount: v.number(),
        frequency: v.string(),
        nextDueDate: v.string(),
        notes: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        const payload = {
            businessId,
            customerId: args.customerId,
            customerName: args.customerName,
            description: args.description,
            amount: args.amount,
            frequency: args.frequency,
            nextDueDate: args.nextDueDate,
            status: "active",
            notes: args.notes,
        };
        if (args.id) {
            const existing = await ctx.db.get(args.id);
            if (!existing) throw new ConvexError("Recurring charge not found");
            if (existing.businessId !== businessId) {
                throw new ConvexError("Forbidden: that record belongs to another business.");
            }
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("recurringCharges", payload);
    },
});

/* ───────────────────────── record lifecycle ───────────────────────── */

/** Amend a delivery note. */
export const updateDelivery = mutation({
    args: {
        id: v.id("deliveries"),
        customerName: v.optional(v.string()),
        destination: v.optional(v.string()),
        assignedToName: v.optional(v.string()),
        amount: v.optional(v.number()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const delivery = await ctx.db.get(args.id);
        if (!delivery) throw new ConvexError("Delivery not found");
        if (delivery.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        const patch: Record<string, unknown> = {};
        if (args.customerName !== undefined) patch.customerName = args.customerName;
        if (args.destination !== undefined) patch.destination = args.destination;
        if (args.assignedToName !== undefined) patch.assignedToName = args.assignedToName;
        if (args.amount !== undefined) patch.amount = args.amount;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.status !== undefined) {
            patch.status = args.status;
            // The hand-over dates are stamped by the server, never by the client.
            if (args.status === "dispatched") patch.dispatchDate = new Date().toISOString();
            if (args.status === "delivered") patch.deliveryDate = new Date().toISOString();
        }
        await ctx.db.patch(args.id, patch);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Delivery",
            `${delivery.reference} — ${args.customerName ?? delivery.customerName} amended`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "delivery.update",
            targetType: "delivery",
            targetId: args.id,
            metadata: {
                reference: delivery.reference,
                customerName: args.customerName ?? delivery.customerName,
                status: args.status ?? delivery.status,
            },
        });

        return args.id;
    },
});

/**
 * Delete a delivery note.
 *
 * A delivery that has already been handed over is the proof that the goods
 * reached the customer, so it cannot be removed — cancel it instead.
 */
export const deleteDelivery = mutation({
    args: {
        id: v.id("deliveries"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const delivery = await ctx.db.get(args.id);
        if (!delivery) throw new ConvexError("Delivery not found");
        if (delivery.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (delivery.status === "delivered") {
            throw new ConvexError(
                `${delivery.reference} was already handed over. The delivery note must be kept — mark it failed instead.`
            );
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Delivery",
            `${delivery.reference} — ${delivery.customerName} deleted`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "delivery.delete",
            targetType: "delivery",
            targetId: args.id,
            metadata: {
                reference: delivery.reference,
                customerName: delivery.customerName,
                status: delivery.status,
                amount: delivery.amount,
            },
        });

        return args.id;
    },
});

/**
 * Delete a job ticket.
 *
 * Refused when a recurring charge is attached to the ticket: the charge
 * points at the ticket, so removing it would break the recurring schedule.
 */
export const deleteServiceTicket = mutation({
    args: {
        id: v.id("serviceTickets"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const ticket = await ctx.db.get(args.id);
        if (!ticket) throw new ConvexError("Job ticket not found");
        if (ticket.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        const charges = await ctx.db.query("recurringCharges").collect();
        const linked = charges.find((c) => c.businessId === businessId && c.serviceId === args.id);
        if (linked) {
            throw new ConvexError(
                `${ticket.ticketNumber} is on a recurring charge. Remove the charge before deleting the ticket.`
            );
        await assertScreenAvailable(ctx, businessId, ["services"]);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Job Ticket",
            `${ticket.ticketNumber} — ${ticket.serviceType} for ${ticket.customerName} deleted`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "service_ticket.delete",
            targetType: "service_ticket",
            targetId: args.id,
            metadata: {
                ticketNumber: ticket.ticketNumber,
                customerName: ticket.customerName,
                serviceType: ticket.serviceType,
                status: ticket.status,
                finalCost: ticket.finalCost,
            },
        });

        return args.id;
    },
});

/** Amend a hire record. The asset state is managed by the hire workflow. */
export const updateRental = mutation({
    args: {
        id: v.id("rentals"),
        assetName: v.optional(v.string()),
        customerName: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        rate: v.optional(v.number()),
        deposit: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "inventory.transfer");

        const rental = await ctx.db.get(args.id);
        if (!rental) throw new ConvexError("Rental not found");
        if (rental.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            ...(args.assetName !== undefined ? { assetName: args.assetName } : {}),
            ...(args.customerName !== undefined ? { customerName: args.customerName } : {}),
            ...(args.startDate !== undefined ? { startDate: args.startDate } : {}),
            ...(args.endDate !== undefined ? { endDate: args.endDate } : {}),
            ...(args.rate !== undefined ? { rate: args.rate } : {}),
            ...(args.deposit !== undefined ? { deposit: args.deposit } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Rental",
            `${args.assetName ?? rental.assetName} for ${args.customerName ?? rental.customerName} amended`
        );
        await assertScreenAvailable(ctx, businessId, ["rentals"]);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rental.update",
            targetType: "rental",
            targetId: args.id,
            metadata: {
                assetName: args.assetName ?? rental.assetName,
                customerName: args.customerName ?? rental.customerName,
                rate: args.rate ?? rental.rate,
            },
        });

        return args.id;
    },
});

/**
 * Delete a hire record.
 *
 * Refused while the item is still with the customer: the asset is out on
 * hire and the hire record is the proof of it.
 */
export const deleteRental = mutation({
    args: {
        id: v.id("rentals"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "inventory.transfer");

        const rental = await ctx.db.get(args.id);
        if (!rental) throw new ConvexError("Rental not found");
        if (rental.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (rental.status === "out" || rental.status === "overdue") {
            throw new ConvexError(
                `${rental.assetName} is still out on hire. Take the return first, then delete the record.`
            );
        await assertScreenAvailable(ctx, businessId, ["rentals"]);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Rental",
            `${rental.assetName} for ${rental.customerName} deleted`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rental.delete",
            targetType: "rental",
            targetId: args.id,
            metadata: {
                assetName: rental.assetName,
                customerName: rental.customerName,
                status: rental.status,
                rate: rental.rate,
            },
        });

        return args.id;
    },
});

/** Amend an attendance mark. */
export const updateAttendance = mutation({
    args: {
        id: v.id("attendance"),
        personName: v.optional(v.string()),
        className: v.optional(v.string()),
        date: v.optional(v.string()),
        status: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const mark = await ctx.db.get(args.id);
        if (!mark) throw new ConvexError("Attendance record not found");
        if (mark.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            ...(args.personName !== undefined ? { personName: args.personName } : {}),
            ...(args.className !== undefined ? { className: args.className } : {}),
            ...(args.date !== undefined ? { date: args.date } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Attendance",
            `${args.personName ?? mark.personName} on ${args.date ?? mark.date} marked ${args.status ?? mark.status}`
        );
        await assertScreenAvailable(ctx, businessId, ["attendance"]);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "attendance.update",
            targetType: "attendance",
            targetId: args.id,
            metadata: {
                personName: args.personName ?? mark.personName,
                className: args.className ?? mark.className,
                date: args.date ?? mark.date,
                status: args.status ?? mark.status,
            },
        });

        return args.id;
    },
});

/** Delete an attendance mark. */
export const deleteAttendance = mutation({
    args: {
        id: v.id("attendance"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const mark = await ctx.db.get(args.id);
        if (!mark) throw new ConvexError("Attendance record not found");
        if (mark.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Attendance",
            `${mark.personName} on ${mark.date} removed from the register`
        );
        await assertScreenAvailable(ctx, businessId, ["attendance"]);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "attendance.delete",
            targetType: "attendance",
            targetId: args.id,
            metadata: { personName: mark.personName, className: mark.className, date: mark.date, status: mark.status },
        });

        return args.id;
    },
});

/**
 * Amend a class enrolment.
 *
 * The amount already paid is never writable here — it only moves through a
 * fee payment, so the outstanding balance is derived on the server.
 */
export const updateEnrolment = mutation({
    args: {
        id: v.id("classEnrolments"),
        className: v.optional(v.string()),
        studentName: v.optional(v.string()),
        term: v.optional(v.string()),
        amountDue: v.optional(v.number()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const enrolment = await ctx.db.get(args.id);
        if (!enrolment) throw new ConvexError("Enrolment not found");
        if (enrolment.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            ...(args.className !== undefined ? { className: args.className } : {}),
            ...(args.studentName !== undefined ? { studentName: args.studentName } : {}),
            ...(args.term !== undefined ? { term: args.term } : {}),
            ...(args.amountDue !== undefined ? { amountDue: args.amountDue } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Enrolment",
            `${args.studentName ?? enrolment.studentName} in ${args.className ?? enrolment.className} amended`
        );
        await assertScreenAvailable(ctx, businessId, ["classes"]);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "enrolment.update",
            targetType: "class_enrolment",
            targetId: args.id,
            metadata: {
                className: args.className ?? enrolment.className,
                studentName: args.studentName ?? enrolment.studentName,
                amountDue: args.amountDue ?? enrolment.amountDue,
                status: args.status ?? enrolment.status,
            },
        });

        return args.id;
    },
});

/**
 * Delete a class enrolment.
 *
 * Refused when fees have already been collected against it: the enrolment is
 * the record of what was billed and received.
 */
export const deleteEnrolment = mutation({
    args: {
        id: v.id("classEnrolments"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const enrolment = await ctx.db.get(args.id);
        if (!enrolment) throw new ConvexError("Enrolment not found");
        if (enrolment.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (enrolment.amountPaid > 0) {
            throw new ConvexError(
                `Fees have been collected on this enrolment. The record must be kept — withdraw the student instead.`
            );
        await assertScreenAvailable(ctx, businessId, ["classes"]);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Enrolment",
            `${enrolment.studentName} removed from ${enrolment.className}`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "enrolment.delete",
            targetType: "class_enrolment",
            targetId: args.id,
            metadata: {
                className: enrolment.className,
                studentName: enrolment.studentName,
                amountDue: enrolment.amountDue,
                amountPaid: enrolment.amountPaid,
            },
        });

        return args.id;
    },
});

/**
 * Amend a production batch.
 *
 * The quantity already sold is never writable here — it is the running
 * figure of what left the batch.
 */
export const updateProductionBatch = mutation({
    args: {
        id: v.id("productionBatches"),
        productName: v.optional(v.string()),
        category: v.optional(v.string()),
        quantityProduced: v.optional(v.number()),
        unit: v.optional(v.string()),
        batchNumber: v.optional(v.string()),
        expiryDate: v.optional(v.string()),
        costPerUnit: v.optional(v.number()),
        status: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "inventory.adjust");

        const batch = await ctx.db.get(args.id);
        if (!batch) throw new ConvexError("Batch not found");
        if (batch.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (args.quantityProduced !== undefined && args.quantityProduced < batch.quantitySold) {
            throw new ConvexError(
                `${batch.quantitySold} ${batch.unit ?? "units"} of this batch have already been sold. The produced quantity cannot go below that.`
            );
        await assertScreenAvailable(ctx, businessId, ["production"]);
        }

        await ctx.db.patch(args.id, {
            ...(args.productName !== undefined ? { productName: args.productName } : {}),
            ...(args.category !== undefined ? { category: args.category } : {}),
            ...(args.quantityProduced !== undefined ? { quantityProduced: args.quantityProduced } : {}),
            ...(args.unit !== undefined ? { unit: args.unit } : {}),
            ...(args.batchNumber !== undefined ? { batchNumber: args.batchNumber } : {}),
            ...(args.expiryDate !== undefined ? { expiryDate: args.expiryDate } : {}),
            ...(args.costPerUnit !== undefined ? { costPerUnit: args.costPerUnit } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Production Batch",
            `${args.productName ?? batch.productName} batch ${args.batchNumber ?? batch.batchNumber ?? ""} amended`.trim()
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "production_batch.update",
            targetType: "production_batch",
            targetId: args.id,
            metadata: {
                productName: args.productName ?? batch.productName,
                quantityProduced: args.quantityProduced ?? batch.quantityProduced,
                batchNumber: args.batchNumber ?? batch.batchNumber,
                status: args.status ?? batch.status,
            },
        });

        return args.id;
    },
});

/**
 * Delete a production batch.
 *
 * Refused when the batch has already sold units: the batch is then the
 * record of what was produced and sold.
 */
export const deleteProductionBatch = mutation({
    args: {
        id: v.id("productionBatches"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "inventory.adjust");

        const batch = await ctx.db.get(args.id);
        if (!batch) throw new ConvexError("Batch not found");
        if (batch.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (batch.quantitySold > 0) {
            throw new ConvexError(
                `${batch.quantitySold} ${batch.unit ?? "units"} of this batch have been sold. The batch record must be kept.`
            );
        await assertScreenAvailable(ctx, businessId, ["production"]);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Production Batch",
            `${batch.productName} batch ${batch.batchNumber ?? ""} deleted`.trim()
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "production_batch.delete",
            targetType: "production_batch",
            targetId: args.id,
            metadata: {
                productName: batch.productName,
                quantityProduced: batch.quantityProduced,
                quantitySold: batch.quantitySold,
                batchNumber: batch.batchNumber,
            },
        });

        return args.id;
    },
});
