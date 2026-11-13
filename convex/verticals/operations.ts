/**
 * SMARTBUZ — Vertical Module 4: Operations
 *
 * The procurement, logistics and asset workflows that separate a real
 * operating business from a bare till:
 *   - suppliers with payment terms, purchase orders, goods received notes
 *   - deliveries / dispatch runs
 *   - asset register (vehicles, pumps, equipment)
 *   - fuel dispensing log with attendant reconciliation
 *   - vehicle register with servicing
 *   - till / cash-shift sessions for daily cash reconciliation
 *   - service tickets (repair, laundry, cleaning jobs)
 *   - rental/hire records
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getActiveBusinessId } from "./batches";

/* ───────────────────────── suppliers ───────────────────────── */

export const listSuppliers = query({
    args: { search: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("suppliers").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        if (args.search) {
            const s = args.search.toLowerCase();
            rows = rows.filter((r) => r.name.toLowerCase().includes(s));
        }
        rows.sort((a, b) => a.name.localeCompare(b.name));
        return rows;
    },
});

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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
            name: args.name,
            contact: args.contact,
            phone: args.phone,
            email: args.email,
            address: args.address,
            paymentTerms: args.paymentTerms,
            notes: args.notes,
        };

        if (args.id) {
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        const id = await ctx.db.insert("suppliers", { ...payload, createdAt: new Date().toISOString() });
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Supplier",
            details: `Added supplier ${args.name}`,
            timestamp: new Date().toISOString(),
        });
        return id;
    },
});

/* ───────────────────────── purchase orders ───────────────────────── */

export const listPurchaseOrders = query({
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("purchaseOrders").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return rows;
    },
});

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
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        if (args.items.length === 0) throw new Error("A purchase order needs at least one line item");

        const total = args.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

        // Sequential PO number per business.
        const existing = await ctx.db.query("purchaseOrders").collect();
        const scoped = businessId
            ? existing.filter((p) => !p.businessProfileId || p.businessProfileId === businessId)
            : existing;
        const next = scoped.length + 1;
        const poNumber = `PO-${String(next).padStart(4, "0")}`;

        const id = await ctx.db.insert("purchaseOrders", {
            businessProfileId: businessId,
            poNumber,
            supplierId: args.supplierId,
            supplierName: args.supplierName,
            status: "draft",
            date: new Date().toISOString(),
            expectedDate: args.expectedDate,
            total,
            notes: args.notes,
            userId: args.userId,
            items: args.items.map((i) => ({ ...i, receivedQty: 0 })),
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Purchase Order",
            details: `${poNumber} to ${args.supplierName} — UGX ${total.toLocaleString()}`,
            timestamp: new Date().toISOString(),
        });

        return { id, poNumber };
    },
});

export const updatePurchaseOrderStatus = mutation({
    args: { id: v.id("purchaseOrders"), status: v.string() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, { status: args.status });
        return args.id;
    },
});

/**
 * Receive goods against a purchase order.
 * This increases stock, records a goods-received note and writes to the
 * stock ledger — the missing audit trail called out in the audit.
 */
export const receiveGoods = mutation({
    args: {
        poId: v.id("purchaseOrders"),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            quantity: v.number(),
            unitCost: v.number(),
        })),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const po = await ctx.db.get(args.poId);
        if (!po) throw new Error("Purchase order not found");
        if (po.status === "received") throw new Error("This purchase order has already been received");

        const now = new Date().toISOString();
        const total = args.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

        for (const item of args.items) {
            if (!item.stockId) continue;
            const stock = await ctx.db.get(item.stockId);
            if (!stock) continue;

            await ctx.db.patch(item.stockId, { qty: stock.qty + item.quantity });

            await ctx.db.insert("stockLedger", {
                stockId: item.stockId,
                shopId: undefined,
                deltaQty: item.quantity,
                eventType: "RESTOCK",
                referenceId: po.poNumber,
                userId: args.userId,
                timestamp: now,
                notes: `Goods received against ${po.poNumber}`,
            });

            await ctx.db.insert("stockEntries", {
                stockId: item.stockId,
                quantity: item.quantity,
                userId: args.userId,
                date: now,
                price: stock.price,
                purchasePrice: item.unitCost,
                pv: stock.pv,
                bv: stock.bv,
                halfPrice: stock.halfPrice ?? false,
                type: "restock",
                supplier: po.supplierName,
            });
        }

        const receiptNumber = `GRN-${String((await ctx.db.query("goodsReceipts").collect()).length + 1).padStart(4, "0")}`;
        await ctx.db.insert("goodsReceipts", {
            businessProfileId: businessId,
            poId: args.poId,
            receiptNumber,
            supplierId: po.supplierId,
            supplierName: po.supplierName,
            date: now,
            total,
            userId: args.userId,
            items: args.items,
        });

        await ctx.db.patch(args.poId, { status: "received", receivedDate: now });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Goods Received",
            details: `${receiptNumber} against ${po.poNumber} — UGX ${total.toLocaleString()}`,
            timestamp: now,
        });

        return { receiptNumber };
    },
});

export const listGoodsReceipts = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("goodsReceipts").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

/* ───────────────────────── deliveries ───────────────────────── */

export const listDeliveries = query({
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("deliveries").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const count = (await ctx.db.query("deliveries").collect()).length + 1;
        const reference = `DEL-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("deliveries", {
            businessProfileId: businessId,
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
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const patch: Record<string, unknown> = { status: args.status, notes: args.notes };
        if (args.status === "dispatched") patch.dispatchDate = args.dispatchDate || new Date().toISOString();
        if (args.status === "delivered") patch.deliveryDate = args.deliveryDate || new Date().toISOString();
        await ctx.db.patch(args.id, patch);
        return args.id;
    },
});

/* ───────────────────────── assets ───────────────────────── */

export const listAssets = query({
    args: { category: v.optional(v.string()), status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("assets").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        if (args.litres <= 0) throw new Error("Litres must be greater than zero");

        const total = Math.round(args.litres * args.pricePerLitre);
        const id = await ctx.db.insert("fuelDispenses", {
            businessProfileId: businessId,
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
    args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("fuelDispenses").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("vehicles").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
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
        active: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
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
    args: {},
    handler: async (ctx) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("routeFares").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);

        // Only one open session per user per shop.
        const open = await ctx.db
            .query("tillSessions")
            .filter((q) => q.and(q.eq(q.field("userId"), args.userId), q.eq(q.field("status"), "open")))
            .collect();
        if (open.length > 0) {
            throw new Error("You already have an open till session. Close it before opening another.");
        }

        const count = (await ctx.db.query("tillSessions").collect()).length + 1;
        const sessionNumber = `TILL-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("tillSessions", {
            businessProfileId: businessId,
            sessionNumber,
            userId: args.userId,
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
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const session = await ctx.db.get(args.id);
        if (!session) throw new Error("Till session not found");
        if (session.status === "closed") throw new Error("This till session is already closed");

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
    args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("tillSessions").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

/* ───────────────────────── service tickets ───────────────────────── */

export const listServiceTickets = query({
    args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("serviceTickets").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const count = (await ctx.db.query("serviceTickets").collect()).length + 1;
        const ticketNumber = `JOB-${String(count).padStart(4, "0")}`;

        const id = await ctx.db.insert("serviceTickets", {
            businessProfileId: businessId,
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
            userId: args.userId,
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
    },
    handler: async (ctx, args) => {
        const patch: Record<string, unknown> = {};
        if (args.status) patch.status = args.status;
        if (args.finalCost !== undefined) patch.finalCost = args.finalCost;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.status === "delivered") patch.deliveredDate = args.deliveredDate || new Date().toISOString();
        await ctx.db.patch(args.id, patch);
        return args.id;
    },
});

/* ───────────────────────── rentals ───────────────────────── */

export const listRentals = query({
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("rentals").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const id = await ctx.db.insert("rentals", {
            businessProfileId: businessId,
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
    args: { id: v.id("rentals"), condition: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const rental = await ctx.db.get(args.id);
        if (!rental) throw new Error("Rental not found");
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);

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
            businessProfileId: businessId,
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
    args: { date: v.optional(v.string()), className: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("attendance").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
    args: { className: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("classEnrolments").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const id = await ctx.db.insert("classEnrolments", {
            businessProfileId: businessId,
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
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("productionBatches").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const id = await ctx.db.insert("productionBatches", {
            businessProfileId: businessId,
            productName: args.productName,
            category: args.category,
            quantityProduced: args.quantityProduced,
            quantitySold: 0,
            unit: args.unit,
            batchNumber: args.batchNumber,
            expiryDate: args.expiryDate,
            costPerUnit: args.costPerUnit,
            date: new Date().toISOString(),
            userId: args.userId,
            status: "active",
        });
        return id;
    },
});

/* ───────────────────────── recurring charges ───────────────────────── */

export const listRecurringCharges = query({
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("recurringCharges").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
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
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("recurringCharges", payload);
    },
});
