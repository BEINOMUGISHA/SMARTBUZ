"use client";

/**
 * SMART_BUZ — Quotations.
 *
 * A quotation is the offer a business puts in front of a customer before any
 * work is done. This screen is the register of those offers: what is still
 * being written, what is out with a customer, and what has been accepted and
 * is ready to become a sale.
 *
 * Every figure on screen is the server's. The register does not add
 * quotations up on the client — it asks the server what they come to — so
 * what the owner reads here is the same figure the owner would be held to.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import {
    Eye,
    FileText,
    MoreHorizontal,
    Plus,
    Send,
    ShoppingCart,
    Trash2,
    XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    ActionButton,
    CountBadge,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
    Toolbar,
    ToolbarGroup,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    FormDialog,
    RecordDetail,
    type FormField,
    shortDate,
    today,
} from "@/components/vertical/ui-kit";
import { reportError } from "@/components/error-feedback";
import { statusLabel, statusTone } from "@/lib/status-tone";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────── */

type QuotationLine = {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    stockId?: Id<"stocks">;
};

type Quotation = {
    _id: Id<"quotations">;
    customerId?: Id<"customers">;
    customerName: string;
    customerPhone?: string;
    reference: string;
    lines: QuotationLine[];
    subtotal: number;
    discount: number;
    total: number;
    status: string;
    storedStatus: string;
    validUntil: string;
    notes?: string;
    convertedSaleId?: Id<"sales">;
    createdAt: string;
};

type Product = {
    _id: Id<"stocks">;
    name: string;
    price: number;
};

type Customer = {
    _id: Id<"customers">;
    name: string;
    phone: string;
};

/** A line being written in the form. */
type LineDraft = {
    key: string;
    /** The product behind the line, or "" for work with no product. */
    stockId: string;
    description: string;
    quantity: string;
    unitPrice: string;
};

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary of the screen
 * ──────────────────────────────────────────────────────────────────────── */

const STATUS_FILTERS = [
    { value: "all", label: "All statuses" },
    { value: "draft", label: "Draft" },
    { value: "sent", label: "Sent" },
    { value: "accepted", label: "Accepted" },
    { value: "declined", label: "Declined" },
    { value: "expired", label: "Expired" },
    { value: "converted", label: "Converted" },
];

/**
 * The colours of a quotation's states.
 *
 * The shared status map knows the states the whole product shares; these
 * two — a quotation that has been sent, and a lead that has been won — are
 * the commercial ones, so they are named here rather than guessed at on
 * every screen.
 */
const QUOTE_TONES: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
    draft: "neutral",
    sent: "info",
    accepted: "success",
    declined: "danger",
    expired: "danger",
    converted: "success",
};

function quoteTone(status: string) {
    return QUOTE_TONES[status] ?? statusTone(status);
}

const PAYMENT_MODES = [
    { value: "Cash", label: "Cash" },
    { value: "Mobile Money", label: "Mobile money" },
    { value: "Bank Transfer", label: "Bank transfer" },
    { value: "Bonus Transfer", label: "Bonus transfer" },
    { value: "Credit", label: "Credit — to be paid later" },
    { value: "Loan", label: "Loan" },
];

/** The day a fresh quotation holds until: a month out. */
function defaultValidUntil(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
}

/* ────────────────────────────────────────────────────────────────────────
 * The line editor
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The lines of a quotation.
 *
 * The price of a line comes from the catalogue, so picking a product fills
 * the price in. A line with no product is work — delivery, installation —
 * and the price is typed for it.
 */
function LineEditor({
    lines,
    onChange,
    products,
}: {
    lines: LineDraft[];
    onChange: (lines: LineDraft[]) => void;
    products: Product[];
}) {
    
    const t = useT();const addLine = () =>
        onChange([
            ...lines,
            {
                key: `${Date.now()}-${lines.length}`,
                stockId: "",
                description: "",
                quantity: "1",
                unitPrice: "",
            },
        ]);

    const update = (key: string, patch: Partial<LineDraft>) =>
        onChange(
            lines.map((line) => (line.key === key ? { ...line, ...patch } : line))
        );

    const pickProduct = (key: string, stockId: string) => {
        const line = lines.find((entry) => entry.key === key);
        if (!line) return;

        if (stockId === "none") {
            update(key, { stockId: "" });
            return;
        }

        const product = products.find((entry) => entry._id === stockId);
        if (!product) return;

        // The description the operator typed is kept; one that was only
        // filled in from the product before follows the new product.
        const previous = products.find((entry) => entry._id === line.stockId);
        const wasFilledIn =
            !line.description.trim() ||
            (previous !== undefined && line.description === previous.name);

        update(key, {
            stockId,
            description: wasFilledIn ? product.name : line.description,
            unitPrice: String(product.price),
        });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label>{t("Lines")}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="mr-2 size-4" />
                    {t("Add a line")}
                </Button>
            </div>

            {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    {t("A quotation needs at least one line.")}
                </p>
            ) : null}

            {lines.map((line, index) => (
                <div
                    key={line.key}
                    className="grid gap-2 rounded-lg border border-border/60 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_5rem_7rem_2.25rem]"
                >
                    <Select
                        value={line.stockId || "none"}
                        onValueChange={(value) => pickProduct(line.key, value)}
                    >
                        <SelectTrigger className="h-9" aria-label={t("Product for line {0}", {
            0: index + 1,
        })}>
                            <SelectValue placeholder={t("Product")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">{t("No product — work")}</SelectItem>
                            {products.map((product) => (
                                <SelectItem key={product._id} value={product._id}>
                                    {product.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Input
                        className="h-9"
                        value={t(line.description)}
                        onChange={(event) =>
                            update(line.key, { description: event.target.value })
                        }
                        placeholder={t("What this line is for")}
                        aria-label={t("Description for line {0}", {
            0: index + 1,
        })}
                    />

                    <Input
                        className="h-9"
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(event) =>
                            update(line.key, { quantity: event.target.value })
                        }
                        placeholder={t("Qty")}
                        aria-label={t("Quantity for line {0}", {
            0: index + 1,
        })}
                    />

                    <Input
                        className="h-9"
                        type="number"
                        min="0"
                        step="any"
                        value={line.unitPrice}
                        onChange={(event) =>
                            update(line.key, { unitPrice: event.target.value })
                        }
                        placeholder={t("Price")}
                        aria-label={t("Price for line {0}", {
            0: index + 1,
        })}
                    />

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:text-destructive"
                        onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))}
                        aria-label={t("Remove line {0}", {
            0: index + 1,
        })}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            ))}
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ──────────────────────────────────────────────────────────────────────── */

export default function QuotationsPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [statusFilter, setStatusFilter] = useState("all");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [lines, setLines] = useState<LineDraft[]>([
        {
            key: "first",
            stockId: "",
            description: "",
            quantity: "1",
            unitPrice: "",
        },
    ]);
    const [selectedCustomerId, setSelectedCustomerId] = useState("");

    const [viewing, setViewing] = useState<Quotation | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [converting, setConverting] = useState<Quotation | null>(null);

    const summary = useQuery(api.packages.commercial.getQuotationSummary, {});
    const quotations = useQuery(
        api.packages.commercial.listQuotations,
        statusFilter === "all" ? {} : { status: statusFilter }
    );

    // The catalogue and the customer directory are only needed while a
    // quotation is being written, so they are not fetched until then.
    const products = useQuery(
        api.stocks.listAll,
        isCreateOpen ? ({} as any) : "skip"
    );
    const customers = useQuery(
        api.customers.listAll,
        isCreateOpen ? ({} as any) : "skip"
    );

    const createQuotation = useMutation(api.packages.commercial.createQuotation);
    const updateStatus = useMutation(api.packages.commercial.updateQuotationStatus);
    const convertToSale = useMutation(api.packages.commercial.convertQuotationToSale);

    const productList: Product[] = useMemo(
        () =>
            (products ?? []).map((stock: any) => ({
                _id: stock._id,
                name: stock.name,
                price: stock.price,
            })),
        [products]
    );

    const customerList: Customer[] = useMemo(
        () =>
            (customers ?? []).map((customer: any) => ({
                _id: customer._id,
                name: customer.name,
                phone: customer.phone,
            })),
        [customers]
    );

    const rows: Quotation[] = quotations ?? [];
    const isLoading = quotations === undefined;

    /** Fail with a sentence the operator can act on, said once. */
    const fail = (message: string): never => {
        const error = new Error(message);
        reportError(error, message);
        throw error;
    };

    const handleCreate = async (values: Record<string, string>) => {
        const prepared = lines.map((line) => {
            const product = productList.find((entry) => entry._id === line.stockId);
            const quantity = Number(line.quantity);
            const typedPrice = line.unitPrice.trim() === "" ? undefined : Number(line.unitPrice);

            return {
                description: line.description.trim() || product?.name || "",
                quantity: Number.isFinite(quantity) ? quantity : 0,
                // The price is only sent when it differs from the
                // catalogue's, so an untouched line is priced by the server.
                unitPrice:
                    product &&
                    typedPrice !== undefined &&
                    Math.abs(typedPrice - product.price) < 0.005
                        ? undefined
                        : typedPrice,
                stockId: line.stockId ? (line.stockId as Id<"stocks">) : undefined,
            };
        });

        for (const line of prepared) {
            if (!line.description) {
                fail("Every line needs to say what it is for.");
            }
            if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
                fail("Every line needs a quantity of more than zero.");
            }
            if (line.unitPrice === undefined && !line.stockId) {
                fail("A line with no product behind it needs a price.");
            }
        }

        const discount = values.discount?.trim() ? Number(values.discount) : 0;

        try {
            const result = await createQuotation({
                customerId: selectedCustomerId
                    ? (selectedCustomerId as Id<"customers">)
                    : undefined,
                customerName: values.customerName?.trim() ?? "",
                customerPhone: values.customerPhone?.trim() || undefined,
                lines: prepared,
                discount: Number.isFinite(discount) ? discount : 0,
                validUntil: values.validUntil,
                notes: values.notes?.trim() || undefined,
            });
            toast.success(`Quotation ${result.reference} written.`);
            setLines([
                {
                    key: "first",
                    stockId: "",
                    description: "",
                    quantity: "1",
                    unitPrice: "",
                },
            ]);
            setSelectedCustomerId("");
        } catch (error) {
            reportError(error, "The quotation could not be written.");
            throw error;
        }
    };

    const moveStatus = async (quotation: Quotation, status: "sent" | "declined") => {
        try {
            await updateStatus({ quotationId: quotation._id, status });
            toast.success(
                status === "sent"
                    ? `${quotation.reference} has been sent.`
                    : `${quotation.reference} has been declined.`
            );
        } catch (error) {
            reportError(error, "The quotation could not be changed.");
        }
    };

    const handleConvert = async (values: Record<string, string>) => {
        if (!converting) return;
        try {
            const result = await convertToSale({
                quotationId: converting._id,
                paymentMode: values.paymentMode || "Cash",
                paymentDueDate: values.paymentDueDate || undefined,
            });
            toast.success(`${converting.reference} is now sale ${result.invoiceNumber}.`);
            setConverting(null);
        } catch (error) {
            reportError(error, "The quotation could not be turned into a sale.");
            throw error;
        }
    };

    const createFields: FormField[] = [
        {
            name: "customerName",
            label: "Customer name",
            type: "text",
            required: true,
            placeholder: "Who the quotation is for",
        },
        {
            name: "customerPhone",
            label: "Phone",
            type: "tel",
            placeholder: "Optional",
        },
        {
            name: "validUntil",
            label: "Valid until",
            type: "date",
            required: true,
            defaultValue: defaultValidUntil(),
            hint: "The last day the offer holds.",
        },
        {
            name: "discount",
            label: "Discount",
            type: "number",
            min: 0,
            step: 0.01,
            hint: "An amount off the whole quotation.",
        },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const convertFields: FormField[] = [
        {
            name: "paymentMode",
            label: "How it will be paid",
            type: "select",
            required: true,
            defaultValue: "Cash",
            options: PAYMENT_MODES,
        },
        {
            name: "paymentDueDate",
            label: "Payment due",
            type: "date",
            hint: "Only for a credit sale. A month from today if left empty.",
        },
    ];

    const columns: DataTableColumn<Quotation>[] = [
        {
            id: "reference",
            header: "Reference",
            accessor: (row) => row.reference,
            cell: (row) => (
                <span className="font-semibold tabular-nums">{row.reference}</span>
            ),
        },
        {
            id: "customer",
            header: "Customer",
            accessor: (row) => row.customerName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.customerName}</p>
                    {row.customerPhone ? (
                        <p className="truncate text-xs text-muted-foreground">
                            {row.customerPhone}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "lines",
            header: "Lines",
            accessor: (row) => row.lines.length,
            align: "center",
            cell: (row) => <span className="tabular-nums">{row.lines.length}</span>,
        },
        {
            id: "total",
            header: `Total (${currency})`,
            accessor: (row) => row.total,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {row.total.toLocaleString()}
                </span>
            ),
        },
        {
            id: "validUntil",
            header: "Valid until",
            accessor: (row) => row.validUntil,
            cell: (row) => <span className="tabular-nums">{shortDate(row.validUntil)}</span>,
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <Badge variant={quoteTone(row.status)}>{statusLabel(row.status)}</Badge>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            cell: (row) => (
                <div className="flex items-center justify-end">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-foreground"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">{t("Actions for")} {row.reference}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onSelect={() => {
                                    setViewing(row);
                                    setIsDetailOpen(true);
                                }}
                            >
                                <Eye className="h-4 w-4" />
                                {t("View details")}
                            </DropdownMenuItem>

                            {row.status === "draft" ? (
                                <DropdownMenuItem onSelect={() => void moveStatus(row, "sent")}>
                                    <Send className="h-4 w-4" />
                                    {t("Send to customer")}
                                </DropdownMenuItem>
                            ) : null}

                            {row.status === "accepted" ? (
                                <DropdownMenuItem onSelect={() => setConverting(row)}>
                                    <ShoppingCart className="h-4 w-4" />
                                    {t("Convert to sale")}
                                </DropdownMenuItem>
                            ) : null}

                            {row.status === "draft" || row.status === "sent" ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onSelect={() => void moveStatus(row, "declined")}
                                        className="text-destructive focus:text-destructive"
                                    >
                                        <XCircle className="h-4 w-4" />
                                        {t("Decline")}
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ),
        },
    ];

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Commercial"
                title={t("Quotations")}
                description={t("The offers this business has put in front of its customers — what is still being written, what is out, and what has been accepted and is ready to become a sale.")}
                icon={FileText}
                actions={
                    <>
                        <CountBadge>{summary?.count ?? 0}</CountBadge>
                        <ActionButton onClick={() => setIsCreateOpen(true)}>
                            <Plus className="mr-2 size-4" />
                            {t("New quotation")}
                        </ActionButton>
                    </>
                }
            />

            <StatGrid columns={3}>
                <StatCard
                    label={t("Drafts")}
                    value={summary?.draft ?? 0}
                    hint={t("Written but not yet sent")}
                    icon={FileText}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Sent")}
                    value={summary?.sent ?? 0}
                    hint={t("With the customer, waiting for an answer")}
                    icon={Send}
                    tone="info"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Accepted")}
                    value={summary?.accepted ?? 0}
                    hint={t("Agreed and ready to become a sale")}
                    icon={ShoppingCart}
                    tone="success"
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <StatGrid columns={3}>
                <StatCard
                    label={t("Value out")}
                    value={`${currency} ${(summary?.outstandingValue ?? 0).toLocaleString()}`}
                    hint={t("Drafted, sent and accepted, waiting on the customer")}
                    icon={ShoppingCart}
                    tone="warning"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Declined")}
                    value={summary?.declined ?? 0}
                    hint={t("The customer said no")}
                    icon={XCircle}
                    tone="danger"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Expired")}
                    value={summary?.expired ?? 0}
                    hint={t("Past the day the offer held until")}
                    icon={FileText}
                    tone="danger"
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Quotation register")}
                description={
                    rows.length === 0
                        ? "Nothing has been quoted yet."
                        : `${rows.length} ${rows.length === 1 ? "quotation" : "quotations"} in the register.`
                }
                actions={
                    <DataTableExport
                        title={t("Quotations")}
                        subtitle={t("Quotation register as at {0}", {
            0: today(),
        })}
                        rows={rows}
                        columns={columns}
                    />
                }
                padded={false}
            >
                <div className="border-b border-border/60 p-4 sm:p-5">
                    <Toolbar>
                        <ToolbarGroup>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="h-9 w-[180px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_FILTERS.map((filter) => (
                                        <SelectItem key={filter.value} value={filter.value}>
                                            {t(filter.label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </ToolbarGroup>
                    </Toolbar>
                </div>

                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={isLoading}
                    isEmpty={!isLoading && rows.length === 0}
                    emptyTitle={t("No quotations yet")}
                    emptyHint={t("Write the offer you want to put in front of a customer. It keeps its own lines, its own prices and the day it holds until.")}
                    emptyAction={
                        <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
                            <Plus className="mr-2 size-4" />
                            {t("New quotation")}
                        </Button>
                    }
                    pageSize={25}
                    defaultSort={{ id: "createdAt", direction: "desc" }}
                    ariaLabel="Quotation register"
                />
            </SectionCard>

            <FormDialog
                open={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                title={t("New quotation")}
                description={t("The prices are read from the catalogue and the totals are worked out on the server.")}
                fields={createFields}
                submitLabel="Write quotation"
                onSubmit={handleCreate}
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="quote-customer">{t("Existing customer")}</Label>
                        <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                            <SelectTrigger id="quote-customer" className="w-full">
                                <SelectValue placeholder={t("Nobody in the directory — type the name below")} />
                            </SelectTrigger>
                            <SelectContent>
                                {customerList.map((customer) => (
                                    <SelectItem key={customer._id} value={customer._id}>
                                        {customer.name} — {customer.phone}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {t("Picking a customer links the quotation to them. Leave it empty for somebody who is not in the directory yet.")}
                        </p>
                    </div>

                    <LineEditor lines={lines} onChange={setLines} products={productList} />
                </div>
            </FormDialog>

            <FormDialog
                open={converting !== null}
                onOpenChange={(open) => {
                    if (!open) setConverting(null);
                }}
                title={t("Turn this quotation into a sale")}
                description={
                    converting
                        ? `${converting.reference} — ${converting.customerName}. The stock moves and the sale appears in the normal reports.`
                        : undefined
                }
                fields={convertFields}
                submitLabel="Convert to sale"
                onSubmit={handleConvert}
            />

            <RecordDetail
                open={isDetailOpen}
                onOpenChange={setIsDetailOpen}
                title={viewing?.reference ?? "Quotation"}
                description={viewing?.customerName}
                status={viewing?.status}
                rows={
                    viewing
                        ? [
                              {
                                  label: "Customer",
                                  value: viewing.customerName,
                              },
                              {
                                  label: "Phone",
                                  value: viewing.customerPhone || "—",
                              },
                              {
                                  label: "Subtotal",
                                  value: `${currency} ${viewing.subtotal.toLocaleString()}`,
                              },
                              {
                                  label: "Discount",
                                  value: `${currency} ${viewing.discount.toLocaleString()}`,
                              },
                              {
                                  label: "Total",
                                  value: `${currency} ${viewing.total.toLocaleString()}`,
                              },
                              {
                                  label: "Valid until",
                                  value: shortDate(viewing.validUntil),
                              },
                              ...viewing.lines.map((line, index) => ({
                                  label: `Line ${index + 1}`,
                                  value: `${line.description} — ${line.quantity} × ${line.unitPrice.toLocaleString()} = ${line.total.toLocaleString()}`,
                              })),
                              ...(viewing.notes
                                  ? [{ label: "Notes", value: viewing.notes }]
                                  : []),
                          ]
                        : []
                }
                footer={
                    viewing ? (
                        <>
                            {viewing.status === "draft" ? (
                                <Button
                                    variant="outline"
                                    onClick={() => void moveStatus(viewing, "sent")}
                                >
                                    <Send className="mr-2 size-4" />
                                    {t("Send")}
                                </Button>
                            ) : null}
                            {viewing.status === "accepted" ? (
                                <Button onClick={() => setConverting(viewing)}>
                                    <ShoppingCart className="mr-2 size-4" />
                                    {t("Convert to sale")}
                                </Button>
                            ) : null}
                        </>
                    ) : null
                }
            />
        </PageContainer>
    );
}
