"use client";

/**
 * SMART_BUZ — Customers
 *
 * The customer directory, and everything that hangs off a customer:
 *
 *  - **Profile and contact details** — who they are and how to reach them.
 *  - **Credit account** — what they owe, their limit, and what is left.
 *  - **Statement** — every charge and receipt with the running balance.
 *  - **Purchase history** — what they have actually bought.
 *  - **Loyalty points** — what they have earned.
 *
 * The balance shown in the table is the balance on the statement, because
 * both are derived from the same credit sales and payments. There is no
 * cached figure that could drift away from the transactions behind it.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    UserPlus,
    Users,
    Search,
    Pencil,
    Trash2,
    Mail,
    MapPin,
    Hash,
    UserRound,
    Wallet,
    ScrollText,
    ShoppingBag,
    Coins,
    Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { reportError } from "@/components/error-feedback";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { FormDialog, ugx, shortDate } from "@/components/vertical/ui-kit";

const PAGE_SIZE = 10;

const emptyForm = {
    name: "",
    phone: "",
    email: "",
    distributorId: "",
    address: "",
};

type FormState = typeof emptyForm;

const PAYMENT_METHODS = [
    { value: "cash", label: "Cash" },
    { value: "mobile_money", label: "Mobile money" },
    { value: "bank", label: "Bank transfer" },
    { value: "card", label: "Card" },
    { value: "credit", label: "Other" },
];

export default function CustomersPage() {
    const { user, can } = useAuth();
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Doc<"customers"> | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [deleting, setDeleting] = useState<Doc<"customers"> | null>(null);

    // Account panels.
    const [statementFor, setStatementFor] = useState<Doc<"customers"> | null>(null);
    const [historyFor, setHistoryFor] = useState<Doc<"customers"> | null>(null);
    const [payFor, setPayFor] = useState<Doc<"customers"> | null>(null);
    const [limitFor, setLimitFor] = useState<Doc<"customers"> | null>(null);

    const customers = useQuery(api.customers.getPaginated, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        searchTerm: search || undefined,
    });

    const statement = useQuery(
        api.customers.getStatement,
        statementFor ? { customerId: statementFor._id } : "skip"
    );
    const history = useQuery(
        api.customers.getPurchaseHistory,
        historyFor ? { customerId: historyFor._id, limit: 50 } : "skip"
    );
    const loyalty = useQuery(
        api.customers.getLoyalty,
        statementFor ? { customerId: statementFor._id } : "skip"
    );

    const addCustomer = useMutation(api.customers.add);
    const updateCustomer = useMutation(api.customers.update);
    const removeCustomer = useMutation(api.customers.remove);
    const recordPayment = useMutation(api.customers.recordPayment);
    const setCreditLimit = useMutation(api.customers.setCreditLimit);

    const rows = customers?.page ?? [];
    const totalCount = customers?.totalCount ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const stats = useMemo(() => {
        const all = customers?.page ?? [];
        const withId = all.filter((c) => c.distributorId).length;
        const owed = all.reduce(
            (sum: number, c: any) => sum + (c.outstandingBalance ?? 0),
            0
        );
        const overLimit = all.filter(
            (c: any) =>
                (c.creditLimit ?? 0) > 0 &&
                (c.outstandingBalance ?? 0) > (c.creditLimit ?? 0)
        ).length;
        return { onPage: all.length, withId, owed, overLimit };
    }, [customers]);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm);
        setErrors({});
        setIsDialogOpen(true);
    };

    const openEdit = (customer: Doc<"customers">) => {
        setEditing(customer);
        setForm({
            name: customer.name,
            phone: customer.phone,
            email: customer.email ?? "",
            distributorId: customer.distributorId ?? "",
            address: customer.address ?? "",
        });
        setErrors({});
        setIsDialogOpen(true);
    };

    const save = async () => {
        const nextErrors: Record<string, boolean> = {};
        if (!form.name.trim()) nextErrors.name = true;
        if (!form.phone.trim()) nextErrors.phone = true;
        if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = true;
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            toast.error("Check the highlighted fields");
            return;
        }
        if (!user) return;

        try {
            const payload = {
                name: form.name.trim(),
                phone: form.phone.trim(),
                email: form.email.trim() || undefined,
                distributorId: form.distributorId.trim() || undefined,
                address: form.address.trim() || undefined,
            };

            if (editing) {
                await updateCustomer({ id: editing._id, userId: user._id, ...payload });
                toast.success("Customer updated", { description: payload.name });
            } else {
                await addCustomer({ userId: user._id, ...payload });
                toast.success("Customer added", { description: payload.name });
            }

            setIsDialogOpen(false);
            setEditing(null);
            setForm(emptyForm);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const confirmDelete = async () => {
        if (!deleting || !user) return;
        try {
            const result = await removeCustomer({ id: deleting._id, userId: user._id });
            if (result?.deactivated) {
                toast.success("Customer deactivated", {
                    description:
                        "They have trading history, so the record was kept for your books.",
                });
            } else {
                toast.success("Customer removed", { description: deleting.name });
            }
            setDeleting(null);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const handlePayment = async (values: Record<string, string>) => {
        if (!payFor) return;
        const amount = Number(values.amount);
        try {
            await recordPayment({
                customerId: payFor._id,
                amount,
                date: values.date || undefined,
                method: values.method || undefined,
                reference: values.reference || undefined,
                note: values.note || undefined,
            });
        } catch (err) {
            // The dialog is re-thrown into so it keeps its contents and the
            // amount does not have to be typed again — but the refusal is
            // reported first, because a payment that was not recorded must
            // not look like one that was.
            reportError(err, "The payment could not be recorded.");
            throw err;
        }
        toast.success(`Payment of ${ugx(amount)} recorded`, {
            description: `Applied to ${payFor.name}'s oldest credit sales first.`,
        });
        setPayFor(null);
    };

    const handleCreditLimit = async (values: Record<string, string>) => {
        if (!limitFor) return;
        const amount = Number(values.creditLimit);
        try {
            await setCreditLimit({
                customerId: limitFor._id,
                creditLimit: amount,
                reason: values.reason || undefined,
            });
        } catch (err) {
            reportError(err, "The credit limit could not be changed.");
            throw err;
        }
        toast.success(`Credit limit set to ${ugx(amount)}`, {
            description: limitFor.name,
        });
        setLimitFor(null);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Customers</h1>
                    <p className="text-muted-foreground">
                        Everyone you sell to. Pick them at the till and they show up on the receipt.
                    </p>
                </div>
                {can("customers.manage") && (
                    <Button
                        onClick={openCreate}
                        className="transition-transform active:scale-[0.98]"
                    >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Add customer
                    </Button>
                )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    icon={<Users className="h-4 w-4" />}
                    label="Customers on this page"
                    value={String(stats.onPage)}
                />
                <StatCard
                    icon={<Hash className="h-4 w-4" />}
                    label="With a custom ID"
                    value={String(stats.withId)}
                />
                <StatCard
                    icon={<Wallet className="h-4 w-4" />}
                    label="Owed on this page"
                    value={ugx(stats.owed)}
                />
                <StatCard
                    icon={<Gauge className="h-4 w-4" />}
                    label="Over their credit limit"
                    value={String(stats.overLimit)}
                />
            </div>

            <Card className="shadow-sm">
                <CardContent className="p-0">
                    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative w-full sm:max-w-sm">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                                placeholder="Search name, phone or ID..."
                                className="pl-9"
                                aria-label="Search customers"
                            />
                        </div>
                        <p className="text-sm text-muted-foreground tabular-nums">
                            {totalCount} customer{totalCount === 1 ? "" : "s"}
                        </p>
                    </div>

                    {customers === undefined ? (
                        <div className="space-y-2 p-4">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4 px-2 py-2">
                                    <Skeleton className="h-9 w-9 rounded-full" />
                                    <Skeleton className="h-4 w-40 rounded" />
                                    <Skeleton className="h-4 w-28 rounded" />
                                    <Skeleton className="h-4 w-24 rounded" />
                                </div>
                            ))}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                                <Users className="h-7 w-7 text-muted-foreground/60" />
                            </div>
                            <div>
                                <p className="font-medium">
                                    {search ? "No customer matches that search" : "No customers yet"}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {search
                                        ? "Try a different name, phone number or customer ID."
                                        : "Add your first customer so you can attach sales to them."}
                                </p>
                            </div>
                            {search ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg"
                                    onClick={() => setSearch("")}
                                >
                                    Clear search
                                </Button>
                            ) : (
                                can("customers.manage") && (
                                    <Button size="sm" className="rounded-lg" onClick={openCreate}>
                                        <UserPlus className="mr-2 h-4 w-4" />
                                        Add customer
                                    </Button>
                                )
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-background">
                                    <TableRow>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Phone</TableHead>
                                        <TableHead className="text-right">Owed</TableHead>
                                        <TableHead className="text-right">Credit limit</TableHead>
                                        <TableHead className="text-right">Points</TableHead>
                                        <TableHead className="w-[260px] text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((customer: any) => {
                                        const balance = customer.outstandingBalance ?? 0;
                                        const limit = customer.creditLimit ?? 0;
                                        const overLimit =
                                            limit > 0 && balance > limit;
                                        return (
                                            <TableRow
                                                key={customer._id}
                                                className="animate-in fade-in duration-300 transition-colors"
                                            >
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                                                            {customer.name.trim().charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="truncate font-medium">
                                                                {customer.name}
                                                            </div>
                                                            {customer.distributorId ? (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="mt-0.5 border-violet-200 bg-violet-100 text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                                                                >
                                                                    ID: {customer.distributorId}
                                                                </Badge>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="tabular-nums">
                                                    {customer.phone}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    <span
                                                        className={
                                                            balance > 0
                                                                ? "font-bold text-amber-600 dark:text-amber-400"
                                                                : "text-muted-foreground"
                                                        }
                                                    >
                                                        {ugx(balance)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    <span className="text-muted-foreground">
                                                        {ugx(limit)}
                                                    </span>
                                                    {overLimit && (
                                                        <p className="text-[10px] font-bold uppercase text-destructive">
                                                            over limit
                                                        </p>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                                        <Coins className="h-3 w-3" />
                                                        {customer.loyaltyPoints ?? 0}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-lg active:scale-95 transition-transform"
                                                            aria-label={`Statement for ${customer.name}`}
                                                            onClick={() => setStatementFor(customer)}
                                                        >
                                                            <ScrollText className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 rounded-lg active:scale-95 transition-transform"
                                                            aria-label={`Purchase history for ${customer.name}`}
                                                            onClick={() => setHistoryFor(customer)}
                                                        >
                                                            <ShoppingBag className="h-4 w-4" />
                                                        </Button>
                                                        {can("customers.credit.manage") && (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 rounded-lg active:scale-95 transition-transform"
                                                                    aria-label={`Record a payment from ${customer.name}`}
                                                                    onClick={() => setPayFor(customer)}
                                                                >
                                                                    <Wallet className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 rounded-lg active:scale-95 transition-transform"
                                                                    aria-label={`Set credit limit for ${customer.name}`}
                                                                    onClick={() => setLimitFor(customer)}
                                                                >
                                                                    <Gauge className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {can("customers.manage") && (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 rounded-lg active:scale-95 transition-transform"
                                                                    aria-label={`Edit ${customer.name}`}
                                                                    onClick={() => openEdit(customer)}
                                                                >
                                                                    <Pencil className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 active:scale-95 transition-transform"
                                                                    aria-label={`Remove ${customer.name}`}
                                                                    onClick={() => setDeleting(customer)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t px-4 py-3">
                            <p className="text-xs text-muted-foreground tabular-nums">
                                Page {page} of {totalPages}
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg"
                                    disabled={page <= 1}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ───────────────────── add / edit customer ───────────────────── */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserRound className="h-5 w-5 text-primary" />
                            {editing ? "Edit customer" : "New customer"}
                        </DialogTitle>
                        <DialogDescription>
                            {editing
                                ? "Update the details for this customer."
                                : "The name and phone number are required. Everything else is optional."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="customer-name">Full name</Label>
                            <Input
                                id="customer-name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. Amina Nakato"
                                className={errors.name ? "border-destructive" : undefined}
                            />
                            {errors.name && (
                                <p className="text-xs text-destructive">A name is required.</p>
                            )}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="customer-phone">Phone number</Label>
                                <Input
                                    id="customer-phone"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    placeholder="0772 123 456"
                                    className={errors.phone ? "border-destructive" : undefined}
                                />
                                {errors.phone && (
                                    <p className="text-xs text-destructive">
                                        A phone number is required.
                                    </p>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="customer-did">Customer ID (optional)</Label>
                                <Input
                                    id="customer-did"
                                    value={form.distributorId}
                                    onChange={(e) =>
                                        setForm({ ...form, distributorId: e.target.value })
                                    }
                                    placeholder="Printed on the receipt"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="customer-email">Email (optional)</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id="customer-email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    placeholder="name@example.com"
                                    className={`pl-9 ${errors.email ? "border-destructive" : ""}`}
                                />
                            </div>
                            {errors.email && (
                                <p className="text-xs text-destructive">
                                    That does not look like a valid email address.
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="customer-address">Address (optional)</Label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id="customer-address"
                                    value={form.address}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    placeholder="Kampala, Uganda"
                                    className="pl-9"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={save} className="transition-transform active:scale-[0.98]">
                            {editing ? "Save changes" : "Add customer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ───────────────────── record a payment ───────────────────── */}
            <FormDialog
                open={!!payFor}
                onOpenChange={(v) => {
                    if (!v) setPayFor(null);
                }}
                title="Record a payment"
                description={
                    payFor
                        ? `Take money from ${payFor.name}. It is applied to their oldest credit sales first.`
                        : undefined
                }
                submitLabel="Record payment"
                fields={[
                    {
                        name: "amount",
                        label: "Amount received",
                        type: "number",
                        required: true,
                        min: 1,
                        placeholder: "0",
                        full: true,
                    },
                    {
                        name: "method",
                        label: "Method",
                        type: "select",
                        options: PAYMENT_METHODS,
                    },
                    {
                        name: "date",
                        label: "Date",
                        type: "date",
                    },
                    {
                        name: "reference",
                        label: "Reference",
                        placeholder: "Bank or receipt number",
                        hint: "Used to stop the same payment being recorded twice.",
                    },
                    {
                        name: "note",
                        label: "Note",
                        type: "textarea",
                        full: true,
                    },
                ]}
                onSubmit={handlePayment}
            />

            {/* ───────────────────── set credit limit ───────────────────── */}
            <FormDialog
                open={!!limitFor}
                onOpenChange={(v) => {
                    if (!v) setLimitFor(null);
                }}
                title="Set credit limit"
                description={
                    limitFor
                        ? `How much ${limitFor.name} may owe at any one time.`
                        : undefined
                }
                submitLabel="Save limit"
                fields={[
                    {
                        name: "creditLimit",
                        label: "Credit limit",
                        type: "number",
                        required: true,
                        min: 0,
                        defaultValue: limitFor?.creditLimit ?? 0,
                        full: true,
                    },
                    {
                        name: "reason",
                        label: "Reason",
                        placeholder: "Why the limit is changing",
                        full: true,
                    },
                ]}
                onSubmit={handleCreditLimit}
            />

            {/* ───────────────────── statement ───────────────────── */}
            <Sheet
                open={!!statementFor}
                onOpenChange={(v) => {
                    if (!v) setStatementFor(null);
                }}
            >
                <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            <ScrollText className="h-5 w-5 text-primary" />
                            Statement — {statementFor?.name}
                        </SheetTitle>
                        <SheetDescription>
                            Every charge and receipt on this account, with the balance after each
                            line.
                        </SheetDescription>
                    </SheetHeader>

                    {statement ? (
                        <>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <MiniStat label="Charged" value={ugx(statement.totalCharged)} />
                                <MiniStat label="Paid" value={ugx(statement.totalPaid)} />
                                <MiniStat
                                    label="Balance"
                                    value={ugx(statement.closingBalance)}
                                    tone="warn"
                                />
                            </div>

                            {loyalty && (
                                <p className="text-xs text-muted-foreground">
                                    Loyalty points:{" "}
                                    <span className="font-bold text-foreground">
                                        {loyalty.points}
                                    </span>{" "}
                                    earned{" "}
                                    <span className="font-bold text-foreground">
                                        {loyalty.lifetimePoints}
                                    </span>{" "}
                                    in total.
                                </p>
                            )}

                            {statement.lines.length === 0 ? (
                                <p className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">
                                    Nothing on this account yet.
                                </p>
                            ) : (
                                <div className="overflow-hidden rounded-xl border">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted/60">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-bold">Date</th>
                                                <th className="px-3 py-2 text-left font-bold">
                                                    Description
                                                </th>
                                                <th className="px-3 py-2 text-right font-bold">
                                                    Amount
                                                </th>
                                                <th className="px-3 py-2 text-right font-bold">
                                                    Balance
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statement.lines.map((line: any, idx: number) => (
                                                <tr key={idx} className="border-t">
                                                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                                        {shortDate(line.date)}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {line.description}
                                                        {line.reference && (
                                                            <span className="ml-1 text-[10px] text-muted-foreground">
                                                                ({line.reference})
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td
                                                        className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                                                            line.type === "payment"
                                                                ? "text-emerald-600 dark:text-emerald-400"
                                                                : ""
                                                        }`}
                                                    >
                                                        {line.type === "payment" ? "−" : ""}
                                                        {ugx(Math.abs(line.amount))}
                                                    </td>
                                                    <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">
                                                        {ugx(line.balanceAfter)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {can("customers.credit.manage") && (
                                <Button
                                    onClick={() => {
                                        if (statementFor) {
                                            setPayFor(statementFor);
                                            setStatementFor(null);
                                        }
                                    }}
                                >
                                    <Wallet className="mr-2 h-4 w-4" />
                                    Record a payment
                                </Button>
                            )}
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">Loading statement…</p>
                    )}
                </SheetContent>
            </Sheet>

            {/* ───────────────────── purchase history ───────────────────── */}
            <Sheet
                open={!!historyFor}
                onOpenChange={(v) => {
                    if (!v) setHistoryFor(null);
                }}
            >
                <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            <ShoppingBag className="h-5 w-5 text-primary" />
                            Purchase history — {historyFor?.name}
                        </SheetTitle>
                        <SheetDescription>
                            What this customer has bought, newest first.
                        </SheetDescription>
                    </SheetHeader>

                    {history ? (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <MiniStat
                                    label="Lifetime value"
                                    value={ugx(history.lifetimeValue)}
                                />
                                <MiniStat
                                    label="Purchases"
                                    value={String(history.totalCount)}
                                />
                            </div>

                            {history.sales.length === 0 ? (
                                <p className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">
                                    No purchases recorded yet.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {history.sales.map((sale: any) => (
                                        <div
                                            key={sale._id}
                                            className="flex items-center justify-between rounded-xl border p-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="font-mono text-[11px] font-bold text-muted-foreground">
                                                    {sale.invoiceNumber ?? "—"}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {shortDate(sale.date)} · {sale.itemCount} item(s)
                                                    {sale.paymentMode ? ` · ${sale.paymentMode}` : ""}
                                                </p>
                                            </div>
                                            <p className="shrink-0 text-sm font-black tabular-nums">
                                                {ugx(sale.total)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">Loading history…</p>
                    )}
                </SheetContent>
            </Sheet>

            <ConfirmDeleteModal
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={confirmDelete}
                title="Remove customer"
                description={`This removes ${deleting?.name ?? "this customer"} from the customer list. If they have trading history the record is deactivated instead, so your sales and credit account stay readable.`}
            />
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <Card className="shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {icon}
                </div>
                <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold tabular-nums">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function MiniStat({
    label,
    value,
    tone = "default",
}: {
    label: string;
    value: string;
    tone?: "default" | "warn";
}) {
    return (
        <div className="rounded-xl border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
            </p>
            <p
                className={`mt-0.5 text-lg font-black tabular-nums ${
                    tone === "warn"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground"
                }`}
            >
                {value}
            </p>
        </div>
    );
}
