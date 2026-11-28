"use client";

/**
 * SMART_BUZ — Pricing.
 *
 * The screen where a business decides what things cost and how a price is
 * worked out.
 *
 * Three things live here:
 *
 *   • **Price rules** — volume bands and prices of a customer's own.
 *   • **Unit conversions** — how many kilos are in a bag, how many
 *     metres are in a roll.
 *   • **The price book** — what one product actually costs at one
 *     quantity for one customer, worked out by the server.
 *
 * The price is never typed in here and trusted. The operator says what is
 * being bought and how much; the server says what it costs.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { Calculator, Layers, Ruler, Tag, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    PageContainer,
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import { FormDialog, type FormField } from "@/components/vertical/ui-kit";
import { describeError } from "@/components/error-feedback";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

interface PriceRule {
    _id: string;
    name: string;
    /** `tier` for a volume band, `customer` for a price of one customer's own. */
    type: string;
    customerId?: string;
    customerName?: string;
    isActive: boolean;
    entryCount: number;
    entries: Array<{
        _id: string;
        stockId: string;
        stockName: string;
        price: number;
        minQty?: number;
    }>;
}

interface UnitConversion {
    _id: string;
    fromUnit: string;
    toUnit: string;
    factor: number;
    measure: string;
}

interface PriceBookRow {
    stockId: string;
    name: string;
    productCode: string;
    listPrice: number;
    purchasePrice: number;
    unit: string;
    measure: string;
    tiers: Array<{ listName: string; minQty?: number; price: number }>;
    customerPrices: Array<{ listName: string; price: number }>;
    effectivePrice: number;
    priceSource: string;
    lineTotal: number;
    margin: number;
    marginPercent: number;
}

export default function PricingPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [conversionOpen, setConversionOpen] = useState(false);
    const [ruleFilter, setRuleFilter] = useState("all");
    const [conversionForm, setConversionForm] = useState({
        fromUnit: "",
        toUnit: "",
        factor: "",
    });

    // The price book lookup.
    const [bookStockId, setBookStockId] = useState<string | undefined>();
    const [bookQuantity, setBookQuantity] = useState("1");

    const summary = useQuery(api.packages.pricing.getPricingSummary, {});
    const rules = useQuery(
        api.packages.pricing.listPricingRules,
        ruleFilter === "all" ? {} : { type: ruleFilter }
    );
    const conversions = useQuery(api.packages.pricing.listUnitConversions, {});
    const products = useQuery(api.stocks.listAll, {});

    const createConversion = useMutation(api.packages.pricing.createUnitConversion);
    const deleteConversion = useMutation(api.packages.pricing.deleteUnitConversion);

    const conversionFields: FormField[] = [
        {
            name: "fromUnit",
            label: "Convert from",
            placeholder: "e.g. bag",
            required: true,
        },
        {
            name: "toUnit",
            label: "Convert to",
            placeholder: "e.g. kg",
            required: true,
        },
        {
            name: "factor",
            label: "How many of the second unit",
            type: "number",
            placeholder: "e.g. 50",
            required: true,
            hint: "One bag holds 50 kilograms.",
        },
    ];

    const ruleColumns: DataTableColumn<PriceRule>[] = [
        {
            id: "name",
            header: "Rule",
            accessor: (row) => row.name,
            cell: (row) => <span className="font-medium">{row.name}</span>,
        },
        {
            id: "type",
            header: "Kind",
            accessor: (row) => row.type,
            cell: (row) =>
                row.type === "tier" ? (
                    <Badge variant="info">{t("Volume band")}</Badge>
                ) : (
                    <Badge variant="neutral">{t("Customer price")}</Badge>
                ),
        },
        {
            id: "customer",
            header: "Customer",
            accessor: (row) => row.customerName ?? "",
            cell: (row) => row.customerName ?? <span className="text-muted-foreground">{t("Any customer")}</span>,
            hideBelow: "md",
        },
        {
            id: "entries",
            header: "Products priced",
            accessor: (row) => row.entryCount,
            align: "right",
            cell: (row) => (
                <span className="tabular-nums">{row.entryCount}</span>
            ),
        },
        {
            id: "range",
            header: "Prices",
            accessor: (row) =>
                row.entries.length
                    ? `${Math.min(...row.entries.map((e) => e.price))}–${Math.max(...row.entries.map((e) => e.price))}`
                    : "",
            align: "right",
            hideBelow: "sm",
            cell: (row) =>
                row.entries.length ? (
                    <span className="tabular-nums">
                        {currency} {Math.min(...row.entries.map((e) => e.price)).toLocaleString()} –{" "}
                        {currency} {Math.max(...row.entries.map((e) => e.price)).toLocaleString()}
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
    ];

    const conversionColumns: DataTableColumn<UnitConversion>[] = [
        {
            id: "from",
            header: "From",
            accessor: (row) => row.fromUnit,
            cell: (row) => <span className="font-medium">{row.fromUnit}</span>,
        },
        {
            id: "to",
            header: "To",
            accessor: (row) => row.toUnit,
            cell: (row) => <span className="font-medium">{row.toUnit}</span>,
        },
        {
            id: "factor",
            header: "How many",
            accessor: (row) => row.factor,
            align: "right",
            cell: (row) => (
                <span className="tabular-nums">
                    1 {row.fromUnit} = {row.factor.toLocaleString()} {row.toUnit}
                </span>
            ),
        },
        {
            id: "measure",
            header: "Measure",
            accessor: (row) => row.measure,
            hideBelow: "sm",
            cell: (row) => (
                <Badge variant={row.measure === "count" ? "neutral" : "info"}>
                    {row.measure}
                </Badge>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            excludeFromSearch: true,
            cell: (row) => (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Remove the {0} to {1} conversion", {
            0: row.fromUnit,
            1: row.toUnit,
        })}
                    onClick={async () => {
                        try {
                            await deleteConversion({ id: row._id as Id<"unitConversions"> });
                            toast.success("Conversion removed.");
                        } catch (error) {
                            toast.error(describeError(error, "The conversion could not be removed."));
                        }
                    }}
                >
                    <Trash2 className="size-4" />
                </Button>
            ),
        },
    ];

    const productOptions = useMemo(() => {
        const rows = (products ?? []) as Array<{
            _id: string;
            name: string;
            productCode: string;
            isActive?: boolean;
        }>;
        return rows
            .filter((p) => p.isActive !== false)
            .map((p) => ({ value: p._id, label: `${p.name} (${p.productCode})` }));
    }, [products]);

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Catalogue"
                title={t("Pricing")}
                description={t("Volume bands, prices of a customer's own, and the units your trade measures in.")}
                icon={Tag}
                actions={
                    <Button onClick={() => setConversionOpen(true)}>
                        <Plus className="mr-2 size-4" /> {t("Add conversion")}
                    </Button>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Volume bands")}
                    value={summary?.tierLists ?? 0}
                    hint={t("Price lists that drop as the quantity grows")}
                    icon={Layers}
                    tone="info"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Customer prices")}
                    value={summary?.customerLists ?? 0}
                    hint={t("Prices agreed with a particular customer")}
                    icon={Tag}
                    tone="default"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Unit conversions")}
                    value={summary?.conversions ?? 0}
                    hint={t("How many of one unit make one of another")}
                    icon={Ruler}
                    tone="default"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Products priced")}
                    value={`${summary?.productsWithRules ?? 0} / ${summary?.products ?? 0}`}
                    hint={t("Products with a rule of their own")}
                    icon={Calculator}
                    tone="success"
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Price rules")}
                description={t("What the business has agreed, and with whom.")}
                padded={false}
                actions={
                    <Select value={ruleFilter} onValueChange={setRuleFilter}>
                        <SelectTrigger className="h-9 w-[190px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All rules")}</SelectItem>
                            <SelectItem value="tier">{t("Volume bands")}</SelectItem>
                            <SelectItem value="customer">{t("Customer prices")}</SelectItem>
                        </SelectContent>
                    </Select>
                }
            >
                <DataTable
                    data={rules ?? []}
                    columns={ruleColumns}
                    getRowId={(row) => row._id}
                    isLoading={rules === undefined}
                    isEmpty={rules !== undefined && rules.length === 0}
                    emptyTitle={t("No price rules yet")}
                    emptyHint={t("A volume band or a customer's own price changes what the till charges. Add one when a customer agrees a price.")}
                    pageSize={15}
                    defaultSort={{ id: "name", direction: "asc" }}
                    ariaLabel="Price rules"
                    className="px-4 pb-5 sm:px-5"
                />
            </SectionCard>

            <SectionCard
                title={t("Unit conversions")}
                description={t("How many of one unit make one of another. A conversion is only allowed within a measure — kilograms to litres would need the density of the product, and SMARTBUZ does not hold that.")}
                padded={false}
            >
                <DataTable
                    data={conversions ?? []}
                    columns={conversionColumns}
                    getRowId={(row) => row._id}
                    isLoading={conversions === undefined}
                    isEmpty={conversions !== undefined && conversions.length === 0}
                    emptyTitle={t("No conversions yet")}
                    emptyHint={t("If you buy in bags and sell by the kilogram, set up the conversion once and the till does the rest.")}
                    pageSize={15}
                    defaultSort={{ id: "from", direction: "asc" }}
                    ariaLabel="Unit conversions"
                    className="px-4 pb-5 sm:px-5"
                />
            </SectionCard>

            <SectionCard
                title={t("Price book")}
                description={t("What a product actually costs, at a quantity, for a customer. The server works it out.")}
            >
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                        <Label htmlFor="book-stock">{t("Product")}</Label>
                        <Select value={bookStockId} onValueChange={setBookStockId}>
                            <SelectTrigger id="book-stock">
                                <SelectValue placeholder={t("Choose a product")} />
                            </SelectTrigger>
                            <SelectContent>
                                {productOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {t(option.label)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="book-quantity">{t("Quantity")}</Label>
                        <Input
                            id="book-quantity"
                            type="number"
                            min="0"
                            step="any"
                            value={bookQuantity}
                            onChange={(e) => setBookQuantity(e.target.value)}
                        />
                    </div>
                </div>

                {bookStockId ? (
                    <PriceBookPanel
                        stockId={bookStockId as Id<"stocks">}
                        quantity={Number(bookQuantity) || 0}
                        currency={currency}
                    />
                ) : (
                    <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
                        <p className="text-sm font-medium">{t("Choose a product")}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t("Pick a product and a quantity to see the price the till would charge.")}
                        </p>
                    </div>
                )}
            </SectionCard>

            <FormDialog
                open={conversionOpen}
                onOpenChange={setConversionOpen}
                title={t("Add a unit conversion")}
                description={t("Tell SMARTBUZ how many of one unit make one of another.")}
                fields={conversionFields}
                initialValues={conversionForm}
                onSubmit={async (values) => {
                    const factor = Number(values.factor);
                    if (!Number.isFinite(factor) || factor <= 0) {
                        toast.error("The factor must be a number greater than zero.");
                        return;
                    }
                    try {
                        await createConversion({
                            fromUnit: values.fromUnit,
                            toUnit: values.toUnit,
                            factor,
                        });
                        toast.success("Conversion saved.");
                        setConversionForm({ fromUnit: "", toUnit: "", factor: "" });
                    } catch (error) {
                        toast.error(describeError(error, "The conversion could not be saved."));
                    }
                }}
            />
        </PageContainer>
    );
}

/**
 * The price book for one product.
 *
 * It is a separate component so that the query only runs when a product
 * has actually been chosen.
 */
function PriceBookPanel({
    stockId,
    quantity,
    currency,
}: {
    stockId: Id<"stocks">;
    quantity: number;
    currency: string;
}) {
    
    const t = useT();const book = useQuery(
        api.packages.pricing.getPriceBook,
        quantity > 0 ? { stockId, quantity } : { stockId }
    );

    if (book === undefined) {
        return (
            <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {t("Working out the price…")}
            </div>
        );
    }

    const row: PriceBookRow = book as unknown as PriceBookRow;

    return (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                    {t("Price that applies")}
                </p>
                <p className="mt-2 text-stat font-semibold tabular-nums">
                    {currency} {row.effectivePrice.toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {row.priceSource === "tier"
                        ? "From a volume band."
                        : row.priceSource === "customer"
                          ? "The customer's own price."
                          : "The list price."}
                </p>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                    {t("Line total")}
                </p>
                <p className="mt-2 text-stat font-semibold tabular-nums">
                    {currency} {row.lineTotal.toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {quantity} {row.unit} at {currency} {row.effectivePrice.toLocaleString()}.
                </p>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                    {t("Margin on the line")}
                </p>
                <p className="mt-2 text-stat font-semibold tabular-nums">
                    {currency} {row.margin.toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {row.marginPercent.toFixed(1)}{t("% over a cost of")} {currency}{" "}
                    {row.purchasePrice.toLocaleString()}.
                </p>
            </div>

            {row.tiers.length > 0 && (
                <div className="lg:col-span-3">
                    <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                        {t("Volume bands for this product")}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                        {row.tiers.map((tier, index) => (
                            <li
                                key={`${tier.listName}-${index}`}
                                className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm"
                            >
                                <span>
                                    {tier.listName}
                                    {tier.minQty !== undefined
                                        ? ` — from ${tier.minQty} ${row.unit}`
                                        : ""}
                                </span>
                                <span className="font-semibold tabular-nums">
                                    {currency} {tier.price.toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
