"use client";

/**
 * SMART_BUZ — Suppliers
 *
 * The supplier book and everything that hangs off it:
 *
 *  - **Suppliers** — contacts, payment terms, and what the business owes.
 *  - **Goods received** — the notes that back every stock increase.
 *  - **Invoices** — what the suppliers have charged us.
 *  - **Payments** — what we have paid them.
 *
 * The balance shown against a supplier is the sum of their ledger, so the
 * number here is the same number on their statement and the same number
 * on the invoice list.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    SearchBox,
    LoadingState,
    EmptyState,
    FormDialog,
    CreateButton,
    RecordList,
    StatStrip,
    StatusBadge,
    ugx,
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Truck, Plus, Pencil, PackageCheck, Receipt, Wallet, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function SuppliersPage() {
    const { user, can } = useAuth();
    const [tab, setTab] = useState("suppliers");
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    // Statement and money dialogs.
    const [statementFor, setStatementFor] = useState<any>(null);
    const [payFor, setPayFor] = useState<any>(null);
    const [invoiceFor, setInvoiceFor] = useState<any>(null);

    const suppliers = useQuery(api.suppliers.listAll, {
        searchTerm: search || undefined,
    });
    const receipts = useQuery(api.purchasing.listGoodsReceipts, { limit: 100 });
    const invoices = useQuery(api.purchasing.listInvoices, { limit: 100 });
    const payments = useQuery(api.suppliers.listPayments, { limit: 100 });

    const statement = useQuery(
        api.suppliers.getStatement,
        statementFor ? { supplierId: statementFor._id } : "skip"
    );

    const upsertSupplier = useMutation(api.suppliers.upsert);
    const paySupplier = useMutation(api.suppliers.paySupplier);
    const recordInvoice = useMutation(api.purchasing.recordInvoice);

    const totalOwed = useMemo(
        () =>
            (suppliers ?? []).reduce(
                (sum: number, s: any) => sum + (s.balance ?? 0),
                0
            ),
        [suppliers]
    );
    const openInvoiceTotal = invoices?.totalOutstanding ?? 0;

    const handleSave = async (values: Record<string, string>) => {
        if (!user) return;
        await upsertSupplier({
            id: editing?._id,
            name: values.name,
            contact: values.contact || undefined,
            phone: values.phone || undefined,
            email: values.email || undefined,
            address: values.address || undefined,
            paymentTerms: values.paymentTerms || undefined,
            paymentTermsDays: values.paymentTermsDays
                ? Number(values.paymentTermsDays)
                : undefined,
            taxNumber: values.taxNumber || undefined,
            notes: values.notes || undefined,
        });
        toast.success(editing ? "Supplier updated" : "Supplier added");
        setEditing(null);
    };

    const handlePay = async (values: Record<string, string>) => {
        if (!payFor) return;
        await paySupplier({
            supplierId: payFor._id,
            amount: Number(values.amount),
            method: values.method || undefined,
            reference: values.reference || undefined,
            notes: values.notes || undefined,
        });
        toast.success(`Payment of ${ugx(Number(values.amount))} recorded`);
        setPayFor(null);
    };

    const handleInvoice = async (values: Record<string, string>) => {
        if (!invoiceFor) return;
        await recordInvoice({
            supplierId: invoiceFor._id,
            invoiceNumber: values.invoiceNumber,
            date: values.date || undefined,
            dueDate: values.dueDate || undefined,
            notes: values.notes || undefined,
            items: [
                {
                    name: values.itemName || "Goods supplied",
                    quantity: Number(values.quantity || 1),
                    unitCost: Number(values.unitCost || 0),
                },
            ],
        });
        toast.success(`Invoice ${values.invoiceNumber} recorded`);
        setInvoiceFor(null);
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Truck}
                title="Suppliers"
                description="Who you buy from, what you owe them, and every payment you have made."
                actions={
                    can("suppliers.manage") ? (
                        <CreateButton
                            onClick={() => {
                                setEditing(null);
                                setCreateOpen(true);
                            }}
                            label="Add supplier"
                        />
                    ) : undefined
                }
            />

            <StatStrip
                stats={[
                    { label: "Total owed", value: ugx(totalOwed), tone: "warn" },
                    { label: "Open invoices", value: ugx(openInvoiceTotal) },
                    { label: "Suppliers", value: String((suppliers ?? []).length) },
                    {
                        label: "Paid out",
                        value: ugx(payments?.totalPaid ?? 0),
                        tone: "good",
                    },
                ]}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-4 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="suppliers" className="rounded-lg text-sm font-bold">
                        <Truck className="mr-2 h-4 w-4" /> Suppliers
                    </TabsTrigger>
                    <TabsTrigger value="receipts" className="rounded-lg text-sm font-bold">
                        <PackageCheck className="mr-2 h-4 w-4" /> Goods received
                    </TabsTrigger>
                    <TabsTrigger value="invoices" className="rounded-lg text-sm font-bold">
                        <Receipt className="mr-2 h-4 w-4" /> Invoices
                    </TabsTrigger>
                    <TabsTrigger value="payments" className="rounded-lg text-sm font-bold">
                        <Wallet className="mr-2 h-4 w-4" /> Payments
                    </TabsTrigger>
                </TabsList>

                {/* ───────────────────────── suppliers ───────────────────────── */}
                <TabsContent value="suppliers" className="mt-4 space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Search suppliers…"
                    />

                    {!suppliers ? (
                        <LoadingState />
                    ) : suppliers.length === 0 ? (
                        <EmptyState
                            title="No suppliers yet"
                            hint="Add the companies you buy from so purchase orders and goods receipts can be tracked against them."
                        />
                    ) : (
                        <RecordList
                            records={suppliers}
                            renderItem={(s: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black">{s.name}</p>
                                            {s.isActive === false && (
                                                <StatusBadge status="inactive" />
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {s.contact ? `${s.contact} · ` : ""}
                                            {s.phone ?? ""}
                                            {s.email ? ` · ${s.email}` : ""}
                                        </p>
                                        {s.address && (
                                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                {s.address}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        <div className="text-right">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Owed
                                            </p>
                                            <p
                                                className={`text-sm font-black tabular-nums ${
                                                    (s.balance ?? 0) > 0
                                                        ? "text-amber-600 dark:text-amber-400"
                                                        : ""
                                                }`}
                                            >
                                                {ugx(s.balance ?? 0)}
                                            </p>
                                        </div>
                                        {s.paymentTerms && (
                                            <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold">
                                                {s.paymentTerms}
                                            </span>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setStatementFor(s)}
                                        >
                                            <ScrollText className="mr-1.5 h-3.5 w-3.5" />
                                            Statement
                                        </Button>
                                        {can("purchasing.pay") && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={(s.balance ?? 0) <= 0}
                                                onClick={() => setPayFor(s)}
                                            >
                                                <Wallet className="mr-1.5 h-3.5 w-3.5" />
                                                Pay
                                            </Button>
                                        )}
                                        {can("suppliers.manage") && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setEditing(s);
                                                    setCreateOpen(true);
                                                }}
                                            >
                                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                                Edit
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ───────────────────────── goods received ───────────────────────── */}
                <TabsContent value="receipts" className="mt-4">
                    {!receipts ? (
                        <LoadingState />
                    ) : receipts.page.length === 0 ? (
                        <EmptyState
                            title="No goods received yet"
                            hint="Receive goods against a purchase order to create a GRN and increase your stock."
                        />
                    ) : (
                        <RecordList
                            records={receipts.page}
                            renderItem={(r: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold">{r.receiptNumber}</p>
                                            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                                RECEIVED
                                            </span>
                                        </div>
                                        <p className="mt-1 font-black">{r.supplierName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {r.items.length} line(s) · {shortDate(r.date)}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums">
                                        {ugx(r.total)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ───────────────────────── invoices ───────────────────────── */}
                <TabsContent value="invoices" className="mt-4 space-y-4">
                    {!invoices ? (
                        <LoadingState />
                    ) : invoices.page.length === 0 ? (
                        <EmptyState
                            title="No supplier invoices yet"
                            hint="Record an invoice when a supplier sends one, so what you owe is tracked."
                        />
                    ) : (
                        <RecordList
                            records={invoices.page}
                            renderItem={(i: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold">
                                                {i.invoiceNumber}
                                            </p>
                                            <StatusBadge status={i.status} />
                                        </div>
                                        <p className="mt-1 font-black">{i.supplierName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {shortDate(i.date)}
                                            {i.dueDate ? ` · due ${shortDate(i.dueDate)}` : ""}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="text-sm font-black tabular-nums">
                                            {ugx(i.total)}
                                        </p>
                                        {i.amountPaid > 0 && (
                                            <p className="text-[10px] text-muted-foreground tabular-nums">
                                                {ugx(i.amountPaid)} paid ·{" "}
                                                {ugx(i.total - i.amountPaid)} outstanding
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ───────────────────────── payments ───────────────────────── */}
                <TabsContent value="payments" className="mt-4">
                    {!payments ? (
                        <LoadingState />
                    ) : payments.page.length === 0 ? (
                        <EmptyState
                            title="No payments made yet"
                            hint="Pay a supplier from their row on the Suppliers tab."
                        />
                    ) : (
                        <RecordList
                            records={payments.page}
                            renderItem={(p: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black">{p.supplierName}</p>
                                            {p.method && (
                                                <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold">
                                                    {p.method}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {shortDate(p.date)}
                                            {p.reference ? ` · ref ${p.reference}` : ""}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                        −{ugx(p.amount)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            {/* ───────────────────────── add / edit supplier ───────────────────────── */}
            <FormDialog
                open={createOpen}
                onOpenChange={(v) => {
                    setCreateOpen(v);
                    if (!v) setEditing(null);
                }}
                title={editing ? "Edit supplier" : "Add supplier"}
                submitLabel={editing ? "Save changes" : "Add supplier"}
                fields={[
                    { name: "name", label: "Supplier name", required: true, full: true },
                    { name: "contact", label: "Contact person" },
                    { name: "phone", label: "Phone", type: "tel", placeholder: "0772 123 456" },
                    { name: "email", label: "Email", type: "email" },
                    {
                        name: "paymentTerms",
                        label: "Payment terms",
                        placeholder: "e.g. Net 30",
                    },
                    {
                        name: "paymentTermsDays",
                        label: "Terms (days)",
                        type: "number",
                        min: 0,
                        hint: "Used to work out when an invoice falls due",
                    },
                    { name: "taxNumber", label: "Tax number" },
                    { name: "address", label: "Address", full: true },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleSave}
            />

            {/* ───────────────────────── pay a supplier ───────────────────────── */}
            <FormDialog
                open={!!payFor}
                onOpenChange={(v) => {
                    if (!v) setPayFor(null);
                }}
                title={payFor ? `Pay ${payFor.name}` : "Pay supplier"}
                description={
                    payFor
                        ? `Outstanding: ${ugx(payFor.balance ?? 0)}. The payment is applied to the oldest open invoice first.`
                        : undefined
                }
                submitLabel="Record payment"
                fields={[
                    {
                        name: "amount",
                        label: "Amount",
                        type: "number",
                        required: true,
                        min: 1,
                        defaultValue: payFor?.balance ?? 0,
                    },
                    {
                        name: "method",
                        label: "Method",
                        type: "select",
                        options: [
                            { value: "cash", label: "Cash" },
                            { value: "mobile_money", label: "Mobile money" },
                            { value: "bank", label: "Bank transfer" },
                            { value: "card", label: "Card" },
                            { value: "cheque", label: "Cheque" },
                        ],
                    },
                    {
                        name: "reference",
                        label: "Reference",
                        placeholder: "Receipt or bank reference",
                        hint: "A reference can only be used once — it stops a double payment.",
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handlePay}
            />

            {/* ───────────────────────── record an invoice ───────────────────────── */}
            <FormDialog
                open={!!invoiceFor}
                onOpenChange={(v) => {
                    if (!v) setInvoiceFor(null);
                }}
                title={invoiceFor ? `Record an invoice from ${invoiceFor.name}` : "Record invoice"}
                description="The invoice number identifies the document — it cannot be recorded twice for the same supplier."
                submitLabel="Record invoice"
                fields={[
                    { name: "invoiceNumber", label: "Invoice number", required: true },
                    { name: "date", label: "Date", type: "date" },
                    { name: "dueDate", label: "Due date", type: "date" },
                    { name: "itemName", label: "What was supplied", full: true },
                    { name: "quantity", label: "Quantity", type: "number", min: 1, defaultValue: 1 },
                    { name: "unitCost", label: "Unit cost", type: "number", min: 0, required: true },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleInvoice}
            />

            {/* ───────────────────────── the statement ───────────────────────── */}
            <Sheet open={!!statementFor} onOpenChange={(v) => !v && setStatementFor(null)}>
                <SheetContent className="overflow-y-auto sm:max-w-lg">
                    <SheetHeader>
                        <SheetTitle>{statementFor?.name} — statement</SheetTitle>
                        <SheetDescription>
                            Every movement on the account, with the balance after each
                            line.
                        </SheetDescription>
                    </SheetHeader>

                    {!statement ? (
                        <LoadingState />
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-3">
                                <Card>
                                    <CardContent className="p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            Billed
                                        </p>
                                        <p className="text-sm font-black tabular-nums">
                                            {ugx(statement.totalCharged)}
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            Paid
                                        </p>
                                        <p className="text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                            {ugx(statement.totalPaid)}
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            Owed
                                        </p>
                                        <p className="text-sm font-black tabular-nums">
                                            {ugx(statement.closingBalance)}
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            {statement.lines.length === 0 ? (
                                <EmptyState
                                    title="No movements yet"
                                    hint="An invoice or payment will show up here."
                                />
                            ) : (
                                <div className="overflow-x-auto rounded-xl border border-border/60">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/40">
                                            <tr className="text-left">
                                                <th className="px-3 py-2 font-bold">Date</th>
                                                <th className="px-3 py-2 font-bold">Details</th>
                                                <th className="px-3 py-2 text-right font-bold">
                                                    Amount
                                                </th>
                                                <th className="px-3 py-2 text-right font-bold">
                                                    Balance
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statement.lines.map((line: any) => (
                                                <tr
                                                    key={line._id}
                                                    className="border-t border-border/50"
                                                >
                                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                                        {shortDate(line.date)}
                                                    </td>
                                                    <td className="px-3 py-2 text-xs">
                                                        {line.description}
                                                    </td>
                                                    <td
                                                        className={`px-3 py-2 text-right text-xs font-bold tabular-nums ${
                                                            line.amount < 0
                                                                ? "text-emerald-600 dark:text-emerald-400"
                                                                : ""
                                                        }`}
                                                    >
                                                        {line.amount < 0 ? "−" : ""}
                                                        {ugx(Math.abs(line.amount))}
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-xs font-bold tabular-nums">
                                                        {ugx(line.balanceAfter)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
