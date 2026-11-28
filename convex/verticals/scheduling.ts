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
import { ConvexError } from "convex/values";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "../packages/manage";

/* ───────────────────────── appointments ───────────────────────── */

export const listAppointments = query({
    args: {
        date: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        status: v.optional(v.string()),
        businessType: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db
            .query("appointments")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["appointments"]);

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
                throw new ConvexError(`${args.staffName ?? "Staff"} already has an appointment at ${args.startTime} on ${args.date}.`);
            }
        }

        const id = await ctx.db.insert("appointments", {
            businessId,
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
            businessId,
            userId: tenant.user._id,
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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["appointments"]);
        const appt = await ctx.db.get(args.id);
        if (!appt) throw new ConvexError("Appointment not found");
        if (appt.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

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
            businessId,
            userId: tenant.user._id,
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
        status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("serviceOutlets").collect();
        rows = rows.filter((r) => r.businessId === businessId);

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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        const id = await ctx.db.insert("serviceOutlets", {
            businessId,
            businessType: args.businessType,
            name: args.name,
            capacity: args.capacity,
            status: "available",
            rate: args.rate,
            shopId: args.shopId,
            notes: args.notes,
        });
        await ctx.db.insert("activityLogs", {
            businessId,
            userId: tenant.user._id,
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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        const outlet = await ctx.db.get(args.id);
        if (!outlet) throw new ConvexError("Table not found");
        if (outlet.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["tables"]);
        const outlet = await ctx.db.get(args.outletId);
        if (!outlet) throw new ConvexError("Table not found");
        if (outlet.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (outlet.status === "occupied") throw new ConvexError(`${outlet.name} already has an open order`);

        const id = await ctx.db.insert("tableOrders", {
            businessId,
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["tables"]);
        const order = await ctx.db.get(args.tableOrderId);
        if (!order) throw new ConvexError("Table order not found");
        if (order.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (order.status !== "open") throw new ConvexError("This table order is already closed");

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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["tables"]);
        const order = await ctx.db.get(args.tableOrderId);
        if (!order) throw new ConvexError("Table order not found");
        if (order.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

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
    args: { status: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("tableOrders").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
        return rows;
    },
});

/* ───────────────────────── menu ───────────────────────── */

export const listMenu = query({
    args: { category: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("menuItems").collect();
        rows = rows.filter((r) => r.businessId === businessId);
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
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["menu"]);
        const payload = {
            businessId,
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
            // Amending an existing item is a catalogue change, so it is
            // permission-checked and the row must belong to the caller.
            await requirePermission(ctx, businessId, "products.update");
            const existing = await ctx.db.get(args.id);
            if (!existing) throw new ConvexError("Menu item not found");
            if (existing.businessId !== businessId) {
                throw new ConvexError("Forbidden: that record belongs to another business.");
            }
            await ctx.db.patch(args.id, payload);
            await logActivity(ctx, businessId, tenant.user._id, "Update Menu Item", `${payload.name} updated`);
            await writeAudit(ctx, {
                businessId,
                actorUserId: tenant.user._id,
                actorRole: tenant.membership.role,
                action: "menu.item.update",
                targetType: "menu_item",
                targetId: args.id,
                metadata: { name: payload.name, category: payload.category, price: payload.price },
            });
            return args.id;
        }
        return await ctx.db.insert("menuItems", payload);
    },
});

export const toggleMenuAvailability = mutation({
    args: { id: v.id("menuItems"), available: v.boolean(), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["menu"]);
        const item = await ctx.db.get(args.id);
        if (!item) throw new ConvexError("Menu item not found");
        if (item.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        await ctx.db.patch(args.id, { available: args.available });
        return args.id;
    },
});

/* ───────────────────────── summary ───────────────────────── */

export const getScheduleSummary = query({
    args: { date: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const date = args.date ?? new Date().toISOString().slice(0, 10);

        const appts = await ctx.db
            .query("appointments")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const today = appts.filter((a) => a.date === date);

        let outlets = await ctx.db.query("serviceOutlets").collect();
        outlets = outlets.filter((r) => r.businessId === businessId);

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

/* ───────────────────────── record lifecycle ───────────────────────── */

/**
 * Amend a booking.
 *
 * Only the fields the front desk edits are writable. The tenant, the shop
 * and the money side of the record are never taken from the client.
 */
export const updateAppointment = mutation({
    args: {
        id: v.id("appointments"),
        customerName: v.optional(v.string()),
        customerPhone: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        staffName: v.optional(v.string()),
        serviceName: v.optional(v.string()),
        date: v.optional(v.string()),
        startTime: v.optional(v.string()),
        endTime: v.optional(v.string()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const appt = await ctx.db.get(args.id);
        if (!appt) throw new ConvexError("Appointment not found");
        if (appt.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        const date = args.date ?? appt.date;
        const startTime = args.startTime ?? appt.startTime;
        const endTime = args.endTime ?? appt.endTime;
        const staffId = args.staffId ?? appt.staffId;

        // Guard against double-booking the same staff member at the same time.
        if (staffId) {
            const dayAppts = await ctx.db
                .query("appointments")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .collect();
            const overlapping = dayAppts.filter(
                (a) =>
                    a._id !== args.id &&
                    a.date === date &&
                    a.staffId === staffId &&
                    a.status === "confirmed" &&
                    a.startTime < (endTime ?? "23:59") &&
                    (endTime ?? "23:59") > a.startTime
            );
        await assertScreenAvailable(ctx, businessId, ["appointments"]);
            if (overlapping.length > 0) {
                throw new ConvexError(
                    `${args.staffName ?? appt.staffName ?? "Staff"} already has an appointment at ${startTime} on ${date}.`
                );
            }
        }

        await ctx.db.patch(args.id, {
            ...(args.customerName !== undefined ? { customerName: args.customerName } : {}),
            ...(args.customerPhone !== undefined ? { customerPhone: args.customerPhone } : {}),
            ...(args.staffId !== undefined ? { staffId: args.staffId } : {}),
            ...(args.staffName !== undefined ? { staffName: args.staffName } : {}),
            ...(args.serviceName !== undefined ? { serviceName: args.serviceName } : {}),
            ...(args.date !== undefined ? { date: args.date } : {}),
            ...(args.startTime !== undefined ? { startTime: args.startTime } : {}),
            ...(args.endTime !== undefined ? { endTime: args.endTime } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });

        // Completing or cancelling a chair/room booking frees the outlet again.
        if (args.status === "completed" || args.status === "cancelled") {
            const outlets = await ctx.db.query("serviceOutlets").collect();
            for (const o of outlets) {
                if (o.businessId === businessId && o.currentBookingId === args.id) {
                    await ctx.db.patch(o._id, { currentBookingId: undefined, status: "available" });
                }
            }
        }

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Appointment",
            `${appt.serviceName} for ${appt.customerName} amended`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "appointment.update",
            targetType: "appointment",
            targetId: args.id,
            metadata: {
                customerName: args.customerName ?? appt.customerName,
                serviceName: args.serviceName ?? appt.serviceName,
                date: args.date ?? appt.date,
                startTime: args.startTime ?? appt.startTime,
                status: args.status ?? appt.status,
            },
        });

        return args.id;
    },
});

/**
 * Delete a booking.
 *
 * A booking that is currently holding a room or chair cannot be deleted —
 * the outlet has to be released first, otherwise the room would be stranded.
 */
export const deleteAppointment = mutation({
    args: {
        id: v.id("appointments"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const appt = await ctx.db.get(args.id);
        if (!appt) throw new ConvexError("Appointment not found");
        if (appt.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }
        if (appt.businessType === "prescription") {
            throw new ConvexError("Prescriptions are clinical records and cannot be deleted here.");
        }

        const outlets = await ctx.db.query("serviceOutlets").collect();
        const holder = outlets.find((o) => o.businessId === businessId && o.currentBookingId === args.id);
        if (holder) {
            throw new ConvexError(
                `${holder.name} is still held by this booking. Complete or cancel the appointment before deleting it.`
            );
        await assertScreenAvailable(ctx, businessId, ["appointments"]);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Appointment",
            `${appt.serviceName} for ${appt.customerName} on ${appt.date} deleted`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "appointment.delete",
            targetType: "appointment",
            targetId: args.id,
            metadata: {
                customerName: appt.customerName,
                serviceName: appt.serviceName,
                date: appt.date,
                startTime: appt.startTime,
                businessType: appt.businessType,
            },
        });

        return args.id;
    },
});

/** Amend the details of a table / room / chair. */
export const updateOutlet = mutation({
    args: {
        id: v.id("serviceOutlets"),
        name: v.optional(v.string()),
        capacity: v.optional(v.number()),
        rate: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["services"]);
        await requirePermission(ctx, businessId, "sales.create");

        const outlet = await ctx.db.get(args.id);
        if (!outlet) throw new ConvexError("Table not found");
        if (outlet.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.capacity !== undefined ? { capacity: args.capacity } : {}),
            ...(args.rate !== undefined ? { rate: args.rate } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });

        await logActivity(ctx, businessId, tenant.user._id, "Update Outlet", `${outlet.name} updated`);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "outlet.update",
            targetType: "service_outlet",
            targetId: args.id,
            metadata: {
                name: args.name ?? outlet.name,
                capacity: args.capacity ?? outlet.capacity,
                rate: args.rate ?? outlet.rate,
            },
        });

        return args.id;
    },
});

/**
 * Delete a table / room / chair.
 *
 * Refused when an order was ever opened on it: the order points at the
 * outlet, so removing the outlet would orphan a sales record.
 */
export const deleteOutlet = mutation({
    args: {
        id: v.id("serviceOutlets"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        const outlet = await ctx.db.get(args.id);
        if (!outlet) throw new ConvexError("Table not found");
        if (outlet.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        const orders = await ctx.db.query("tableOrders").collect();
        const used = orders.find((o) => o.businessId === businessId && o.outletId === args.id);
        if (used) {
            throw new ConvexError(
                `${outlet.name} has order history and cannot be deleted. Take it out of service instead.`
            );
        await assertScreenAvailable(ctx, businessId, ["services"]);
        }
        if (outlet.currentBookingId) {
            throw new ConvexError(`${outlet.name} is currently held by a booking. Complete or cancel it first.`);
        }

        await ctx.db.delete(args.id);

        await logActivity(ctx, businessId, tenant.user._id, "Delete Outlet", `${outlet.name} deleted`);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "outlet.delete",
            targetType: "service_outlet",
            targetId: args.id,
            metadata: { name: outlet.name, businessType: outlet.businessType, capacity: outlet.capacity },
        });

        return args.id;
    },
});

/**
 * Delete a menu item.
 *
 * Nothing points at a menu item: orders copy the name and the price and
 * point at the stock, so the catalogue entry itself is safe to remove.
 */
export const deleteMenuItem = mutation({
    args: {
        id: v.id("menuItems"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["menu"]);
        await requirePermission(ctx, businessId, "products.update");

        const item = await ctx.db.get(args.id);
        if (!item) throw new ConvexError("Menu item not found");
        if (item.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.delete(args.id);

        await logActivity(ctx, businessId, tenant.user._id, "Delete Menu Item", `${item.name} deleted`);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "menu.item.delete",
            targetType: "menu_item",
            targetId: args.id,
            metadata: { name: item.name, category: item.category, price: item.price },
        });

        return args.id;
    },
});
