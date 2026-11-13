"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Truck,
    Plus,
    Loader2,
    MapPin,
    User,
    Banknote,
    Package,
    CircleCheck,
    CircleX,
    AlertCircle,
    type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

type DeliveryForm = {
    customerName: string;
    destination: string;
    assignedToName: string;
    amount: string;
    notes: string;
};

const EMPTY_FORM: DeliveryForm = {
    customerName: "",
    destination: "",
    assignedToName: "",
    amount: "",
    notes: "",
};

type StatusFilter = "all" | "pending" | "dispatched" | "delivered" | "failed";

const STATUS_STYLES: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-200",
    dispatched: "bg-sky-100 text-sky-800 border-sky-200",
    delivered: "bg-emerald-100 text-emerald-800 border-emerald-200",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    dispatched: "Dispatched",
    delivered: "Delivered",
    failed: "Failed",
};

const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "dispatched", label: "Dispatched" },
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed" },
];

function formatDate(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

export default function DeliveriesPage() {
    const { user } = useAuth();

    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [form, setForm] = useState<DeliveryForm>(EMPTY_FORM);
    const [nameError, setNameError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [pendingId, setPendingId] = useState<Id<"deliveries"> | null>(null);

    const deliveries = useQuery(api.verticals.operations.listDeliveries, {});
    const createDelivery = useMutation(api.verticals.operations.createDelivery);
    const updateDeliveryStatus = useMutation(api.verticals.operations.updateDeliveryStatus);

    const all = deliveries ?? [];
    const totalDeliveries = all.length;
    const pendingCount = all.filter((d) => d.status === "pending").length;
    const dispatchedCount = all.filter((d) => d.status === "dispatched").length;
    const undeliveredValue = all
        .filter((d) => d.status === "pending" || d.status === "dispatched")
        .reduce((sum, d) => sum + (d.amount ?? 0), 0);

    const rows = all.filter((d) => statusFilter === "all" || d.status === statusFilter);
    const isLoading = deliveries === undefined;

    const updateField = (field: keyof DeliveryForm, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field === "customerName" && value.trim()) setNameError("");
    };

    const openDialog = () => {
        setForm(EMPTY_FORM);
        setNameError("");
        setIsDialogOpen(true);
    };

    const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const customerName = form.customerName.trim();
        if (!customerName) {
            setNameError("Customer name is required.");
            toast.error("Customer name is required.");
            return;
        }
        if (!user) {
            toast.error("You must be signed in to create a delivery.");
            return;
        }

        const rawAmount = form.amount.trim();
        const parsedAmount = rawAmount === "" ? undefined : Number(rawAmount);
        if (parsedAmount !== undefined && (Number.isNaN(parsedAmount) || parsedAmount < 0)) {
            toast.error("Enter a valid amount.");
            return;
        }

        setIsSaving(true);
        try {
            const result = await createDelivery({
                customerName,
                destination: form.destination.trim() || undefined,
                assignedToName: form.assignedToName.trim() || undefined,
                amount: parsedAmount,
                notes: form.notes.trim() || undefined,
                userId: user._id,
            });
            toast.success(`Delivery ${result.reference} created`);
            setIsDialogOpen(false);
            setForm(EMPTY_FORM);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const changeStatus = async (id: Id<"deliveries">, status: "dispatched" | "delivered") => {
        setPendingId(id);
        try {
            await updateDeliveryStatus({ id, status });
            toast.success(
                status === "dispatched"
                    ? "Delivery dispatched"
                    : "Delivery marked as delivered"
            );
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setPendingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-black tracking-tight text-foreground">Deliveries</h1>
                <p className="text-muted-foreground">
                    Dispatch and track goods on the way to the customer.
                </p>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Tabs
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                >
                    <TabsList className="grid h-auto w-full grid-cols-2 sm:w-auto sm:grid-cols-5">
                        {FILTERS.map((filter) => (
                            <TabsTrigger
                                key={filter.value}
                                value={filter.value}
                                className="text-xs sm:text-sm"
                            >
                                {filter.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <Button
                    onClick={openDialog}
                    className="w-full sm:w-auto transition-transform active:scale-[0.98]"
                >
                    <Plus className="h-4 w-4" /> New delivery
                </Button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    icon={Package}
                    label="Total deliveries"
                    value={totalDeliveries.toLocaleString()}
                    tone="emerald"
                />
                <StatCard
                    icon={Truck}
                    label="Pending"
                    value={pendingCount.toLocaleString()}
                    tone="amber"
                />
                <StatCard
                    icon={MapPin}
                    label="Dispatched"
                    value={dispatchedCount.toLocaleString()}
                    tone="sky"
                />
                <StatCard
                    icon={Banknote}
                    label="Undelivered value"
                    value={`UGX ${undeliveredValue.toLocaleString()}`}
                    tone="violet"
                />
            </div>

            {/* Table */}
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="max-h-[70vh] overflow-auto">
                    <Table className="min-w-[1000px]">
                        <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                                <TableHead>Reference</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Destination</TableHead>
                                <TableHead>Assigned to</TableHead>
                                <TableHead className="text-right">Amount (UGX)</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 6 }).map((_, index) => (
                                    <TableRow key={`skeleton-${index}`} className="animate-in fade-in duration-300">
                                        <TableCell>
                                            <Skeleton className="h-4 w-20" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-32" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-36" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-24" />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Skeleton className="ml-auto h-4 w-24" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-5 w-24 rounded-full" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-24" />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Skeleton className="ml-auto h-8 w-28" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="p-0">
                                        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                                            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                                                <Truck className="h-6 w-6 text-muted-foreground" />
                                            </span>
                                            <div className="space-y-1">
                                                <p className="font-semibold text-foreground">
                                                    {statusFilter === "all"
                                                        ? "No deliveries yet"
                                                        : `No ${STATUS_LABELS[statusFilter]?.toLowerCase() ?? statusFilter} deliveries`}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {statusFilter === "all"
                                                        ? "Create a delivery to dispatch goods to a customer."
                                                        : "Switch tabs to see deliveries in other states."}
                                                </p>
                                            </div>
                                            <Button
                                                onClick={openDialog}
                                                className="transition-transform active:scale-[0.98]"
                                            >
                                                <Plus className="h-4 w-4" /> New delivery
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((delivery) => {
                                    const isPending = pendingId === delivery._id;
                                    return (
                                        <TableRow
                                            key={delivery._id}
                                            className="animate-in fade-in duration-300 hover:bg-muted/50"
                                        >
                                            <TableCell className="font-mono text-xs">
                                                {delivery.reference}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {delivery.customerName}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {delivery.destination ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {delivery.destination}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {delivery.assignedToName ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {delivery.assignedToName}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">
                                                {delivery.amount != null
                                                    ? `UGX ${delivery.amount.toLocaleString()}`
                                                    : "—"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="secondary"
                                                    className={
                                                        STATUS_STYLES[delivery.status] ??
                                                        "bg-slate-100 text-slate-700 border-slate-200"
                                                    }
                                                >
                                                    {STATUS_LABELS[delivery.status] ?? delivery.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {formatDate(delivery.createdAt)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DeliveryActions
                                                    status={delivery.status}
                                                    reference={delivery.reference}
                                                    isPending={isPending}
                                                    onDispatch={() =>
                                                        changeStatus(delivery._id, "dispatched")
                                                    }
                                                    onDelivered={() =>
                                                        changeStatus(delivery._id, "delivered")
                                                    }
                                                />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* New delivery dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New delivery</DialogTitle>
                        <DialogDescription>
                            Record a dispatch run so you can track it until it lands.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="delivery-customer">Customer name</Label>
                            <Input
                                id="delivery-customer"
                                value={form.customerName}
                                onChange={(e) => updateField("customerName", e.target.value)}
                                placeholder="e.g. Nakasero Mini Mart"
                                aria-invalid={!!nameError}
                                autoFocus
                            />
                            {nameError ? (
                                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    {nameError}
                                </p>
                            ) : null}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label htmlFor="delivery-destination">Destination</Label>
                                <Input
                                    id="delivery-destination"
                                    value={form.destination}
                                    onChange={(e) => updateField("destination", e.target.value)}
                                    placeholder="e.g. Wakiso, Kampala"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="delivery-assigned">Assigned to</Label>
                                <Input
                                    id="delivery-assigned"
                                    value={form.assignedToName}
                                    onChange={(e) => updateField("assignedToName", e.target.value)}
                                    placeholder="e.g. Ivan Mugisha"
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="delivery-amount">Amount (UGX)</Label>
                            <Input
                                id="delivery-amount"
                                type="number"
                                min={0}
                                step="100"
                                inputMode="numeric"
                                className="tabular-nums"
                                value={form.amount}
                                onChange={(e) => updateField("amount", e.target.value)}
                                placeholder="e.g. 450000"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="delivery-notes">Notes</Label>
                            <Input
                                id="delivery-notes"
                                value={form.notes}
                                onChange={(e) => updateField("notes", e.target.value)}
                                placeholder="e.g. 2 crates of soda, deliver before 5pm"
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                                disabled={isSaving}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isSaving}
                                className="transition-transform active:scale-[0.98]"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    "Create delivery"
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function DeliveryActions({
    status,
    reference,
    isPending,
    onDispatch,
    onDelivered,
}: {
    status: string;
    reference: string;
    isPending: boolean;
    onDispatch: () => void;
    onDelivered: () => void;
}) {
    if (status === "pending") {
        return (
            <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={onDispatch}
                className="transition-transform active:scale-[0.98]"
            >
                {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Truck className="h-3.5 w-3.5" />
                )}
                Dispatch
            </Button>
        );
    }

    if (status === "dispatched") {
        return (
            <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={onDelivered}
                className="transition-transform active:scale-[0.98]"
            >
                {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <CircleCheck className="h-3.5 w-3.5" />
                )}
                Mark delivered
            </Button>
        );
    }

    if (status === "delivered") {
        return (
            <span className="inline-flex items-center text-muted-foreground">
                <CircleCheck
                    className="h-4 w-4 text-emerald-600"
                    aria-label={`Delivery ${reference} was delivered`}
                />
            </span>
        );
    }

    return (
        <span className="inline-flex items-center text-muted-foreground">
            <CircleX
                className="h-4 w-4 text-destructive"
                aria-label={`Delivery ${reference} failed`}
            />
        </span>
    );
}

type StatTone = "emerald" | "amber" | "sky" | "violet";

const STAT_TONES: Record<StatTone, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
};

function StatCard({
    icon: Icon,
    label,
    value,
    tone,
}: {
    icon: LucideIcon;
    label: string;
    value: string;
    tone: StatTone;
}) {
    return (
        <Card className="animate-in fade-in duration-300 gap-0 py-0 shadow-sm">
            <CardContent className="flex items-center gap-3 px-4 py-4">
                <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${STAT_TONES[tone]}`}
                >
                    <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {label}
                    </p>
                    <p className="truncate text-lg font-black text-foreground tabular-nums">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}
