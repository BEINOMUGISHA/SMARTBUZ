/**
 * SMARTBUZ — the hardware registry.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why the server keeps a register of hardware at all
 * ────────────────────────────────────────────────────────────────────────
 *
 * A barcode scanner, a receipt printer, a cash drawer and a weighing
 * scale are all attached to **one till** — one browser on one machine at
 * one counter. The browser is what talks to them, because the browser is
 * the only thing that can reach a USB or serial port.
 *
 * But the server still needs to know what is supposed to be at each
 * counter, because the owner has to be able to answer "which till has the
 * scale?" and "is the printer at branch 2 working?" from the office.
 *
 * So the server keeps the register, and the browser reports what it
 * actually found.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The honesty rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * A device is `verified` only when a person has confirmed it works.
 *
 * The browser can report that it wrote bytes to a printer — but it cannot
 * read the paper, so it cannot know the paper came out right. A cash
 * drawer cannot report that it opened at all: its status line is a serial
 * pin that the Web Serial API cannot read. Both of those are recorded as
 * `verified: false` with an explanation, and only a person can turn them
 * into `verified`.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { HARDWARE, findHardware } from "./registry";
import type { HardwareKind } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The hardware this business has registered.
 *
 * Each device is returned with what the browser last reported about it,
 * so the owner can see what is working and what is not.
 */
export const listHardware = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        kind: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "integrations.view");

        const rows = await ctx.db
            .query("hardwareDevices")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const filtered = args.kind
            ? rows.filter((row) => row.kind === args.kind)
            : rows;

        return filtered.map((row) => ({
            id: row._id,
            hardwareKey: row.hardwareKey,
            kind: row.kind,
            name: row.name,
            shopId: row.shopId,
            branchId: row.branchId,
            deviceId: row.deviceId,
            config: row.config ?? {},
            status: row.status,
            statusNote: row.statusNote,
            lastSeenAt: row.lastSeenAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    },
});

/**
 * The hardware catalogue, with what each business has registered.
 */
export const listHardwareWithCatalogue = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "integrations.view");

        const rows = await ctx.db
            .query("hardwareDevices")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return HARDWARE.map((hardware) => {
            const devices = rows.filter((row) => row.hardwareKey === hardware.key);
            return {
                key: hardware.key,
                kind: hardware.kind,
                label: hardware.label,
                vendor: hardware.vendor,
                summary: hardware.summary,
                transport: hardware.transport,
                requirements: hardware.requirements,
                limitations: hardware.limitations,
                verification: hardware.verification,
                devices: devices.map((row) => ({
                    id: row._id,
                    name: row.name,
                    status: row.status,
                    statusNote: row.statusNote,
                    shopId: row.shopId,
                    branchId: row.branchId,
                    deviceId: row.deviceId,
                    config: row.config ?? {},
                    lastSeenAt: row.lastSeenAt,
                })),
            };
        });
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Register a piece of hardware, or update what is known about it.
 */
export const saveHardware = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        hardwareKey: v.string(),
        name: v.string(),
        id: v.optional(v.id("hardwareDevices")),
        shopId: v.optional(v.id("shops")),
        branchId: v.optional(v.id("branches")),
        deviceId: v.optional(v.string()),
        config: v.optional(v.record(v.string(), v.any())),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "hardware.manage"
        );

        const hardware = findHardware(args.hardwareKey);
        if (!hardware) {
            throw new ConvexError(`Unknown hardware: ${args.hardwareKey}.`);
        }

        const now = new Date().toISOString();

        if (args.id) {
            const existing = await ctx.db.get(args.id);
            if (!existing || existing.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that device belongs to another business."
                );
            }

            await ctx.db.patch(existing._id, {
                name: args.name,
                shopId: args.shopId,
                branchId: args.branchId,
                deviceId: args.deviceId,
                config: args.config ?? existing.config,
                updatedBy: membership.userId,
                updatedAt: now,
            });

            return existing._id;
        }

        return await ctx.db.insert("hardwareDevices", {
            businessId,
            hardwareKey: args.hardwareKey,
            kind: hardware.kind,
            name: args.name,
            shopId: args.shopId,
            branchId: args.branchId,
            deviceId: args.deviceId,
            config: args.config ?? {},
            // A newly registered device has never been seen working.
            status: "configured",
            updatedBy: membership.userId,
            createdAt: now,
            updatedAt: now,
        });
    },
});

/**
 * The browser reports what it actually found.
 *
 * This is the honest path: the browser says what it did, and the
 * `verified` flag it sends is respected. A browser that reports
 * `verified: true` for a drawer is not believed — the drawer status
 * cannot be read, so the server downgrades it.
 */
export const reportHardware = mutation({
    args: {
        businessId: v.id("businesses"),
        hardwareKey: v.string(),
        deviceId: v.optional(v.string()),
        /** What the browser did. */
        observed: v.string(),
        /** Whether the browser could confirm the device works. */
        verified: v.optional(v.boolean()),
        config: v.optional(v.record(v.string(), v.any())),
        deviceRecordId: v.optional(v.id("hardwareDevices")),
    },
    handler: async (ctx, args) => {
        const hardware = findHardware(args.hardwareKey);
        if (!hardware) {
            throw new ConvexError(`Unknown hardware: ${args.hardwareKey}.`);
        }

        const now = new Date().toISOString();

        // A drawer cannot be confirmed from a browser at all, so a report
        // claiming otherwise is not taken at face value.
        const canConfirm =
            hardware.kind === "cash_drawer" ? false : args.verified ?? false;

        const status = canConfirm ? "verified" : "configured";

        let recordId = args.deviceRecordId;

        if (recordId) {
            const existing = await ctx.db.get(recordId);
            if (!existing || existing.businessId !== args.businessId) {
                throw new ConvexError(
                    "Forbidden: that device belongs to another business."
                );
            }
            await ctx.db.patch(existing._id, {
                deviceId: args.deviceId ?? existing.deviceId,
                config: args.config ?? existing.config,
                status,
                statusNote: args.observed,
                lastSeenAt: now,
                updatedAt: now,
            });
            return existing._id;
        }

        // No record yet — register one against the till that reported it.
        return await ctx.db.insert("hardwareDevices", {
            businessId: args.businessId,
            hardwareKey: args.hardwareKey,
            kind: hardware.kind,
            name: hardware.label,
            deviceId: args.deviceId,
            config: args.config ?? {},
            status,
            statusNote: args.observed,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
        });
    },
});

/**
 * Record what a person decided about a device.
 *
 * This is the only way a device becomes `verified` when the software
 * cannot know — a drawer, a printer whose paper came out wrong, a scale
 * that is reading a kilo too heavy.
 */
export const setHardwareStatus = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        id: v.id("hardwareDevices"),
        status: v.string(),
        note: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "hardware.manage"
        );

        const device = await ctx.db.get(args.id);
        if (!device || device.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that device belongs to another business."
            );
        }

        const allowed = ["configured", "testing", "verified", "not_working"];
        if (!allowed.includes(args.status)) {
            throw new ConvexError(
                `A device's status must be one of: ${allowed.join(", ")}.`
            );
        }

        await ctx.db.patch(device._id, {
            status: args.status,
            statusNote: args.note,
            updatedBy: membership.userId,
            updatedAt: new Date().toISOString(),
        });

        return null;
    },
});

/**
 * Forget a device.
 *
 * The record of what happened with it is not kept — a till's hardware is
 * not part of the books, and keeping it would only confuse the owner. The
 * payments and messages it was used with are untouched.
 */
export const removeHardware = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        id: v.id("hardwareDevices"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "hardware.manage");

        const device = await ctx.db.get(args.id);
        if (!device || device.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that device belongs to another business."
            );
        }

        await ctx.db.delete(device._id);
        return null;
    },
});

/** The kinds of hardware SMARTBUZ knows about. */
export const HARDWARE_KINDS: HardwareKind[] = [
    "barcode_scanner",
    "thermal_printer",
    "cash_drawer",
    "weighing_scale",
];
