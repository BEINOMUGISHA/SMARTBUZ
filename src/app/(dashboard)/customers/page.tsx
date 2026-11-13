"use client";

/**
 * SMART_BUZ — Customers
 *
 * The customer directory. Every customer created here can be picked at the
 * till, appears on receipts, and drives the member/loan rules at checkout.
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
    UserPlus,
    Users,
    Search,
    Pencil,
    Trash2,
    Phone,
    Mail,
    MapPin,
    Hash,
    UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";

const PAGE_SIZE = 10;

const emptyForm = {
    name: "",
    phone: "",
    email: "",
    distributorId: "",
    address: "",
};

type FormState = typeof emptyForm;

export default function CustomersPage() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Doc<"customers"> | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [deleting, setDeleting] = useState<Doc<"customers"> | null>(null);

    const customers = useQuery(api.customers.getPaginated, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        searchTerm: search || undefined,
    });

    const addCustomer = useMutation(api.customers.add);
    const updateCustomer = useMutation(api.customers.update);
    const removeCustomer = useMutation(api.customers.remove);

    const rows = customers?.page ?? [];
    const totalCount = customers?.totalCount ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const stats = useMemo(() => {
        const all = customers?.page ?? [];
        const withId = all.filter((c) => c.distributorId).length;
        const withPhone = all.filter((c) => c.phone).length;
        return { onPage: all.length, withId, withPhone };
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
            await removeCustomer({ id: deleting._id, userId: user._id });
            toast.success("Customer removed", { description: deleting.name });
            setDeleting(null);
        } catch (err) {
            toast.error(formatError(err));
        }
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
                <Button onClick={openCreate} className="transition-transform active:scale-[0.98]">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add customer
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
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
                    icon={<Phone className="h-4 w-4" />}
                    label="Reachable by phone"
                    value={String(stats.withPhone)}
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
                                <Button size="sm" className="rounded-lg" onClick={openCreate}>
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    Add customer
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-background">
                                    <TableRow>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Phone</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Address</TableHead>
                                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((customer) => (
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
                                                        {customer.distributorId && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="mt-0.5 border-violet-200 bg-violet-100 text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                                                            >
                                                                ID: {customer.distributorId}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="tabular-nums">
                                                {customer.phone}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {customer.email || "—"}
                                            </TableCell>
                                            <TableCell className="max-w-[220px] truncate text-muted-foreground">
                                                {customer.address || "—"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
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
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
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
                                    <p className="text-xs text-destructive">A phone number is required.</p>
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

            <ConfirmDeleteModal
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={confirmDelete}
                title="Remove customer"
                description={`This removes ${deleting?.name ?? "this customer"} from the customer list. Sales already recorded keep their receipt details.`}
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
