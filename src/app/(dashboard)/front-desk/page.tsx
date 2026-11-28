"use client";

/**
 * SMART_BUZ — the front desk.
 *
 * The screen the person on the desk works from: what rooms exist, who is
 * in them, who is arriving, what a guest has put on their account, and
 * what the night came to.
 *
 * Every figure here is the server's. The desk can change a stay, post a
 * charge, take a payment and close the night — but it cannot tell the
 * server what a room costs or what a guest owes, and it is not asked to.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import {
    BedDouble,
    CalendarClock,
    ConciergeBell,
    Moon,
    Plus,
    Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    CountBadge,
    DataState,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
    ConfirmDeleteDialog,
    FormDialog,
    RecordDetail,
    type FormField,
} from "@/components/vertical/ui-kit";
import { useCurrency } from "@/hooks/use-currency";
import { statusTone } from "@/lib/status-tone";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes the server sends back
 * ──────────────────────────────────────────────────────────────────────── */

interface RoomRow {
    _id: Id<"serviceOutlets">;
    name: string;
    capacity: number;
    rate: number;
    housekeepingStatus: string;
    outOfService: boolean;
    occupied: boolean;
    stayId: Id<"roomBookings"> | null;
    guestName: string | null;
    checkOut: string | null;
}

interface StayRow {
    _id: Id<"roomBookings">;
    roomName: string;
    guestName: string;
    guestPhone: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    nightlyRate: number;
    total: number;
    charges: number;
    paid: number;
    balance: number;
    status: string;
    housekeepingStatus: string | null;
    notes: string | null;
}

interface FolioEntry {
    _id: Id<"folioEntries">;
    kind: string;
    description: string;
    amount: number;
    category: string | null;
    method: string | null;
    reference: string | null;
    date: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ───────────────────────────────────────────────────────────────────────── */

export default function FrontDeskPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [statusFilter, setStatusFilter] = useState("all");
    const [reserveOpen, setReserveOpen] = useState(false);
    const [chargeStay, setChargeStay] = useState<StayRow | null>(null);
    const [paymentStay, setPaymentStay] = useState<StayRow | null>(null);
    const [cancelStay, setCancelStay] = useState<StayRow | null>(null);
    const [folioStay, setFolioStay] = useState<Id<"roomBookings"> | null>(null);
    const [housekeepingRoom, setHousekeepingRoom] = useState<RoomRow | null>(null);
    const [auditOpen, setAuditOpen] = useState(false);

    const [reserveValues, setReserveValues] = useState<Record<string, string>>({});
    const [chargeValues, setChargeValues] = useState<Record<string, string>>({});
    const [paymentValues, setPaymentValues] = useState<Record<string, string>>({});
    const [housekeepingValues, setHousekeepingValues] = useState<Record<string, string>>({});
    const [auditValues, setAuditValues] = useState<Record<string, string>>({});

    const summary = useQuery(api.packages.hospitality.getFrontDeskSummary, {});
    const rooms = useQuery(api.packages.hospitality.listRoomInventory, {});
    const stays = useQuery(
        api.packages.hospitality.listStays,
        statusFilter === "all" ? {} : { status: statusFilter }
    );
    const folio = useQuery(
        api.packages.hospitality.listFolioEntries,
        folioStay ? { bookingId: folioStay } : "skip"
    );
    const audits = useQuery(api.packages.hospitality.listNightAudits, {});

    const createReservation = useMutation(api.packages.hospitality.createReservation);
    const checkInStay = useMutation(api.packages.hospitality.checkInStay);
    const checkOutStay = useMutation(api.packages.hospitality.checkOutStay);
    const postGuestCharge = useMutation(api.packages.hospitality.postGuestCharge);
    const recordStayPayment = useMutation(api.packages.hospitality.recordStayPayment);
    const cancelStayMutation = useMutation(api.packages.hospitality.cancelStay);
    const updateHousekeeping = useMutation(api.packages.hospitality.updateHousekeeping);
    const runNightAudit = useMutation(api.packages.hospitality.runNightAudit);

    const roomRows = useMemo(() => rooms ?? [], [rooms]);
    const stayRows = useMemo(() => stays ?? [], [stays]);

    const money = (value: number) => `${currency} ${value.toLocaleString()}`;

    /* ── The board ──────────────────────────────────────────────────── */

    const roomColumns: DataTableColumn<RoomRow>[] = [
        {
            id: "room",
            header: "Room",
            accessor: (row) => row.name,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {t("Sleeps")} {row.capacity}
                    </p>
                </div>
            ),
        },
        {
            id: "state",
            header: "State",
            accessor: (row) => (row.occupied ? "occupied" : "free"),
            cell: (row) => (
                <Badgeish
                    tone={row.occupied ? "info" : row.outOfService ? "danger" : "success"}
                    label={
                        row.outOfService
                            ? "Out of service"
                            : row.occupied
                              ? "Occupied"
                              : "Free"
                    }
                />
            ),
        },
        {
            id: "housekeeping",
            header: "Housekeeping",
            accessor: (row) => row.housekeepingStatus,
            cell: (row) => (
                <span className="text-sm capitalize text-muted-foreground">
                    {row.housekeepingStatus.replace(/_/g, " ")}
                </span>
            ),
            hideBelow: "md",
        },
        {
            id: "guest",
            header: "Guest",
            accessor: (row) => row.guestName ?? "",
            cell: (row) =>
                row.guestName ? (
                    <div className="min-w-0">
                        <p className="truncate">{row.guestName}</p>
                        {row.checkOut ? (
                            <p className="text-xs text-muted-foreground">
                                {t("Out")} {row.checkOut}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
            hideBelow: "lg",
        },
        {
            id: "rate",
            header: "Rate",
            accessor: (row) => row.rate,
            align: "right",
            cell: (row) => <span className="tabular-nums">{money(row.rate)}</span>,
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setHousekeepingRoom(row);
                        setHousekeepingValues({
                            housekeepingStatus: row.housekeepingStatus,
                        });
                    }}
                >
                    {t("Housekeeping")}
                </Button>
            ),
        },
    ];

    const stayColumns: DataTableColumn<StayRow>[] = [
        {
            id: "guest",
            header: "Guest",
            accessor: (row) => row.guestName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {row.roomName}
                        {row.guestPhone ? ` · ${row.guestPhone}` : ""}
                    </p>
                </div>
            ),
        },
        {
            id: "dates",
            header: "Dates",
            accessor: (row) => row.checkIn,
            cell: (row) => (
                <div className="min-w-0 text-sm">
                    <p className="tabular-nums">
                        {row.checkIn} → {row.checkOut}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {row.nights} night{row.nights === 1 ? "" : "s"}
                    </p>
                </div>
            ),
            hideBelow: "md",
        },
        {
            id: "total",
            header: "Room",
            accessor: (row) => row.total,
            align: "right",
            cell: (row) => (
                <span className="tabular-nums">{money(row.total)}</span>
            ),
        },
        {
            id: "charges",
            header: "Charges",
            accessor: (row) => row.charges,
            align: "right",
            hideBelow: "lg",
            cell: (row) => (
                <span className="tabular-nums">{money(row.charges)}</span>
            ),
        },
        {
            id: "balance",
            header: "Balance",
            accessor: (row) => row.balance,
            align: "right",
            cell: (row) => (
                <span
                    className={
                        row.balance > 0
                            ? "font-semibold tabular-nums text-destructive"
                            : "tabular-nums text-muted-foreground"
                    }
                >
                    {money(row.balance)}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <Badgeish
                    tone={statusTone(row.status)}
                    label={row.status.replace("_", " ")}
                />
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row) => (
                <div className="flex items-center justify-end gap-1">
                    {row.status === "reserved" ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await checkInStay({ bookingId: row._id });
                                    toast.success(`${row.guestName} is checked in.`);
                                } catch (err) {
                                    toast.error(
                                        err instanceof Error
                                            ? err.message
                                            : "Could not check the guest in."
                                    );
                                }
                            }}
                        >
                            {t("Check in")}
                        </Button>
                    ) : null}
                    {row.status === "in_house" ? (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setChargeStay(row);
                                    setChargeValues({
                                        category: "minibar",
                                        amount: "",
                                        description: "",
                                    });
                                }}
                            >
                                {t("Charge")}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                    try {
                                        const outcome = await checkOutStay({
                                            bookingId: row._id,
                                        });
                                        toast.success(
                                            outcome.balance > 0
                                                ? `Checked out — ${money(outcome.balance)} is still owed.`
                                                : "Checked out — the folio is settled."
                                        );
                                    } catch (err) {
                                        toast.error(
                                            err instanceof Error
                                                ? err.message
                                                : "Could not check the guest out."
                                        );
                                    }
                                }}
                            >
                                {t("Check out")}
                            </Button>
                        </>
                    ) : null}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setFolioStay(row._id);
                            setPaymentStay(row);
                            setPaymentValues({ amount: "", method: "cash" });
                        }}
                    >
                        {t("Folio")}
                    </Button>
                </div>
            ),
        },
    ];

    /* ── The forms ──────────────────────────────────────────────────── */

    const reserveFields: FormField[] = [
        {
            name: "outletId",
            label: "Room",
            type: "select",
            required: true,
            options: roomRows
                .filter((room) => !room.outOfService)
                .map((room) => ({
                    value: room._id,
                    label: room.name,
                })),
            hint: "Only the rooms that can be sold tonight.",
        },
        {
            name: "guestName",
            label: "Guest",
            type: "text",
            required: true,
            placeholder: "Who is taking the room",
        },
        {
            name: "guestPhone",
            label: "Phone",
            type: "tel",
            placeholder: "For the desk to reach them",
        },
        {
            name: "checkIn",
            label: "Arriving",
            type: "date",
            required: true,
        },
        {
            name: "checkOut",
            label: "Leaving",
            type: "date",
            required: true,
        },
        {
            name: "nightlyRate",
            label: "Rate per night",
            type: "number",
            min: 0,
            step: 0.01,
            hint: "Leave empty to take the room's own rate.",
        },
        {
            name: "notes",
            label: "Notes",
            type: "textarea",
            full: true,
            placeholder: "Arriving late, quiet room, and so on",
        },
    ];

    const chargeFields: FormField[] = [
        {
            name: "description",
            label: "What for",
            type: "text",
            required: true,
            placeholder: "Two bottles of water",
        },
        {
            name: "amount",
            label: "Amount",
            type: "number",
            required: true,
            min: 0,
            step: 0.01,
        },
        {
            name: "category",
            label: "Kind of charge",
            type: "select",
            defaultValue: "minibar",
            options: [
                { value: "minibar", label: "Minibar" },
                { value: "laundry", label: "Laundry" },
                { value: "room_service", label: "Room service" },
                { value: "damage", label: "Damage" },
                { value: "other", label: "Other" },
            ],
        },
    ];

    const paymentFields: FormField[] = [
        {
            name: "amount",
            label: "Amount",
            type: "number",
            required: true,
            min: 0,
            step: 0.01,
        },
        {
            name: "method",
            label: "How it was paid",
            type: "select",
            defaultValue: "cash",
            options: [
                { value: "cash", label: "Cash" },
                { value: "mobile_money", label: "Mobile money" },
                { value: "card", label: "Card" },
                { value: "bank", label: "Bank transfer" },
            ],
        },
        {
            name: "reference",
            label: "Reference",
            type: "text",
            placeholder: "The receipt or transaction reference",
        },
    ];

    const housekeepingFields: FormField[] = [
        {
            name: "housekeepingStatus",
            label: "Housekeeping",
            type: "select",
            required: true,
            options: [
                { value: "clean", label: "Clean" },
                { value: "dirty", label: "Dirty" },
                { value: "servicing", label: "Being serviced" },
                { value: "inspected", label: "Inspected" },
                { value: "out_of_service", label: "Out of service" },
            ],
        },
    ];

    const auditFields: FormField[] = [
        {
            name: "notes",
            label: "Note for the night",
            type: "textarea",
            full: true,
            placeholder: "Anything the morning shift should know",
        },
    ];

    /* ── The page ───────────────────────────────────────────────────── */

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Hospitality"
                title={t("Front Desk")}
                description={t("The rooms, the guests in them, the accounts they have open, and the night being closed.")}
                icon={ConciergeBell}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" onClick={() => setAuditOpen(true)}>
                            <Moon className="mr-2 size-4" />
                            {t("Close the night")}
                        </Button>
                        <Button onClick={() => setReserveOpen(true)}>
                            <Plus className="mr-2 size-4" />
                            {t("New reservation")}
                        </Button>
                    </div>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Occupancy")}
                    value={
                        summary
                            ? `${summary.occupancyRate}%`
                            : "—"
                    }
                    hint={
                        summary
                            ? `${summary.roomsOccupied} of ${summary.roomsTotal} rooms`
                            : undefined
                    }
                    icon={BedDouble}
                    tone={
                        summary && summary.occupancyRate >= 90
                            ? "success"
                            : "default"
                    }
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("In house")}
                    value={summary ? summary.inHouse : "—"}
                    hint={
                        summary
                            ? `${summary.arrivals} arriving, ${summary.departures} leaving`
                            : undefined
                    }
                    icon={Sparkles}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Room revenue")}
                    value={summary ? money(summary.roomRevenue) : "—"}
                    hint={t("What the occupied rooms came to")}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Still owed")}
                    value={summary ? money(summary.outstanding) : "—"}
                    hint={t("Open folios right now")}
                    tone={summary && summary.outstanding > 0 ? "warning" : "default"}
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Rooms")}
                description={t("What each room is doing right now.")}
                icon={BedDouble}
                actions={
                    <CountBadge>{roomRows.length} rooms</CountBadge>
                }
                bodyClassName="p-0"
            >
                <DataTable
                    data={roomRows}
                    columns={roomColumns}
                    getRowId={(row) => row._id}
                    isLoading={rooms === undefined}
                    isEmpty={roomRows.length === 0}
                    emptyTitle={t("No rooms set up yet")}
                    emptyHint={t("Add rooms to the business and they appear here with their rate and their housekeeping state.")}
                    caption={t("Rooms")}
                />
            </SectionCard>

            <SectionCard
                title={t("Stays")}
                description={t("The reservations and the guests who are in the house.")}
                icon={CalendarClock}
                actions={
                    <div className="flex items-center gap-2">
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                            aria-label={t("Filter by status")}
                        >
                            <option value="all">{t("All stays")}</option>
                            <option value="reserved">{t("Reserved")}</option>
                            <option value="in_house">{t("In house")}</option>
                            <option value="checked_out">{t("Checked out")}</option>
                            <option value="cancelled">{t("Cancelled")}</option>
                        </select>
                        <CountBadge>{stayRows.length} stays</CountBadge>
                    </div>
                }
                bodyClassName="p-0"
            >
                <DataTable
                    data={stayRows}
                    columns={stayColumns}
                    getRowId={(row) => row._id}
                    isLoading={stays === undefined}
                    isEmpty={stayRows.length === 0}
                    emptyTitle={t("No stays yet")}
                    emptyHint={t("A reservation made here appears in this list, and so does every guest who walks in.")}
                    caption={t("Stays")}
                />
            </SectionCard>

            <SectionCard
                title={t("Nights closed")}
                description={t("The record of the nights that have been audited.")}
                icon={Moon}
                bodyClassName="p-0"
            >
                <DataTable
                    data={audits ?? []}
                    columns={[
                        {
                            id: "date",
                            header: "Night",
                            accessor: (row: any) => row.date,
                        },
                        {
                            id: "sold",
                            header: "Rooms sold",
                            accessor: (row: any) => row.roomsSold,
                            align: "right",
                        },
                        {
                            id: "roomRevenue",
                            header: "Room revenue",
                            accessor: (row: any) => row.roomRevenue,
                            align: "right",
                            cell: (row: any) => (
                                <span className="tabular-nums">
                                    {money(row.roomRevenue)}
                                </span>
                            ),
                        },
                        {
                            id: "outstanding",
                            header: "Still owed",
                            accessor: (row: any) => row.outstanding,
                            align: "right",
                            cell: (row: any) => (
                                <span className="tabular-nums">
                                    {money(row.outstanding)}
                                </span>
                            ),
                        },
                    ]}
                    getRowId={(row: any) => row._id}
                    isLoading={audits === undefined}
                    isEmpty={(audits ?? []).length === 0}
                    emptyTitle={t("No night has been closed yet")}
                    emptyHint={t("Closing the night writes down how many rooms were sold, what they came to and what was still owed.")}
                    caption={t("Night audits")}
                />
            </SectionCard>

            {/* ── Dialogs ─────────────────────────────────────────────── */}

            <FormDialog
                open={reserveOpen}
                onOpenChange={(open) => {
                    setReserveOpen(open);
                    if (!open) setReserveValues({});
                }}
                title={t("New reservation")}
                description={t("The nights are counted and the total worked out by the server.")}
                fields={reserveFields}
                initialValues={reserveValues}
                onSubmit={async (values) => {
                    try {
                        const outcome = await createReservation({
                            outletId: values.outletId as Id<"serviceOutlets">,
                            guestName: values.guestName,
                            guestPhone: values.guestPhone || undefined,
                            checkIn: values.checkIn,
                            checkOut: values.checkOut,
                            nightlyRate: values.nightlyRate
                                ? Number(values.nightlyRate)
                                : undefined,
                            notes: values.notes || undefined,
                        });
                        toast.success(
                            `Reserved — ${outcome.nights} night(s), ${money(outcome.total)}.`
                        );
                        setReserveOpen(false);
                        setReserveValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not take the reservation."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={chargeStay !== null}
                onOpenChange={(open) => {
                    if (!open) setChargeStay(null);
                }}
                title={t("Post a charge")}
                description={
                    chargeStay
                        ? `On the account of ${chargeStay.guestName} in ${chargeStay.roomName}.`
                        : undefined
                }
                fields={chargeFields}
                initialValues={chargeValues}
                onSubmit={async (values) => {
                    if (!chargeStay) return;
                    try {
                        const outcome = await postGuestCharge({
                            bookingId: chargeStay._id,
                            description: values.description,
                            amount: Number(values.amount),
                            category: values.category || undefined,
                        });
                        toast.success(
                            `Charged — the account now stands at ${money(outcome.balance)}.`
                        );
                        setChargeStay(null);
                        setChargeValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not post the charge."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={paymentStay !== null}
                onOpenChange={(open) => {
                    if (!open) setPaymentStay(null);
                }}
                title={t("Take a payment")}
                description={
                    paymentStay
                        ? `Against the account of ${paymentStay.guestName}.`
                        : undefined
                }
                fields={paymentFields}
                initialValues={paymentValues}
                onSubmit={async (values) => {
                    if (!paymentStay) return;
                    try {
                        const outcome = await recordStayPayment({
                            bookingId: paymentStay._id,
                            amount: Number(values.amount),
                            method: values.method || undefined,
                            reference: values.reference || undefined,
                        });
                        toast.success(
                            `Taken — ${money(outcome.balance)} still owed.`
                        );
                        setPaymentStay(null);
                        setPaymentValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not take the payment."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={housekeepingRoom !== null}
                onOpenChange={(open) => {
                    if (!open) setHousekeepingRoom(null);
                }}
                title={t("Housekeeping")}
                description={
                    housekeepingRoom
                        ? `Where ${housekeepingRoom.name} stands on the board.`
                        : undefined
                }
                fields={housekeepingFields}
                initialValues={housekeepingValues}
                onSubmit={async (values) => {
                    if (!housekeepingRoom) return;
                    try {
                        await updateHousekeeping({
                            outletId: housekeepingRoom._id,
                            status: values.housekeepingStatus as
                                | "clean"
                                | "dirty"
                                | "servicing"
                                | "inspected"
                                | "out_of_service",
                        });
                        toast.success(`${housekeepingRoom.name} updated.`);
                        setHousekeepingRoom(null);
                        setHousekeepingValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not update the room."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={auditOpen}
                onOpenChange={(open) => {
                    setAuditOpen(open);
                    if (!open) setAuditValues({});
                }}
                title={t("Close the night")}
                description={t("Writes down the rooms sold, what they came to, and what was still owed.")}
                fields={auditFields}
                initialValues={auditValues}
                submitLabel="Close the night"
                onSubmit={async (values) => {
                    try {
                        const outcome = await runNightAudit({
                            notes: values.notes || undefined,
                        });
                        toast.success(
                            `Night closed — ${outcome.roomsSold} room(s) sold, ${money(outcome.roomRevenue)}.`
                        );
                        setAuditOpen(false);
                        setAuditValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not close the night."
                        );
                        throw err;
                    }
                }}
            />

            <ConfirmDeleteDialog
                open={cancelStay !== null}
                onOpenChange={(open) => {
                    if (!open) setCancelStay(null);
                }}
                entityName="reservation"
                description={
                    cancelStay
                        ? `Cancel the reservation for ${cancelStay.guestName} in ${cancelStay.roomName}?`
                        : undefined
                }
                onConfirm={async () => {
                    if (!cancelStay) return;
                    try {
                        await cancelStayMutation({ bookingId: cancelStay._id });
                        toast.success("The reservation was cancelled.");
                        setCancelStay(null);
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not cancel the reservation."
                        );
                        throw err;
                    }
                }}
            />

            <RecordDetail
                open={folioStay !== null}
                onOpenChange={(open) => {
                    if (!open) setFolioStay(null);
                }}
                title={t("Guest folio")}
                description={t("Everything on this guest's account.")}
                rows={[
                    {
                        label: "Room",
                        value: money(folio?.roomTotal ?? 0),
                    },
                    {
                        label: "Charges",
                        value: money(folio?.charges ?? 0),
                    },
                    {
                        label: "Paid",
                        value: money(folio?.payments ?? 0),
                    },
                    {
                        label: "Balance",
                        value: money(folio?.balance ?? 0),
                    },
                ]}
                footer={
                    folio && folio.entries.length > 0 ? (
                        <div className="mt-4 space-y-2">
                            <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                {t("Entries")}
                            </p>
                            {folio.entries.map((entry: FolioEntry) => (
                                <div
                                    key={entry._id}
                                    className="flex items-center justify-between gap-3 text-sm"
                                >
                                    <span className="min-w-0 truncate">
                                        {t(entry.description)}
                                        <span className="ml-2 text-xs text-muted-foreground">
                                            {entry.date}
                                        </span>
                                    </span>
                                    <span className="shrink-0 tabular-nums">
                                        {entry.kind === "payment" ? "−" : "+"}
                                        {money(entry.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null
                }
            />
        </PageContainer>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * A small badge that follows the shared tone vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

function Badgeish({
    tone,
    label,
}: {
    tone: "success" | "warning" | "danger" | "info" | "neutral";
    label: string;
}) {
    
    const t = useT();const classes: Record<string, string> = {
        success:
            "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
        warning:
            "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
        danger: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
        info: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
        neutral: "bg-muted text-muted-foreground",
    };

    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${classes[tone]}`}
        >
            {label}
        </span>
    );
}
