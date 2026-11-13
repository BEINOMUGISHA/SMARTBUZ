/**
 * SMARTBUZ — Vertical Module 2: Scheduling
 *
 * Powers every booked-service vertical in Uganda:
 *   - salons & barbershops (chair bookings, stylist commission)
 *   - clinics & veterinary (patient appointments)
 *   - hotels (room nights, bookings)
 *   - restaurants & cafes (table orders, open tabs)
 *   - schools & driving schools (classes, lessons)
 *   - events, photography, cleaning services
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getActiveBusinessId } from "./batches";

/* ───────────────────────── appointments ───────────────────────── */

export const listAppointments = query({
    args: {
        date: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        status: v.optional(v.string()),
        businessType: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("appointments").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        if (args.date) {
            rows = rows.filter((r) => r.date === args.date);
        } else if (args.startDate) {
            rows = rows.filter((r) => r.date >= args.startDate! && (!args.endDate || r.date <= args.endDate!));
        }
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        if (args.businessType) rows = rows.filter((r) => r.businessType === args.businessType);
        if (args.staffId) rows = rows.filter((r) => r.staffId === args.staffId);

        rows.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const createAppointment = mutation({
    args: {
        businessType: v.string(),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        staffName: v.optional(v.string()),
        serviceName: v.string(),
        date: v.string(),
        startTime: v.string(),
        endTime: v.optional(v.string()),
        notes: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);

        // Guard against double-booking the same staff member at the same time.
        if (args.staffId) {
            const clash = await ctx.db
                .query("appointments")
                .filter((q) =>
                    q.and(
                        q.eq(q.field("staffId"), args.staffId!),
                        q.eq(q.field("date"), args.date),
                        q.eq(q.field("status"), "confirmed")
                    )
                )
                .collect();
            const overlapping = clash.filter((a) => a.startTime < (args.endTime ?? "23:59") && (args.endTime ?? "23:59") > a.startTime);
            if (overlapping.length > 0) {
                throw new Error(`${args.staffName ?? "Staff"} already has an appointment at ${args.startTime} on ${args.date}.`);
            }
        }

        const id = await ctx.db.insert("appointments", {
            businessProfileId: businessId,
            businessType: args.businessType,
            customerId: args.customerId,
            customerName: args.customerName,
            customerPhone: args.customerPhone,
            staffId: args.staffId,
            staffName: args.staffName,
            serviceName: args.serviceName,
            date: args.date,
            startTime: args.startTime,
            endTime: args.endTime,
            status: "pending",
            notes: args.notes,
            shopId: args.shopId,
            createdBy: args.userId,
            createdAt: new Date().toISOString(),
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Appointment",
            details: `${args.serviceName} for ${args.customerName} on ${args.date} at ${args.startTime}`,
            timestamp: new Date().toISOString(),
        });

        return id;
    },
});

export const updateAppointmentStatus = mutation({
    args: {
        id: v.id("appointments"),
        status: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const appt = await ctx.db.get(args.id);
        if (!appt) throw new Error("Appointment not found");

        await ctx.db.patch(args.id, { status: args.status });

        // Completing a chair/room booking frees the outlet again.
        if (args.status === "completed" || args.status === "cancelled") {
            const outlets = await ctx.db.query("serviceOutlets").collect();
            for (const o of outlets) {
                if (o.currentBookingId === args.id) {
                    await ctx.db.patch(o._id, { currentBookingId: undefined, status: "available" });
                }
            }
        }

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Update Appointment",
            details: `Appointment for ${appt.customerName} marked ${args.status}`,
            timestamp: new Date().toISOString(),
        });

        return args.id;
    },
});

/* ───────────────────────── outlets (tables / rooms / chairs) ───────────────────────── */

export const listOutlets = query({
    args: {
        businessType: v.optional(v.string()),
        status: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("serviceOutlets").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        if (args.businessType) rows = rows.filter((r) => r.businessType === args.businessType);
        if (args.status) rows = rows.filter((r) => r.status === args.status);

        rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        return rows;
    },
});

export const createOutlet = mutation({
    args: {
        businessType: v.string(),
        name: v.string(),
        capacity: v.optional(v.number()),
        rate: v.optional(v.number()),
        shopId: v.optional(v.id("shops")),
        notes: v.optional(v.string()),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const id = await ctx.db.insert("serviceOutlets", {
            businessProfileId: businessId,
            businessType: args.businessType,
            name: args.name,
            capacity: args.capacity,
            status: "available",
            rate: args.rate,
            shopId: args.shopId,
            notes: args.notes,
        });
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: `Create ${args.businessType}`,
            details: `Created ${args.businessType} ${args.name}`,
            timestamp: new Date().toISOString(),
        });
        return id;
    },
});

export const updateOutletStatus = mutation({
    args: {
        id: v.id("serviceOutlets"),
        status: v.string(),
        currentBookingId: v.optional(v.id("appointments")),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, {
            status: args.status,
            currentBookingId: args.currentBookingId,
        });
        return args.id;
    },
});

/* ───────────────────────── table orders (restaurant / cafe) ───────────────────────── */

/** Open a tab on a table. */
export const openTableOrder = mutation({
    args: {
        outletId: v.id("serviceOutlets"),
        customerName: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const outlet = await ctx.db.get(args.outletId);
        if (!outlet) throw new Error("Table not found");
        if (outlet.status === "occupied") throw new Error(`${outlet.name} already has an open order`);

        const businessId = await getActiveBusinessId(ctx);
        const id = await ctx.db.insert("tableOrders", {
            businessProfileId: businessId,
            outletId: args.outletId,
            outletName: outlet.name,
            customerName: args.customerName,
            staffId: args.staffId,
            status: "open",
            openedAt: new Date().toISOString(),
            total: 0,
            items: [],
        });

        await ctx.db.patch(args.outletId, { status: "occupied", currentBookingId: undefined });
        return id;
    },
});

/** Add items to an open table order, recomputing the running total. */
export const addTableOrderItems = mutation({
    args: {
        tableOrderId: v.id("tableOrders"),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            price: v.number(),
            quantity: v.number(),
            notes: v.optional(v.string()),
        })),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const order = await ctx.db.get(args.tableOrderId);
        if (!order) throw new Error("Table order not found");
        if (order.status !== "open") throw new Error("This table order is already closed");

        const items = [...order.items, ...args.items];
        const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

        await ctx.db.patch(args.tableOrderId, { items, total });
        return { total };
    },
});

export const closeTableOrder = mutation({
    args: {
        tableOrderId: v.id("tableOrders"),
        saleId: v.optional(v.id("sales")),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const order = await ctx.db.get(args.tableOrderId);
        if (!order) throw new Error("Table order not found");

        await ctx.db.patch(args.tableOrderId, {
            status: "paid",
            closedAt: new Date().toISOString(),
            saleId: args.saleId,
        });

        const outlet = await ctx.db.get(order.outletId);
        if (outlet) {
            await ctx.db.patch(outlet._id, { status: "cleaning", currentBookingId: undefined });
        }

        return order.total;
    },
});

export const listTableOrders = query({
    args: { status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("tableOrders").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
        return rows;
    },
});

/* ───────────────────────── menu ───────────────────────── */

export const listMenu = query({
    args: { category: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("menuItems").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        if (args.category) rows = rows.filter((r) => r.category === args.category);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        return rows;
    },
});

export const upsertMenuItem = mutation({
    args: {
        id: v.optional(v.id("menuItems")),
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        category: v.string(),
        price: v.number(),
        description: v.optional(v.string()),
        available: v.optional(v.boolean()),
        preparationMinutes: v.optional(v.number()),
        dietary: v.optional(v.array(v.string())),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const payload = {
            businessProfileId: businessId,
            stockId: args.stockId,
            name: args.name,
            category: args.category,
            price: args.price,
            description: args.description,
            available: args.available ?? true,
            preparationMinutes: args.preparationMinutes,
            dietary: args.dietary,
        };

        if (args.id) {
            await ctx.db.patch(args.id, payload);
            return args.id;
        }
        return await ctx.db.insert("menuItems", payload);
    },
});

export const toggleMenuAvailability = mutation({
    args: { id: v.id("menuItems"), available: v.boolean() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, { available: args.available });
        return args.id;
    },
});

/* ───────────────────────── summary ───────────────────────── */

export const getScheduleSummary = query({
    args: { date: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const date = args.date ?? new Date().toISOString().slice(0, 10);

        let appts = await ctx.db.query("appointments").collect();
        if (businessId) appts = appts.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        const today = appts.filter((a) => a.date === date);

        let outlets = await ctx.db.query("serviceOutlets").collect();
        if (businessId) outlets = outlets.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        const byStatus = today.reduce((acc: Record<string, number>, a) => {
            acc[a.status] = (acc[a.status] ?? 0) + 1;
            return acc;
        }, {});

        return {
            date,
            total: today.length,
            pending: byStatus.pending ?? 0,
            confirmed: byStatus.confirmed ?? 0,
            completed: byStatus.completed ?? 0,
            cancelled: byStatus.cancelled ?? 0,
            outletsTotal: outlets.length,
            outletsAvailable: outlets.filter((o) => o.status === "available").length,
            outletsOccupied: outlets.filter((o) => o.status === "occupied").length,
        };
    },
});
