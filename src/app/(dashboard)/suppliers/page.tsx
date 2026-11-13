"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
    Search,
    Edit,
    Loader2,
    Phone,
    Mail,
    Wallet,
    FileText,
    AlertCircle,
    type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

type SupplierForm = {
    name: string;
    contact: string;
    phone: string;
    email: string;
    address: string;
    paymentTerms: string;
    notes: string;
};

const EMPTY_FORM: SupplierForm = {
    name: "",
    contact: "",
    phone: "",
    email: "",
    address: "",
    paymentTerms: "",
    notes: "",
};

export default function SuppliersPage() {
    const { user } = useAuth();

    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Doc<"suppliers"> | null>(null);
    const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
    const [nameError, setNameError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Full list drives the summary cards; the filtered list drives the table.
    const allSuppliers = useQuery(api.verticals.operations.listSuppliers, {});
    const suppliers = useQuery(api.verticals.operations.listSuppliers, {
        search: debouncedSearch || undefined,
    });

    const upsertSupplier = useMutation(api.verticals.operations.upsertSupplier);

    const supplierList = allSuppliers ?? [];
    const totalSuppliers = supplierList.length;
    const suppliersWithTerms = supplierList.filter((s) => !!s.paymentTerms).length;
    const totalBalance = supplierList.reduce((sum, s) => sum + (s.balance ?? 0), 0);

    const openAddDialog = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setNameError("");
        setIsDialogOpen(true);
    };

    const openEditDialog = (supplier: Doc<"suppliers">) => {
        setEditing(supplier);
        setForm({
            name: supplier.name ?? "",
            contact: supplier.contact ?? "",
            phone: supplier.phone ?? "",
            email: supplier.email ?? "",
            address: supplier.address ?? "",
            paymentTerms: supplier.paymentTerms ?? "",
            notes: supplier.notes ?? "",
        });
        setNameError("");
        setIsDialogOpen(true);
    };

    const updateField = (field: keyof SupplierForm, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field === "name" && value.trim()) setNameError("");
    };

    const handleSave = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const name = form.name.trim();
        if (!name) {
            setNameError("Supplier name is required.");
            toast.error("Supplier name is required.");
            return;
        }
        if (!user) {
            toast.error("You must be signed in to save a supplier.");
            return;
        }

        setIsSaving(true);
        try {
            await upsertSupplier({
                id: editing?._id,
                name,
                contact: form.contact.trim() || undefined,
                phone: form.phone.trim() || undefined,
                email: form.email.trim() || undefined,
                address: form.address.trim() || undefined,
                paymentTerms: form.paymentTerms.trim() || undefined,
                notes: form.notes.trim() || undefined,
                userId: user._id,
            });
            toast.success(editing ? "Supplier updated" : "Supplier added");
            setIsDialogOpen(false);
            setEditing(null);
            setForm(EMPTY_FORM);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const rows = suppliers ?? [];
    const isLoading = suppliers === undefined;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-black tracking-tight text-foreground">Suppliers</h1>
                <p className="text-muted-foreground">Who you buy from, and on what terms.</p>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        id="supplier-search"
                        aria-label="Search suppliers by name"
                        placeholder="Search suppliers by name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Button
                    onClick={openAddDialog}
                    className="w-full sm:w-auto transition-transform active:scale-[0.98]"
                >
                    <Plus className="h-4 w-4" /> Add supplier
                </Button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                    icon={Truck}
                    label="Total suppliers"
                    value={totalSuppliers.toLocaleString()}
                    tone="emerald"
                />
                <StatCard
                    icon={FileText}
                    label="Terms recorded"
                    value={suppliersWithTerms.toLocaleString()}
                    tone="sky"
                />
                <StatCard
                    icon={Wallet}
                    label="Outstanding balance"
                    value={`UGX ${totalBalance.toLocaleString()}`}
                    tone="amber"
                />
            </div>

            {/* Table */}
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="max-h-[70vh] overflow-auto">
                    <Table className="min-w-[860px]">
                        <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Payment terms</TableHead>
                                <TableHead className="text-right">Balance (UGX)</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 6 }).map((_, index) => (
                                    <TableRow key={`skeleton-${index}`} className="animate-in fade-in duration-300">
                                        <TableCell>
                                            <Skeleton className="h-4 w-40" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-28" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-32" />
                                        </TableCell>
                                        <TableCell>
                                            <Skeleton className="h-4 w-20" />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Skeleton className="ml-auto h-4 w-24" />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Skeleton className="ml-auto h-8 w-8" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="p-0">
                                        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                                            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                                                <Truck className="h-6 w-6 text-muted-foreground" />
                                            </span>
                                            <div className="space-y-1">
                                                <p className="font-semibold text-foreground">
                                                    {debouncedSearch ? "No suppliers match your search" : "No suppliers yet"}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {debouncedSearch
                                                        ? "Try a different name, or clear the search to see everyone."
                                                        : "Add the businesses you buy from so purchase orders keep their terms."}
                                                </p>
                                            </div>
                                            <Button
                                                onClick={openAddDialog}
                                                className="transition-transform active:scale-[0.98]"
                                            >
                                                <Plus className="h-4 w-4" /> Add supplier
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((supplier) => (
                                    <TableRow
                                        key={supplier._id}
                                        className="animate-in fade-in duration-300 hover:bg-muted/50"
                                    >
                                        <TableCell>
                                            <div className="font-medium">{supplier.name}</div>
                                            {supplier.contact ? (
                                                <div className="text-xs text-muted-foreground">
                                                    {supplier.contact}
                                                </div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {supplier.phone ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                                    {supplier.phone}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {supplier.email ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                    {supplier.email}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {supplier.paymentTerms ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="bg-violet-100 text-violet-700 border-violet-200"
                                                >
                                                    {supplier.paymentTerms}
                                                </Badge>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">
                                            {supplier.balance != null
                                                ? `UGX ${supplier.balance.toLocaleString()}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={`Edit ${supplier.name}`}
                                                onClick={() => openEditDialog(supplier)}
                                                className="transition-transform active:scale-[0.98]"
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Add / Edit dialog */}
            <Dialog
                open={isDialogOpen}
                onOpenChange={(open) => {
                    setIsDialogOpen(open);
                    if (!open) {
                        setEditing(null);
                        setNameError("");
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit supplier" : "Add supplier"}</DialogTitle>
                        <DialogDescription>
                            {editing
                                ? "Update the details you buy from this supplier on."
                                : "Record who you buy from and the terms you agree on."}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="supplier-name">Supplier name</Label>
                            <Input
                                id="supplier-name"
                                value={form.name}
                                onChange={(e) => updateField("name", e.target.value)}
                                placeholder="e.g. Kampala Grain Traders"
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
                                <Label htmlFor="supplier-contact">Contact person</Label>
                                <Input
                                    id="supplier-contact"
                                    value={form.contact}
                                    onChange={(e) => updateField("contact", e.target.value)}
                                    placeholder="e.g. Betty Nakato"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="supplier-phone">Phone</Label>
                                <Input
                                    id="supplier-phone"
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => updateField("phone", e.target.value)}
                                    placeholder="e.g. 0772 000 000"
                                />
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label htmlFor="supplier-email">Email</Label>
                                <Input
                                    id="supplier-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    placeholder="e.g. sales@example.com"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="supplier-terms">Payment terms</Label>
                                <Input
                                    id="supplier-terms"
                                    value={form.paymentTerms}
                                    onChange={(e) => updateField("paymentTerms", e.target.value)}
                                    placeholder="e.g. Net 30"
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="supplier-address">Address</Label>
                            <Input
                                id="supplier-address"
                                value={form.address}
                                onChange={(e) => updateField("address", e.target.value)}
                                placeholder="e.g. Plot 12, Kitemo Industrial Area"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="supplier-notes">Notes</Label>
                            <Input
                                id="supplier-notes"
                                value={form.notes}
                                onChange={(e) => updateField("notes", e.target.value)}
                                placeholder="Anything worth remembering about this supplier"
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
                                        Saving...
                                    </>
                                ) : editing ? (
                                    "Save changes"
                                ) : (
                                    "Add supplier"
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

type StatTone = "emerald" | "amber" | "sky";

const STAT_TONES: Record<StatTone, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
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
