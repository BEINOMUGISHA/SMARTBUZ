/**
 * SMART_BUZ — the front desk.
 *
 * The screen a hotel, guest house, hostel, lodge or serviced apartment
 * works from: what rooms exist, who is in them, who is arriving, what a
 * guest has put on their account, and what the night came to.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What the server owns
 *
 * A front desk is a machine for money that the guest must not be able to
 * argue with. The number of nights is counted from the two dates, the
 * rate comes from the room, the total is multiplied out here, and a guest
 * charge is added to a folio whose balance is worked out from the entries
 * themselves. The browser is told the result; it is never asked to do the
 * arithmetic.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The folio
 *
 * A folio is the running account of what a guest owes. Every entry on it
 * is one row in `folioEntries`, and the two kinds of row go opposite ways:
 * a charge puts money on the account, a payment takes it off. The balance
 * is the difference between the two, which means it cannot drift — there is
 * no second copy of the total to fall out of step with the entries.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this module does not do
 *
 * It does not take card payments and it does not print a room key. It
 * records what the business did; the till, the payment provider and the
 * printer are other people's jobs.
 */

import { mutation, query } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

/** The states a stay moves through. */
const STAY_STATUSES = ["reserved", "in_house", "checked_out", "cancelled"] as const;
type StayStatus = (typeof STAY_STATUSES)[number];

/** The housekeeping board. */
const HOUSEKEEPING_STATES = [
    "clean",
    "dirty",
    "servicing",
    "inspected",
    "out_of_service",
] as const;
type HousekeepingState = (typeof HOUSEKEEPING_STATES)[number];

/** The kinds of folio entry. */
const ENTRY_KINDS = ["charge", "payment"] as const;
type EntryKind = (typeof ENTRY_KINDS)[number];

/** The moves a stay is allowed to make. */
const STAY_TRANSITIONS: Record<StayStatus, StayStatus[]> = {
    reserved: ["in_house", "cancelled"],
    in_house: ["checked_out"],
    checked_out: [],
    cancelled: [],
};

/** The charges a guest can be given. */
const CHARGE_CATEGORIES = [
    "minibar",
    "laundry",
    "room_service",
    "damage",
    "other",
] as const;

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD` for today, on the server's clock. */
function today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * The number of nights between two dates.
 *
 * A guest who arrives on the 3rd and leaves on the 5th has two nights,
 * not three: the night of the 3rd and the night of the 4th. The counting
 * is done here so that the same stay is always the same length, whoever
 * asked for it.
 */
function nightsBetween(checkIn: string, checkOut: string): number {
    const from = Date.parse(`${checkIn}T00:00:00Z`);
    const to = Date.parse(`${checkOut}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new ConvexError("Those dates could not be read.");
    }
    const nights = Math.round((to - from) / 86400000);
    if (nights < 0) {
        throw new ConvexError("The leaving date cannot be before the arrival date.");
    }
    return nights;
}

/** `YYYY-MM-DD`, `days` days from today. */
function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
        .toISOString()
        .slice(0, 10);
}

/**
 * The balance of a folio: the room, plus the charges, less the payments.
 */
async function folioBalance(
    ctx: { db: any },
    booking: { _id: Id<"roomBookings">; total: number }
): Promise<{ charges: number; payments: number; balance: number }> {
    const entries = await ctx.db
        .query("folioEntries")
        .withIndex("by_bookingId", (q: any) => q.eq("bookingId", booking._id))
        .collect();

    let charges = 0;
    let payments = 0;
    for (const entry of entries) {
        if (entry.kind === "payment") payments += entry.amount;
        else charges += entry.amount;
    }

    return { charges, payments, balance: booking.total + charges - payments };
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading the board
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The rooms this business can sell, with what each one is doing.
 *
 * A room that is occupied is occupied because a stay says so, not because
 * somebody ticked a box — so the state is worked out from the stays of the
 * current night.
 */
export const listRoomInventory = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** `YYYY-MM-DD` — the night being looked at. Defaults to today. */
        onDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const night = args.onDate ?? today();

        const rooms = await ctx.db
            .query("serviceOutlets")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const roomsOfType = rooms.filter(
            (room) => room.businessType === "room" || room.businessType === "chair"
        );

        const stays = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const active = stays.filter(
            (stay) =>
                stay.status === "reserved" ||
                stay.status === "in_house" ||
                (stay.status === "checked_out" && stay.checkOut >= night)
        );

        return roomsOfType
            .filter((room) => room.status !== "deleted")
            .map((room) => {
                const stay = active.find(
                    (s) => s.outletId === room._id && s.status !== "cancelled"
                );
                const occupied = Boolean(
                    stay &&
                        (stay.status === "in_house" ||
                            (stay.status === "reserved" &&
                                stay.checkIn <= night &&
                                stay.checkOut >= night))
                );

                return {
                    _id: room._id,
                    name: room.name,
                    businessType: room.businessType,
                    capacity: room.capacity ?? 1,
                    rate: room.rate ?? 0,
                    housekeepingStatus:
                        (room.housekeepingStatus as string | undefined) ?? "clean",
                    outOfService: room.housekeepingStatus === "out_of_service",
                    occupied,
                    stayId: stay?._id ?? null,
                    stayStatus: stay?.status ?? null,
                    guestName: occupied ? (stay?.guestName ?? null) : null,
                    checkOut: occupied ? (stay?.checkOut ?? null) : null,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

/**
 * The stays this business has, newest first.
 */
export const listStays = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
        /** Only the stays arriving on this date or later. */
        fromDate: v.optional(v.string()),
        /** Only the stays leaving on this date or earlier. */
        toDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const rows = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const filtered = rows.filter((stay) => {
            if (args.status && stay.status !== args.status) return false;
            if (args.fromDate && stay.checkOut < args.fromDate) return false;
            if (args.toDate && stay.checkIn > args.toDate) return false;
            return true;
        });

        const results = [];
        for (const stay of filtered) {
            const folio = await folioBalance(ctx, stay);
            results.push({
                _id: stay._id,
                roomName: stay.roomName,
                outletId: stay.outletId ?? null,
                guestName: stay.guestName,
                guestPhone: stay.guestPhone ?? null,
                checkIn: stay.checkIn,
                checkOut: stay.checkOut,
                nights: stay.nights,
                nightlyRate: stay.nightlyRate,
                total: stay.total,
                charges: folio.charges,
                paid: folio.payments,
                balance: folio.balance,
                status: stay.status,
                housekeepingStatus: stay.housekeepingStatus ?? null,
                notes: stay.notes ?? null,
                createdAt: stay.createdAt,
            });
        }

        return results.sort((a, b) => {
            if (a.checkIn !== b.checkIn) return a.checkIn.localeCompare(b.checkIn);
            return b.createdAt.localeCompare(a.createdAt);
        });
    },
});

/**
 * The entries on one guest's folio.
 */
export const listFolioEntries = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");

        const booking = await ctx.db.get(args.bookingId);
        if (!booking || booking.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        }

        const entries = await ctx.db
            .query("folioEntries")
            .withIndex("by_bookingId", (q) => q.eq("bookingId", args.bookingId))
            .collect();

        const folio = await folioBalance(ctx, booking);

        return {
            entries: entries
                .map((entry) => ({
                    _id: entry._id,
                    kind: entry.kind,
                    description: entry.description,
                    amount: entry.amount,
                    category: entry.category ?? null,
                    method: entry.method ?? null,
                    reference: entry.reference ?? null,
                    date: entry.date,
                    createdAt: entry.createdAt,
                }))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            charges: folio.charges,
            payments: folio.payments,
            balance: folio.balance,
            roomTotal: booking.total,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * The board
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What the front desk needs to know at a glance.
 */
export const getFrontDeskSummary = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** `YYYY-MM-DD` — the night being looked at. Defaults to today. */
        onDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const night = args.onDate ?? today();

        const rooms = await ctx.db
            .query("serviceOutlets")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const sellable = rooms.filter(
            (room) =>
                (room.businessType === "room" || room.businessType === "chair") &&
                room.status !== "deleted"
        );

        const stays = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const inHouse = stays.filter((stay) => stay.status === "in_house");
        const arrivals = stays.filter(
            (stay) => stay.status === "reserved" && stay.checkIn === night
        );
        const departures = stays.filter(
            (stay) => stay.status === "in_house" && stay.checkOut === night
        );

        const occupiedRooms = new Set(
            inHouse.map((stay) => stay.outletId).filter((id) => id !== undefined)
        );

        let outstanding = 0;
        let revenue = 0;
        for (const stay of inHouse) {
            const folio = await folioBalance(ctx, stay);
            outstanding += folio.balance;
            revenue += stay.total + folio.charges;
        }

        const roomRevenue = inHouse.reduce((sum, stay) => sum + stay.total, 0);

        return {
            date: night,
            roomsTotal: sellable.length,
            roomsOccupied: occupiedRooms.size,
            roomsOutOfService: sellable.filter(
                (room) => room.housekeepingStatus === "out_of_service"
            ).length,
            occupancyRate:
                sellable.length === 0
                    ? 0
                    : Math.round((occupiedRooms.size / sellable.length) * 100),
            inHouse: inHouse.length,
            arrivals: arrivals.length,
            departures: departures.length,
            roomRevenue,
            folioRevenue: revenue,
            outstanding,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Working
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Take a reservation.
 *
 * The room has to be free for the nights asked for, the rate comes from
 * the room, and the total is counted here. A room that is already taken
 * for any of those nights is refused — two bookings for one room is the
 * mistake a front desk cannot afford to make twice.
 */
export const createReservation = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        outletId: v.optional(v.id("serviceOutlets")),
        roomName: v.optional(v.string()),
        guestName: v.string(),
        guestPhone: v.optional(v.string()),
        guestEmail: v.optional(v.string()),
        /** `YYYY-MM-DD`. */
        checkIn: v.string(),
        /** `YYYY-MM-DD`. */
        checkOut: v.string(),
        /** Overrides the room's rate — the desk's discretion. */
        nightlyRate: v.optional(v.number()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        await assertPackageFeature(ctx, tenant.businessId, "reservations");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (!args.outletId && !args.roomName) {
            throw new ConvexError("Choose the room the guest is taking.");
        }
        if (!args.guestName.trim()) {
            throw new ConvexError("Who is the guest?");
        }

        let room = null;
        if (args.outletId) {
            room = await ctx.db.get(args.outletId);
            if (!room || room.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that room belongs to another business."
                );
            }
            if (room.businessType !== "room" && room.businessType !== "chair") {
                throw new ConvexError("That is not a room.");
            }
            if (room.housekeepingStatus === "out_of_service") {
                throw new ConvexError(
                    "That room is out of service and cannot be sold."
                );
            }
        }

        const roomName = room?.name ?? args.roomName!.trim();
        const nights = nightsBetween(args.checkIn, args.checkOut);
        if (nights === 0) {
            throw new ConvexError(
                "The leaving date has to be at least one night after the arrival date."
            );
        }

        const nightlyRate = args.nightlyRate ?? room?.rate ?? 0;
        if (nightlyRate < 0) {
            throw new ConvexError("The rate cannot be negative.");
        }

        // The room must be free for every night of the stay.
        const existing = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const clash = existing.find(
            (stay) =>
                stay.status !== "cancelled" &&
                stay.status !== "checked_out" &&
                stay.roomName === roomName &&
                stay.checkIn < args.checkOut &&
                stay.checkOut > args.checkIn
        );
        if (clash) {
            throw new ConvexError(
                `${roomName} is already taken from ${clash.checkIn} to ${clash.checkOut}.`
            );
        }

        const now = new Date().toISOString();
        const bookingId = await ctx.db.insert("roomBookings", {
            businessId,
            outletId: args.outletId,
            roomName,
            guestName: args.guestName.trim(),
            guestPhone: args.guestPhone,
            guestEmail: args.guestEmail,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
            nights,
            nightlyRate,
            total: nights * nightlyRate,
            amountPaid: 0,
            status: "reserved",
            housekeepingStatus: "clean",
            notes: args.notes,
            createdAt: now,
            updatedAt: now,
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Reservation",
            `${roomName}: ${args.guestName}, ${args.checkIn} → ${args.checkOut} (${nights} night(s), ${nights * nightlyRate})`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "sales.create",
            targetType: "roomBooking",
            targetId: bookingId,
            metadata: {
                roomName,
                guestName: args.guestName,
                checkIn: args.checkIn,
                checkOut: args.checkOut,
                nights,
                nightlyRate,
                total: nights * nightlyRate,
            },
        });

        return { bookingId, nights, nightlyRate, total: nights * nightlyRate };
    },
});

/**
 * Put a guest into their room.
 */
export const checkInStay = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const stay = await ctx.db.get(args.bookingId);
        if (!stay || stay.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["frontDesk"]);
        }

        const current = stay.status as StayStatus;
        if (!STAY_TRANSITIONS[current]?.includes("in_house")) {
            throw new ConvexError(
                `A stay that is ${current.replace("_", " ")} cannot be checked in.`
            );
        }

        const now = new Date().toISOString();
        await ctx.db.patch(stay._id, {
            status: "in_house",
            checkedInBy: userId,
            updatedAt: now,
        });

        // The room is now dirty — the guest's room needs cleaning after them.
        if (stay.outletId) {
            const room = await ctx.db.get(stay.outletId);
            if (room && room.businessId === businessId) {
                await ctx.db.patch(room._id, {
                    status: "occupied",
                    housekeepingStatus: "dirty",
                });
            }
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Check In",
            `${stay.roomName}: ${stay.guestName}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "sales.create",
            targetType: "roomBooking",
            targetId: stay._id,
            metadata: { roomName: stay.roomName, guestName: stay.guestName },
        });

        return { bookingId: stay._id, status: "in_house" as StayStatus };
    },
});

/**
 * Put a charge on a guest's account.
 *
 * The amount is checked here — a charge of nothing is a mistake, and a
 * charge that is not a number is worse — and it goes on the folio as an
 * entry, so the balance is worked out from the entries and not kept
 * anywhere else.
 */
export const postGuestCharge = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
        description: v.string(),
        amount: v.number(),
        category: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.income.create");
        await assertPackageFeature(ctx, tenant.businessId, "folio");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (!args.description.trim()) {
            throw new ConvexError("Say what the charge is for.");
        }
        if (!Number.isFinite(args.amount) || args.amount <= 0) {
            throw new ConvexError("The amount must be more than zero.");
        }
        if (args.category && !(CHARGE_CATEGORIES as readonly string[]).includes(args.category)) {
            throw new ConvexError("That is not a charge this hotel offers.");
        }

        const stay = await ctx.db.get(args.bookingId);
        if (!stay || stay.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["frontDesk"]);
        }
        if (stay.status !== "in_house") {
            throw new ConvexError(
                "Only a guest who is in the house can be charged."
            );
        }

        const now = new Date().toISOString();
        await ctx.db.insert("folioEntries", {
            businessId,
            bookingId: stay._id,
            kind: "charge",
            description: args.description.trim(),
            amount: args.amount,
            category: args.category ?? "other",
            date: today(),
            createdBy: userId,
            createdAt: now,
        });

        const folio = await folioBalance(ctx, stay);

        await logActivity(
            ctx,
            businessId,
            userId,
            "Guest Charge",
            `${stay.roomName}: ${args.description.trim()} — ${args.amount}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "finance.income.create",
            targetType: "roomBooking",
            targetId: stay._id,
            metadata: {
                description: args.description.trim(),
                amount: args.amount,
                category: args.category ?? "other",
                folioBalance: folio.balance,
            },
        });

        return { balance: folio.balance, charges: folio.charges };
    },
});

/**
 * Take a payment against a guest's account.
 */
export const recordStayPayment = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
        amount: v.number(),
        method: v.optional(v.string()),
        reference: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.income.create");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (!Number.isFinite(args.amount) || args.amount <= 0) {
            throw new ConvexError("The amount must be more than zero.");
        }

        const stay = await ctx.db.get(args.bookingId);
        if (!stay || stay.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["frontDesk"]);
        }
        if (stay.status !== "in_house" && stay.status !== "checked_out") {
            throw new ConvexError(
                "There is no account to pay against on this stay."
            );
        }

        const now = new Date().toISOString();
        await ctx.db.insert("folioEntries", {
            businessId,
            bookingId: stay._id,
            kind: "payment",
            description: "Payment received",
            amount: args.amount,
            method: args.method ?? "cash",
            reference: args.reference,
            date: today(),
            createdBy: userId,
            createdAt: now,
        });

        // The amount paid on the stay itself is kept in step with the folio.
        await ctx.db.patch(stay._id, {
            amountPaid: stay.amountPaid + args.amount,
            updatedAt: now,
        });

        const folio = await folioBalance(ctx, stay);

        await logActivity(
            ctx,
            businessId,
            userId,
            "Stay Payment",
            `${stay.roomName}: ${args.amount}${args.method ? ` (${args.method})` : ""}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "finance.income.create",
            targetType: "roomBooking",
            targetId: stay._id,
            metadata: {
                amount: args.amount,
                method: args.method ?? "cash",
                folioBalance: folio.balance,
            },
        });

        return { balance: folio.balance, payments: folio.payments };
    },
});

/**
 * Close a stay.
 *
 * What is owed is worked out from the folio and handed back with the
 * stay, so the desk knows exactly what to ask for at the counter.
 */
export const checkOutStay = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const stay = await ctx.db.get(args.bookingId);
        if (!stay || stay.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["frontDesk"]);
        }

        const current = stay.status as StayStatus;
        if (!STAY_TRANSITIONS[current]?.includes("checked_out")) {
            throw new ConvexError(
                `A stay that is ${current.replace("_", " ")} cannot be checked out.`
            );
        }

        const folio = await folioBalance(ctx, stay);
        const now = new Date().toISOString();

        await ctx.db.patch(stay._id, {
            status: "checked_out",
            checkedOutBy: userId,
            notes: args.notes ?? stay.notes,
            updatedAt: now,
        });

        // The room is dirty now that the guest has left it.
        if (stay.outletId) {
            const room = await ctx.db.get(stay.outletId);
            if (room && room.businessId === businessId) {
                await ctx.db.patch(room._id, {
                    status: "available",
                    housekeepingStatus: "dirty",
                });
            }
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Check Out",
            `${stay.roomName}: ${stay.guestName}${
                folio.balance > 0 ? ` — ${folio.balance} still owed` : ""
            }`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "sales.create",
            targetType: "roomBooking",
            targetId: stay._id,
            metadata: {
                roomName: stay.roomName,
                guestName: stay.guestName,
                charges: folio.charges,
                payments: folio.payments,
                balance: folio.balance,
            },
        });

        return {
            bookingId: stay._id,
            charges: folio.charges,
            payments: folio.payments,
            balance: folio.balance,
        };
    },
});

/**
 * Cancel a reservation that will not happen.
 */
export const cancelStay = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        bookingId: v.id("roomBookings"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.cancel");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const stay = await ctx.db.get(args.bookingId);
        if (!stay || stay.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that stay belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["frontDesk"]);
        }

        const current = stay.status as StayStatus;
        if (!STAY_TRANSITIONS[current]?.includes("cancelled")) {
            throw new ConvexError(
                `A stay that is ${current.replace("_", " ")} cannot be cancelled.`
            );
        }

        await ctx.db.patch(stay._id, {
            status: "cancelled",
            notes: args.reason ?? stay.notes,
            updatedAt: new Date().toISOString(),
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Cancel Stay",
            `${stay.roomName}: ${stay.guestName}${args.reason ? ` — ${args.reason}` : ""}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "sales.cancel",
            targetType: "roomBooking",
            targetId: stay._id,
            metadata: { roomName: stay.roomName, reason: args.reason },
        });

        return { bookingId: stay._id, status: "cancelled" as StayStatus };
    },
});

/**
 * Move a room on the housekeeping board.
 */
export const updateHousekeeping = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        outletId: v.id("serviceOutlets"),
        status: v.union(
            v.literal("clean"),
            v.literal("dirty"),
            v.literal("servicing"),
            v.literal("inspected"),
            v.literal("out_of_service")
        ),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        await assertPackageFeature(ctx, tenant.businessId, "housekeeping");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const room = await ctx.db.get(args.outletId);
        if (!room || room.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that room belongs to another business."
            );
        }

        // A room that is being sold tonight cannot be taken out of service
        // without the desk knowing: the guest is already on the way.
        if (args.status === "out_of_service") {
            const stays = await ctx.db
                .query("roomBookings")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .collect();
            const inHouse = stays.find(
                (stay) =>
                    stay.outletId === room._id &&
                    (stay.status === "in_house" || stay.status === "reserved")
            );
            if (inHouse) {
                throw new ConvexError(
                    `${room.name} still has ${inHouse.guestName} on it. Move the guest first.`
                );
            }
        }

        await ctx.db.patch(room._id, {
            housekeepingStatus: args.status,
            status:
                args.status === "out_of_service"
                    ? "maintenance"
                    : room.status === "occupied"
                      ? room.status
                      : "available",
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Housekeeping",
            `${room.name}: ${args.status.replace("_", " ")}`
        );

        return { outletId: room._id, housekeepingStatus: args.status };
    },
});

/**
 * Close the night.
 *
 * The audit is a statement about one night: how many rooms were sold, what
 * they came to, what was still owed. It is written once per night — a
 * second audit of the same night replaces the first, so the record cannot
 * disagree with itself.
 */
export const runNightAudit = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** `YYYY-MM-DD` — the night being closed. Defaults to today. */
        date: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.view");
        await assertPackageFeature(ctx, tenant.businessId, "night_audit");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const night = args.date ?? today();

        const rooms = await ctx.db
            .query("serviceOutlets")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const sellable = rooms.filter(
            (room) =>
                (room.businessType === "room" || room.businessType === "chair") &&
                room.status !== "deleted"
        );

        const stays = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const sold = stays.filter(
            (stay) =>
                stay.status !== "cancelled" &&
                stay.checkIn <= night &&
                stay.checkOut > night
        );

        let roomRevenue = 0;
        let folioRevenue = 0;
        let outstanding = 0;

        for (const stay of sold) {
            const folio = await folioBalance(ctx, stay);
            roomRevenue += stay.total;
            folioRevenue += stay.total + folio.charges;
            outstanding += folio.balance;
        }

        const now = new Date().toISOString();
        const existing = await ctx.db
            .query("nightAudits")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).eq("date", night)
            )
            .first();

        const payload = {
            businessId,
            date: night,
            roomsSold: sold.length,
            roomsAvailable: sellable.length,
            roomRevenue,
            folioRevenue,
            outstanding,
            notes: args.notes,
            createdBy: userId,
            createdAt: now,
        };

        if (existing) {
            await ctx.db.patch(existing._id, payload);
        } else {
            await ctx.db.insert("nightAudits", payload);
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Night Audit",
            `${night}: ${sold.length} room(s) sold, ${roomRevenue} in room revenue, ${outstanding} outstanding`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "finance.view",
            targetType: "nightAudit",
            targetId: existing?._id ?? night,
            metadata: {
                date: night,
                roomsSold: sold.length,
                roomRevenue,
                folioRevenue,
                outstanding,
            },
        });

        return payload;
    },
});

/**
 * The nights that have been closed.
 */
export const listNightAudits = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.view");

        const limit = Math.min(Math.max(args.limit ?? 30, 1), 200);

        const rows = await ctx.db
            .query("nightAudits")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        return rows
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, limit)
            .map((row) => ({
                _id: row._id,
                date: row.date,
                roomsSold: row.roomsSold,
                roomsAvailable: row.roomsAvailable,
                roomRevenue: row.roomRevenue,
                folioRevenue: row.folioRevenue,
                outstanding: row.outstanding,
                notes: row.notes ?? null,
                createdAt: row.createdAt,
            }));
    },
});

/**
 * The nights a room can still be sold for — used when the desk is checking
 * a booking against the calendar.
 */
export const listAvailability = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** `YYYY-MM-DD` — the first night being looked at. */
        fromDate: v.optional(v.string()),
        /** How many nights ahead to look. */
        nights: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const from = args.fromDate ?? today();
        const count = Math.min(Math.max(args.nights ?? 7, 1), 31);

        const rooms = await ctx.db
            .query("serviceOutlets")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const sellable = rooms.filter(
            (room) =>
                (room.businessType === "room" || room.businessType === "chair") &&
                room.status !== "deleted"
        );

        const stays = await ctx.db
            .query("roomBookings")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const days = [];
        for (let offset = 0; offset < count; offset += 1) {
            const date = addDays(from, offset);
            const busy = new Set(
                stays
                    .filter(
                        (stay) =>
                            stay.status !== "cancelled" &&
                            stay.status !== "checked_out" &&
                            stay.checkIn <= date &&
                            stay.checkOut > date
                    )
                    .map((stay) => stay.roomName)
            );
            days.push({
                date,
                available: sellable.length - busy.size,
                total: sellable.length,
                sold: busy.size,
            });
        }

        return days;
    },
});
