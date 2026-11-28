"use client";

/**
 * SMART_BUZ — Service Jobs (Repair, laundry, cleaning, alterations)
 *
 * A job-ticket board for the trades that sell work rather than goods.
 *
 * A job can be opened, amended, inspected and removed from here.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatusBadge,
    SearchBox,
    LoadingState,
    EmptyState,
    FormDialog,
    EditFormDialog,
    ConfirmDeleteDialog,
    RecordDetail,
    RecordActions,
    CreateButton,
    ugx,
    shortDate,
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scissors } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const JOB_STATUSES = [
    { value: "all", label: "All" },
    { value: "received", label: "Received" },
    { value: "in_progress", label: "In progress" },
    { value: "ready", label: "Ready" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];

const JOB_STATUS_OPTIONS = JOB_STATUSES.filter((s) => s.value !== "all").map((s) => ({
    value: s.value,
    label: s.label,
}));

const PRIORITY_OPTIONS = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
];

export default function ServiceTicketsPage() {
    
    const tr = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const tickets = useQuery(api.verticals.operations.listServiceTickets, {
        status: status === "all" ? undefined : status,
        limit: 200,
    });

    const createTicket = useMutation(api.verticals.operations.createServiceTicket);
    const updateTicket = useMutation(api.verticals.operations.updateServiceTicket);
    const deleteTicket = useMutation(api.verticals.operations.deleteServiceTicket);

    const createFields: FormField[] = [
        { name: "customerName", label: "Customer name", required: true },
        {
            name: "customerPhone",
            label: "Phone",
            type: "tel",
            placeholder: "0772 123 456",
        },
        { name: "serviceType", label: "Service type", required: true, full: true },
        { name: "description", label: "Job description", type: "textarea", full: true },
        {
            name: "estimatedCost",
            label: `Estimated cost (${currency})`,
            type: "number",
            min: 0,
        },
        {
            name: "priority",
            label: "Priority",
            type: "select",
            options: PRIORITY_OPTIONS,
        },
        { name: "dueDate", label: "Due date", type: "date" },
    ];

    const editFields: FormField[] = [
        ...createFields,
        {
            name: "finalCost",
            label: `Final cost (${currency})`,
            type: "number",
            min: 0,
        },
        {
            name: "assignedToName",
            label: "Assigned to",
            placeholder: "Who is doing the job",
        },
        { name: "status", label: "Status", type: "select", options: JOB_STATUS_OPTIONS },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createTicket({
            customerName: values.customerName,
            customerPhone: values.customerPhone || undefined,
            serviceType: values.serviceType,
            description: values.description || undefined,
            estimatedCost: values.estimatedCost
                ? Number(values.estimatedCost)
                : undefined,
            priority: values.priority || "normal",
            dueDate: values.dueDate || undefined,
            userId: user._id,
        });
        toast.success("Job ticket created");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateTicket({
                id: editRow._id,
                customerName: values.customerName,
                customerPhone: values.customerPhone || undefined,
                serviceType: values.serviceType,
                description: values.description || undefined,
                estimatedCost: values.estimatedCost
                    ? Number(values.estimatedCost)
                    : undefined,
                finalCost: values.finalCost ? Number(values.finalCost) : undefined,
                assignedToName: values.assignedToName || undefined,
                priority: values.priority || undefined,
                dueDate: values.dueDate || undefined,
                status: values.status || undefined,
            });
            toast.success("Job updated");
        } catch (err) {
            reportError(err, "Could not update the job.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteTicket({ id: deleteRow._id, userId: user._id });
            toast.success("Job ticket deleted");
        } catch (err) {
            reportError(err, "Could not delete the job.");
            throw err;
        }
    };

    const advance = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateTicket({ id: id as any, status: next });
            toast.success(`Job marked ${next.replace("_", " ")}`);
        } catch (err: any) {
            toast.error(err?.message ?? "Could not update the job.");
        }
    };

    const nextStatus: Record<string, string | null> = {
        received: "in_progress",
        in_progress: "ready",
        ready: "delivered",
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "ticket",
            header: "Ticket",
            accessor: (t: any) => t.ticketNumber ?? "",
            cell: (t: any) => (
                <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-muted-foreground">
                        {t.ticketNumber}
                    </p>
                    <p className="truncate font-medium text-foreground">{t.customerName}</p>
                </div>
            ),
        },
        {
            id: "service",
            header: "Service",
            accessor: (t: any) => t.serviceType ?? "",
            cell: (t: any) => (
                <div className="min-w-0">
                    <p className="truncate">{t.serviceType}</p>
                    {t.customerPhone ? (
                        <p className="text-xs text-muted-foreground">{t.customerPhone}</p>
                    ) : null}
                </div>
            ),
            hideBelow: "sm",
        },
        {
            id: "priority",
            header: "Priority",
            accessor: (t: any) => t.priority ?? "",
            cell: (t: any) =>
                t.priority === "high" ? (
                    <Badge variant="destructive">{tr("High priority")}</Badge>
                ) : (
                    <span className="text-muted-foreground capitalize">
                        {t.priority ?? "normal"}
                    </span>
                ),
        },
        {
            id: "cost",
            header: "Cost",
            accessor: (t: any) => t.finalCost ?? t.estimatedCost ?? 0,
            align: "right",
            cell: (t: any) => (
                <div className="space-y-0.5">
                    <p className="tabular-nums">{ugx(t.finalCost ?? t.estimatedCost ?? 0)}</p>
                    <p className="text-eyebrow text-muted-foreground">
                        {t.finalCost ? "final" : "estimate"}
                    </p>
                </div>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (t: any) => t.status ?? "",
            cell: (t: any) => (
                <div className="space-y-1">
                    <StatusBadge status={t.status ?? "received"} />
                    <p className="text-xs text-muted-foreground">
                        {tr("Received")} {shortDate(t.receivedDate)}
                        {t.dueDate ? ` · due ${shortDate(t.dueDate)}` : ""}
                    </p>
                </div>
            ),
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "13rem",
            cell: (t: any) => (
                <div className="flex items-center justify-end gap-1">
                    {nextStatus[t.status] ? (
                        <Button
                            size="sm"
                            onClick={() =>
                                advance(t._id, nextStatus[t.status]!)
                            }
                        >
                            {nextStatus[t.status]!.replace("_", " ")}
                        </Button>
                    ) : null}
                    <RecordActions
                        onView={() => setDetailRow(t)}
                        onEdit={() => setEditRow(t)}
                        onDelete={() => setDeleteRow(t)}
                        label={tr("Actions for {0}", {
            0: t.ticketNumber,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Scissors}
                title={tr("Service Jobs")}
                description={tr("Track every repair, wash or visit from intake to hand-over.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={tr("New job")} />}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={tr("Search ticket, customer or service…")}
                className="sm:max-w-sm"
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {JOB_STATUSES.map((s) => (
                        <TabsTrigger
                            key={s.value}
                            value={s.value}
                            className="rounded-lg text-sm font-bold"
                        >
                            {tr(s.label)}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!tickets ? (
                        <LoadingState />
                    ) : (
                        <DataTable
                            data={tickets}
                            columns={columns}
                            getRowId={(row: any) => row._id}
                            searchTerm={search}
                            defaultSort={{ id: "ticket", direction: "desc" }}
                            emptyTitle={tr("No jobs here")}
                            emptyHint={tr("Create a job ticket when a customer brings work in. Jobs move from received → in progress → ready → delivered.")}
                            ariaLabel="Service jobs"
                            caption={tr("{0} job ticket(s).", {
            0: tickets.length,
        })}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={tr("New service job")}
                submitLabel="Create job"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={tr("Edit service job")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.ticketNumber ?? "Job"}
                description={detailRow?.customerName}
                status={detailRow?.status}
                rows={[
                    { label: "Ticket", value: detailRow?.ticketNumber ?? "—" },
                    { label: "Customer", value: detailRow?.customerName ?? "—" },
                    { label: "Phone", value: detailRow?.customerPhone ?? "—" },
                    { label: "Service", value: detailRow?.serviceType ?? "—" },
                    { label: "Priority", value: detailRow?.priority ?? "—" },
                    { label: "Assigned to", value: detailRow?.assignedToName ?? "—" },
                    { label: "Estimate", value: detailRow?.estimatedCost ? ugx(detailRow.estimatedCost) : "—" },
                    { label: "Final cost", value: detailRow?.finalCost ? ugx(detailRow.finalCost) : "—" },
                    { label: "Received", value: shortDate(detailRow?.receivedDate) },
                    { label: "Due", value: shortDate(detailRow?.dueDate) },
                    { label: "Delivered", value: shortDate(detailRow?.deliveredDate) },
                    { label: "Description", value: detailRow?.description ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="job ticket"
                description={
                    deleteRow
                        ? `This removes the job ticket ${deleteRow.ticketNumber} permanently. A ticket that is on a recurring charge cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
