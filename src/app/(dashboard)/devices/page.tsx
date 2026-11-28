"use client";

/**
 * SMARTBUZ — devices.
 *
 * The hardware register: the printers, scanners, drawers and scales this
 * business has at its counters, what state each one is in, and when it was
 * last seen.
 *
 * The synchronisation log used to be the whole of this page, which meant a
 * page called "Devices" showed nothing about the devices. It is still real
 * information — it is just the second half of the story, so it lives in its
 * own section underneath.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { formatError } from "@/lib/utils";
import {
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    Toolbar,
    ToolbarGroup,
    CountBadge,
    ActionButton,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
    FormDialog,
    SearchBox,
    StatusBadge,
    type FormField,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import {
    AlertTriangle,
    MonitorSmartphone,
    Plus,
    ScrollText,
    Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/provider";

type Device = {
    id: Id<"hardwareDevices">;
    hardwareKey: string;
    kind: string;
    name: string;
    shopId?: Id<"shops">;
    branchId?: Id<"branches">;
    deviceId?: string;
    status: string;
    statusNote?: string;
    lastSeenAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

const STATUSES = [
    { value: "configured", label: "Configured" },
    { value: "testing", label: "Being tested" },
    { value: "verified", label: "Verified working" },
    { value: "not_working", label: "Not working" },
    { value: "retired", label: "Retired" },
];

/** When the device last spoke to the server. */
function ago(iso?: string): string {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return "never";
    if (ms < 60_000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DevicesPage() {
    
    const t = useT();const { can } = useAuth();

    // Reading the register is an integrations permission; changing a device
    // is a hardware permission.
    const canView = can("integrations.view");
    const canManage = can("hardware.manage");
    // The synchronisation record is a sales record — the server asks for the
    // sales permission before it will show a line of it.
    const canSeeSync = can("sales.view");

    const [search, setSearch] = useState("");
    const [registerOpen, setRegisterOpen] = useState(false);
    const [statusFor, setStatusFor] = useState<Device | null>(null);

    const devices = useQuery(
        api.integrations.hardware.listHardware,
        canView ? {} : "skip"
    );
    const catalogue = useQuery(
        api.integrations.hardware.listHardwareWithCatalogue,
        canView ? {} : "skip"
    );
    const branches = useQuery(api.branches.list, canView ? {} : "skip");
    const shops = useQuery(api.shops.listAll, canView ? {} : "skip");

    const logs = useQuery(
        api.sync.listSyncLogs,
        canView && canSeeSync ? { limit: 50 } : "skip"
    );
    const conflicts = useQuery(
        api.sync.listConflicts,
        canView && canSeeSync ? {} : "skip"
    );

    const saveHardware = useMutation(api.integrations.hardware.saveHardware);
    const setHardwareStatus = useMutation(
        api.integrations.hardware.setHardwareStatus
    );

    const rows = useMemo(() => {
        const all = (devices ?? []) as Device[];
        const needle = search.trim().toLowerCase();
        if (!needle) return all;
        return all.filter(
            (d) =>
                d.name.toLowerCase().includes(needle) ||
                d.kind.toLowerCase().includes(needle) ||
                (d.deviceId ?? "").toLowerCase().includes(needle)
        );
    }, [devices, search]);

    const stats = useMemo(() => {
        const all = (devices ?? []) as Device[];
        return {
            total: all.length,
            verified: all.filter((d) => d.status === "verified").length,
            problems: all.filter(
                (d) => d.status === "not_working" || d.status === "retired"
            ).length,
            neverSeen: all.filter((d) => !d.lastSeenAt).length,
        };
    }, [devices]);

    const branchName = (id?: string): string => {
        const branch = (branches ?? []).find((b: any) => b._id === id);
        return branch?.name ?? "—";
    };
    const shopName = (id?: string): string => {
        const shop = (shops ?? []).find((s: any) => s._id === id);
        return shop?.name ?? "—";
    };

    const registerFields: FormField[] = useMemo(
        () => [
            {
                name: "hardwareKey",
                label: "What kind of device",
                type: "select",
                required: true,
                options: (catalogue ?? []).map((entry: any) => ({
                    value: entry.key,
                    label: `${entry.label} (${entry.kind.replace(/_/g, " ")})`,
                })),
            },
            { name: "name", label: "Name", type: "text", required: true },
            {
                name: "deviceId",
                label: "Serial or till identifier",
                type: "text",
                hint: "What the till calls itself, if it has an identifier.",
            },
            {
                name: "branchId",
                label: "Branch",
                type: "select",
                options: [
                    { value: "", label: "No branch" },
                    ...(branches ?? []).map((b: any) => ({
                        value: b._id as string,
                        label: b.name as string,
                    })),
                ],
            },
            {
                name: "shopId",
                label: "Counter",
                type: "select",
                options: [
                    { value: "", label: "No counter" },
                    ...(shops ?? []).map((s: any) => ({
                        value: s._id as string,
                        label: s.name as string,
                    })),
                ],
            },
        ],
        [catalogue, branches, shops]
    );

    const statusFields: FormField[] = [
        {
            name: "status",
            label: "State",
            type: "select",
            required: true,
            options: STATUSES,
        },
        {
            name: "note",
            label: "Why",
            type: "textarea",
            full: true,
            placeholder: "What was done, or what is wrong with it",
        },
    ];

    const columns: DataTableColumn<Device>[] = [
        {
            id: "name",
            header: "Device",
            accessor: (d) => d.name,
            cell: (d) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{d.name}</p>
                    {d.deviceId ? (
                        <p className="truncate text-xs text-muted-foreground">
                            {d.deviceId}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "kind",
            header: "Type",
            accessor: (d) => d.kind,
            cell: (d) => (
                <span className="capitalize">
                    {d.kind.replace(/_/g, " ")}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (d) => d.status,
            width: "10rem",
            cell: (d) => (
                <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={d.status} />
                    {d.statusNote ? (
                        <span className="text-xs text-muted-foreground">
                            {d.statusNote}
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            id: "lastSeen",
            header: "Last seen",
            accessor: (d) => d.lastSeenAt ?? "",
            cell: (d) => <span className="text-muted-foreground">{ago(d.lastSeenAt)}</span>,
        },
        {
            id: "where",
            header: "Where",
            accessor: (d) => branchName(d.branchId),
            hideBelow: "md",
            cell: (d) => (
                <span className="text-muted-foreground">
                    {branchName(d.branchId)}
                    {d.shopId ? ` · ${shopName(d.shopId)}` : ""}
                </span>
            ),
        },
        ...(canManage
            ? [
                  {
                      id: "actions",
                      header: "",
                      width: "9rem",
                      cell: (d: Device) => (
                          <div className="flex justify-end">
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setStatusFor(d)}
                              >
                                  <Wrench className="mr-1.5 size-3.5" />
                                  {t("Change state")}
                              </Button>
                          </div>
                      ),
                  } as DataTableColumn<Device>,
              ]
            : []),
    ];

    const handleRegister = async (values: Record<string, string>) => {
        try {
            await saveHardware({
                hardwareKey: values.hardwareKey,
                name: values.name.trim(),
                deviceId: values.deviceId?.trim() || undefined,
                branchId: (values.branchId || undefined) as Id<"branches"> | undefined,
                shopId: (values.shopId || undefined) as Id<"shops"> | undefined,
            });
            toast.success("Device registered.");
            setRegisterOpen(false);
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    const handleStatus = async (values: Record<string, string>) => {
        if (!statusFor) return;
        try {
            await setHardwareStatus({
                id: statusFor.id,
                status: values.status,
                note: values.note?.trim() || undefined,
            });
            toast.success(`${statusFor.name} is now ${values.status.replace(/_/g, " ")}.`);
            setStatusFor(null);
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    if (!canView) {
        return (
            <div className="space-y-6">
                <PageHeader
                    icon={MonitorSmartphone}
                    title={t("Devices")}
                    description={t("The printers, scanners, drawers and scales at your counters.")}
                />
                <SectionCard>
                    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
                        <p className="text-sm font-semibold text-foreground">
                            {t("You do not have access to the device register")}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t("Ask the owner or an administrator for the &quot;view integrations&quot; permission.")}
                        </p>
                    </div>
                </SectionCard>
            </div>
        );
    }

    const pendingConflicts = (conflicts ?? []).filter(
        (c: any) => c.status === "pending"
    );

    return (
        <div className="space-y-6">
            <PageHeader
                icon={MonitorSmartphone}
                title={t("Devices")}
                description={t("The hardware at your counters, and what state it is in.")}
                actions={
                    canManage ? (
                        <ActionButton onClick={() => setRegisterOpen(true)}>
                            <Plus className="mr-2 size-4" />
                            {t("Register a device")}
                        </ActionButton>
                    ) : undefined
                }
                toolbar={
                    <Toolbar>
                        <ToolbarGroup>
                            <SearchBox
                                value={search}
                                onChange={setSearch}
                                placeholder={t("Search by name, type or identifier…")}
                            />
                            <CountBadge>{rows.length}</CountBadge>
                        </ToolbarGroup>
                    </Toolbar>
                }
            />

            <StatGrid columns={4}>
                <StatCard label={t("Registered")} value={stats.total} />
                <StatCard
                    label={t("Verified working")}
                    value={stats.verified}
                    tone="success"
                />
                <StatCard
                    label={t("Not working or retired")}
                    value={stats.problems}
                    tone={stats.problems ? "danger" : "default"}
                />
                <StatCard
                    label={t("Never seen")}
                    value={stats.neverSeen}
                    tone={stats.neverSeen ? "warning" : "default"}
                    hint={t("Registered, but the till has never reported in.")}
                />
            </StatGrid>

            {/* ───────────────────── the register ───────────────────── */}
            <SectionCard
                title={t("Device register")}
                description={t("Every piece of hardware this business has registered.")}
            >
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row.id}
                    isLoading={devices === undefined}
                    isEmpty={rows.length === 0}
                    emptyTitle={t("No devices registered")}
                    emptyHint={
                        canManage
                            ? "Register the printer, the scanner, the cash drawer or the scale so the office can see what is at each counter."
                            : "Nothing has been registered yet."
                    }
                    emptyAction={
                        canManage ? (
                            <Button onClick={() => setRegisterOpen(true)}>
                                <Plus className="mr-2 size-4" />
                                {t("Register a device")}
                            </Button>
                        ) : undefined
                    }
                />
            </SectionCard>

            {/* ───────────────────── synchronisation ───────────────────── */}
            <SectionCard
                title={t("Synchronisation log")}
                description={t("What the tills have sent to the server, and what the server did with it.")}
            >
                {!canSeeSync ? (
                    <p className="text-sm text-muted-foreground">
                        {t("You do not have access to the synchronisation record.")}
                    </p>
                ) : !logs ? (
                    <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
                ) : logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {t("Nothing has arrived from the tills yet.")}
                    </p>
                ) : (
                    <ul className="space-y-1">
                        {logs.map((log: any) => (
                            <li
                                key={log._id}
                                className="flex items-center justify-between gap-3 border-b py-2 text-xs last:border-0"
                            >
                                <div className="min-w-0">
                                    <p className="truncate font-medium">
                                        {log.transactionId ?? "—"}
                                    </p>
                                    <p className="truncate text-muted-foreground">
                                        {log.deviceId ?? "unknown till"}
                                        {log.invoiceNumber
                                            ? ` • ${log.invoiceNumber}`
                                            : ""}
                                        {log.reason ? ` • ${log.reason}` : ""}
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <StatusBadge status={log.status} />
                                    <span className="text-muted-foreground">
                                        {ago(log.createdAt)}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                {pendingConflicts.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
                        <p className="flex items-center gap-2 text-sm font-medium">
                            <AlertTriangle className="size-4 text-warning" />
                            {pendingConflicts.length} stock conflict
                            {pendingConflicts.length === 1 ? "" : "s"} waiting
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {pendingConflicts.map((conflict: any) => (
                                <li key={conflict._id}>
                                    {conflict.stockName ?? "A product"} {t("— the till thought")} {conflict.expectedQty ?? "?"} {t("were on hand, the server says")} {conflict.availableQty}.
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </SectionCard>

            <FormDialog
                open={registerOpen}
                onOpenChange={setRegisterOpen}
                title={t("Register a device")}
                description={t("A newly registered device has never been seen working — a person has to confirm it before it counts as verified.")}
                fields={registerFields}
                submitLabel="Register it"
                onSubmit={handleRegister}
            />

            <FormDialog
                open={statusFor !== null}
                onOpenChange={(open) => {
                    if (!open) setStatusFor(null);
                }}
                title={t("Change the state of this device")}
                description={statusFor?.name}
                fields={statusFields}
                submitLabel="Save"
                onSubmit={handleStatus}
            />

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ScrollText className="size-3.5" />
                {t("The synchronisation log above is what the tills have sent. It is not the device register.")}
            </p>
        </div>
    );
}
