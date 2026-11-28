"use client";

/**
 * SMART_BUZ — Inventory Management Hub
 *
 * Warehouse valuation, distribution and the low-stock audit.
 *
 * The page used to show the *global activity log* under the heading "Stock
 * Movements" — so signing in, editing a customer or opening a till all
 * appeared as warehouse events. It now shows the real stock entries, and
 * anything else it shows is labelled for what it is.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import {
    Package,
    TrendingUp,
    AlertTriangle,
    Database,
    Activity,
    BarChart3,
    Layers,
    DollarSign,
    ArrowRight,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
    PieChart,
    Pie,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    PageHeader,
    StatCard,
    StatGrid,
    SectionCard,
    DataState,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

/**
 * The chart palette, read from the design tokens rather than hardcoded hex,
 * so the charts follow the light and dark themes with everything else.
 */
const CHART_COLORS = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
    "var(--color-chart-1)",
];

const LOW_STOCK_THRESHOLD = 15;
const LOW_STOCK_LOOKBACK_DAYS = 7;

interface LowStockRow {
    _id: string;
    name: string;
    productCode?: string;
    categoryName?: string;
    qty: number;
    dailyVelocity?: number;
    daysToStockOut?: number | null;
    recommendedOrder?: number;
    valuation?: number;
}

export default function InventoryPage() {
    
    const t = useT();const { currency } = useCurrency();
    const [search, setSearch] = useState("");

    const stats = useQuery(api.stocks.getInventoryStats, {});
    const lowStockAudit = useQuery(api.stocks.getLowStockAudit, {
        threshold: LOW_STOCK_THRESHOLD,
        lookbackDays: LOW_STOCK_LOOKBACK_DAYS,
    });
    const stockEntries = useQuery(api.stocks.getStockEntries, {});

    const margin = useMemo(() => {
        const sell = stats?.totalSellValue ?? 0;
        const cost = stats?.totalCostValue ?? 0;
        return {
            percentage: sell > 0 ? ((sell - cost) / sell) * 100 : 0,
            profit: sell - cost,
        };
    }, [stats]);

    const lowStockColumns: DataTableColumn<LowStockRow>[] = [
        {
            id: "name",
            header: "Product",
            accessor: (row) => row.name,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{row.name}</p>
                    {row.productCode ? (
                        <p className="font-mono text-xs text-muted-foreground">
                            {row.productCode}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "category",
            header: "Category",
            accessor: (row) => row.categoryName ?? "",
            cell: (row) =>
                row.categoryName ? (
                    <Badge variant="neutral">{row.categoryName}</Badge>
                ) : (
                    "—"
                ),
            hideBelow: "md",
        },
        {
            id: "qty",
            header: "Qty left",
            accessor: (row) => row.qty,
            align: "right",
            cell: (row) => (
                <span
                    className={
                        row.qty <= 5
                            ? "font-semibold text-danger"
                            : "font-medium"
                    }
                >
                    {row.qty}
                </span>
            ),
        },
        {
            id: "velocity",
            header: "Daily sell",
            accessor: (row) => row.dailyVelocity ?? 0,
            align: "right",
            cell: (row) => (
                <span className="font-mono text-xs">
                    {row.dailyVelocity ?? 0}
                </span>
            ),
            hideBelow: "lg",
        },
        {
            id: "days",
            header: "Days left",
            accessor: (row) => row.daysToStockOut ?? null,
            align: "right",
            cell: (row) => (
                <span className="font-mono text-xs">
                    {row.daysToStockOut === null ||
                    row.daysToStockOut === undefined
                        ? "—"
                        : `${row.daysToStockOut}d`}
                </span>
            ),
            hideBelow: "lg",
        },
        {
            id: "reorder",
            header: "Reorder",
            accessor: (row) => row.recommendedOrder ?? 0,
            align: "right",
            cell: (row) => (
                <span className="font-mono text-xs">
                    {row.recommendedOrder && row.recommendedOrder > 0
                        ? `${row.recommendedOrder} units`
                        : "—"}
                </span>
            ),
            hideBelow: "md",
        },
        {
            id: "valuation",
            header: "Valuation",
            accessor: (row) => row.valuation ?? 0,
            align: "right",
            cell: (row) => (
                <span className="font-mono text-xs">
                    {currency} {(row.valuation ?? 0).toLocaleString()}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => (row.qty === 0 ? "out_of_stock" : "low"),
            align: "right",
            cell: (row) =>
                row.qty === 0 ? (
                    <Badge variant="danger">{t("Out of stock")}</Badge>
                ) : (
                    <Badge variant="warning">{t("Restock soon")}</Badge>
                ),
        },
    ];

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Layers}
                eyebrow="Warehouse"
                title={t("Inventory Management Hub")}
                description={t("Global warehouse valuation, distribution and the restocking picture.")}
                actions={
                    <Link href="/stock">
                        <Button variant="outline">
                            <Layers className="mr-2 size-4" />
                            {t("Manage stock")}
                        </Button>
                    </Link>
                }
            />

            <DataState isLoading={!stats}>
                {stats ? (
                    <>
                        <StatGrid>
                            <StatCard
                                label={t("Warehouse valuation")}
                                value={`${currency} ${stats.totalSellValue.toLocaleString()}`}
                                hint={t("Cost {0} {1}", {
            0: currency,
            1: stats.totalCostValue.toLocaleString(),
        })}
                                icon={DollarSign}
                                tone="info"
                            />
                            <StatCard
                                label={t("Estimated margin")}
                                value={`${margin.percentage.toFixed(1)}%`}
                                hint={t("Profit {0} {1}", {
            0: currency,
            1: margin.profit.toLocaleString(),
        })}
                                icon={TrendingUp}
                                tone={
                                    margin.percentage > 0 ? "success" : "default"
                                }
                            />
                            <StatCard
                                label={t("Units in stock")}
                                value={stats.totalItems.toLocaleString()}
                                hint={t("{0} distinct products", {
            0: stats.skuCount,
        })}
                                icon={Package}
                            />
                            <StatCard
                                label={t("Stock risks")}
                                value={(lowStockAudit?.length ?? 0).toString()}
                                hint={t("Below {0} units", {
            0: LOW_STOCK_THRESHOLD,
        })}
                                icon={AlertTriangle}
                                tone={
                                    (lowStockAudit?.length ?? 0) > 0
                                        ? "danger"
                                        : "success"
                                }
                            />
                        </StatGrid>

                        <StatGrid>
                            <StatCard
                                label={t("Business volume")}
                                value={stats.totalBV.toLocaleString()}
                                hint={t("Points that earn distributor commission")}
                                icon={BarChart3}
                            />
                            <StatCard
                                label={t("Point value")}
                                value={stats.totalPV.toLocaleString()}
                                hint={t("Qualification points for rank")}
                                icon={Activity}
                            />
                            <StatCard
                                label={t("Out of stock")}
                                value={stats.outOfStockCount.toString()}
                                hint={t("Products with nothing left")}
                                icon={AlertTriangle}
                                tone={
                                    stats.outOfStockCount > 0
                                        ? "danger"
                                        : "success"
                                }
                            />
                            <StatCard
                                label={t("Suppliers")}
                                value={stats.supplierCount.toString()}
                                hint={t("{0} active shops", {
            0: stats.shopCount,
        })}
                                icon={Database}
                            />
                        </StatGrid>

                        <StatGrid columns={2}>
                            <StatCard
                                label={t("Warehouse stock")}
                                value={stats.warehouseStock.toLocaleString()}
                                hint={t("In the main warehouse, not yet issued")}
                                icon={Package}
                            />
                            <StatCard
                                label={t("Shop stock")}
                                value={stats.totalShopStock.toLocaleString()}
                                hint={t("Already distributed to shops")}
                                icon={Layers}
                            />
                        </StatGrid>

                        {/* ── Distribution ─────────────────────────────── */}
                        <div className="grid gap-4 lg:grid-cols-3">
                            <DistributionChart
                                title={t("Category distribution")}
                                description={t("Stock volume by category")}
                                icon={BarChart3}
                                data={stats.categoryDistribution}
                                kind="bar"
                            />
                            <DistributionChart
                                title={t("Supplier distribution")}
                                description={t("Stock volume by supplier")}
                                icon={Database}
                                data={stats.supplierDistribution}
                                kind="pie"
                            />
                            <DistributionChart
                                title={t("Shop distribution")}
                                description={t("Stock allocated to shops")}
                                icon={Layers}
                                data={stats.shopDistribution}
                                kind="bar"
                            />
                        </div>

                        {/* ── Stock movements ─────────────────────────── */}
                        <SectionCard
                            title={t("Stock movements")}
                            description={t("Every addition to and deduction from stock, as it was recorded.")}
                            icon={Activity}
                            padded={false}
                        >
                            <DataState
                                isLoading={!stockEntries}
                                isEmpty={(stockEntries?.length ?? 0) === 0}
                                emptyTitle={t("No stock movements yet")}
                                emptyHint={t("Stock that has been added, restocked or issued will appear here.")}
                                loadingRows={4}
                            >
                                <div className="divide-y divide-border/60">
                                    {(stockEntries ?? []).slice(0, 12).map((entry: any) => (
                                        <div
                                            key={entry._id}
                                            className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-foreground">
                                                    {entry.stockName}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {entry.type === "restock"
                                                        ? "Restocked"
                                                        : "Added"}
                                                    {entry.productCode
                                                        ? ` · ${entry.productCode}`
                                                        : ""}
                                                    {entry.userName
                                                        ? ` · ${entry.userName}`
                                                        : ""}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="text-sm font-semibold tabular-nums text-foreground">
                                                    +{(entry.quantity ?? 0).toLocaleString()}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {entry.date
                                                        ? new Date(
                                                              entry.date
                                                          ).toLocaleString()
                                                        : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </DataState>
                        </SectionCard>

                        {/* ── Low stock audit ─────────────────────────── */}
                        <SectionCard
                            title={t("Low stock audit")}
                            description={t("Items below {0} units, over the last {1} days of selling.", {
            0: LOW_STOCK_THRESHOLD,
            1: LOW_STOCK_LOOKBACK_DAYS,
        })}
                            icon={AlertTriangle}
                            padded={false}
                            actions={
                                <DataTableExport
                                    title={t("Low stock audit")}
                                    rows={lowStockAudit ?? []}
                                    columns={lowStockColumns}
                                />
                            }
                        >
                            <DataTable
                                data={lowStockAudit ?? []}
                                columns={lowStockColumns}
                                getRowId={(row) => row._id}
                                isLoading={!lowStockAudit}
                                searchTerm={search}
                                onPageSizeChange={() => {}}
                                defaultSort={{ id: "qty", direction: "asc" }}
                                emptyTitle={t("No low stock items detected")}
                                emptyHint={t("Warehouse levels are healthy.")}
                                ariaLabel="Low stock audit"
                                caption={t("Sorted by how few are left. {0} item(s) need attention.", {
            0: lowStockAudit?.length ?? 0,
        })}
                            />
                        </SectionCard>
                    </>
                ) : null}
            </DataState>
        </div>
    );
}

/* ─────────────────────────── distribution chart ─────────────────────── */

function DistributionChart({
    title,
    description,
    icon: Icon,
    data,
    kind,
}: {
    title: string;
    description: string;
    icon: any;
    data: Array<{ name: string; value: number }>;
    kind: "bar" | "pie";
}) {
    
    const t = useT();return (
        <SectionCard title={title} description={description} icon={Icon}>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    {kind === "pie" ? (
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={80}
                                paddingAngle={2}
                                dataKey="value"
                                label={({ name, percent }) =>
                                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                                }
                                labelLine={false}
                            >
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                                    />
                                ))}
                            </Pie>
                            <ChartTooltip />
                        </PieChart>
                    ) : (
                        <BarChart
                            data={data}
                            layout="vertical"
                            margin={{ left: 60, right: 20 }}
                        >
                            <CartesianGrid
                                strokeDasharray="3 3"
                                horizontal={false}
                                stroke="var(--border)"
                            />
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 11 }}
                                width={55}
                            />
                            <ChartTooltip />
                            <Bar
                                dataKey="value"
                                radius={[0, 4, 4, 0]}
                                barSize={20}
                            >
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    )}
                </ResponsiveContainer>
            </div>
        </SectionCard>
    );
}

function ChartTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: any[];
}) {
    if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
        return null;
    }
    return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
            <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                {payload[0].payload.name}
            </p>
            <p className="text-lg font-semibold tabular-nums text-foreground">
                {payload[0].value?.toLocaleString()} items
            </p>
        </div>
    );
}
