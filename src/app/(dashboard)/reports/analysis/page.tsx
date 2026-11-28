"use client";

/**
 * SMARTBUZ — Business Intelligence.
 *
 * The reporting suite, in one place:
 *
 *   Daily, weekly and monthly sales
 *   Gross profit and net profit
 *   Running costs
 *   Best sellers and slow movers
 *   Stock valuation
 *   Sales by cashier and by branch
 *   How the money came in
 *   Who owes the business, and who the business owes
 *
 * Every report reads the same records through the same filters, and every
 * report can be taken away as a CSV, an Excel workbook or a PDF.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    LoadingState,
    EmptyState,
    ugx,
} from "@/components/vertical/ui-kit";
import {
    FinanceFilterBar,
    type FinanceFilters,
} from "@/components/finance/report-filters";
import { ExportMenu } from "@/components/finance/export-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    BarChart3,
    TrendingUp,
    Users,
    Building2,
    CreditCard,
    Banknote,
    TrendingDown,
    Boxes,
    PieChart,
} from "lucide-react";
import type { ExportColumn } from "@/lib/export";
import { number, percent, date } from "@/lib/export";
import { useT } from "@/i18n/provider";

function startOfMonth(): string {
    return new Date().toISOString().slice(0, 8) + "01";
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

const DEFAULT_FILTERS: FinanceFilters = { from: startOfMonth(), to: today() };

export default function BusinessIntelligencePage() {
    
    const t = useT();const { can } = useAuth();
    const [filters, setFilters] = useState<FinanceFilters>(DEFAULT_FILTERS);
    const [tab, setTab] = useState("sales");
    const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

    const range = { from: filters.from, to: filters.to, branchId: filters.branchId };

    const sales = useQuery(
        api.analytics.getSalesByPeriod,
        can("finance.reports.view") ? { ...range, period } : "skip"
    );
    const profit = useQuery(
        api.analytics.getProfitAndLoss,
        can("finance.reports.view") ? range : "skip"
    );
    const expenses = useQuery(
        api.analytics.getExpenseReport,
        can("finance.reports.view") ? { ...range, limit: 100 } : "skip"
    );
    const best = useQuery(
        api.analytics.getBestSellingProducts,
        can("finance.reports.view") ? { ...range, limit: 50 } : "skip"
    );
    const slow = useQuery(
        api.analytics.getSlowMovingProducts,
        can("finance.reports.view") ? { ...range, limit: 50 } : "skip"
    );
    const valuation = useQuery(
        api.analytics.getStockValuation,
        can("finance.reports.view") ? { branchId: filters.branchId } : "skip"
    );
    const byCashier = useQuery(
        api.analytics.getSalesByCashier,
        can("finance.reports.view") ? range : "skip"
    );
    const byBranch = useQuery(
        api.analytics.getSalesByBranch,
        can("finance.reports.view") ? { from: filters.from, to: filters.to } : "skip"
    );
    const methods = useQuery(
        api.analytics.getPaymentMethodAnalysis,
        can("finance.reports.view") ? range : "skip"
    );
    const customerDebt = useQuery(
        api.analytics.getCustomerDebtReport,
        can("finance.reports.view") ? { branchId: filters.branchId, limit: 50 } : "skip"
    );
    const supplierDebt = useQuery(
        api.analytics.getSupplierDebtReport,
        can("finance.reports.view") ? { limit: 50 } : "skip"
    );

    if (!can("finance.reports.view")) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={BarChart3}
                    title={t("Business Intelligence")}
                    description={t("Sales, profit, stock and debt — all from the records.")}
                />
                <EmptyState
                    title={t("Reports are not available to your role")}
                    hint={t("Ask an administrator if you need to run the reporting suite.")}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={BarChart3}
                title={t("Business Intelligence")}
                description={t("Sales, profit, stock and debt — all from the records.")}
            />

            <FinanceFilterBar
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(DEFAULT_FILTERS)}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="sales" className="rounded-lg text-sm font-bold">
                        {t("Sales")}
                    </TabsTrigger>
                    <TabsTrigger value="profit" className="rounded-lg text-sm font-bold">
                        {t("Profit")}
                    </TabsTrigger>
                    <TabsTrigger value="expenses" className="rounded-lg text-sm font-bold">
                        {t("Expenses")}
                    </TabsTrigger>
                    <TabsTrigger value="products" className="rounded-lg text-sm font-bold">
                        {t("Products")}
                    </TabsTrigger>
                    <TabsTrigger value="stock" className="rounded-lg text-sm font-bold">
                        {t("Stock value")}
                    </TabsTrigger>
                    <TabsTrigger value="people" className="rounded-lg text-sm font-bold">
                        {t("By cashier")}
                    </TabsTrigger>
                    <TabsTrigger value="branches" className="rounded-lg text-sm font-bold">
                        {t("By branch")}
                    </TabsTrigger>
                    <TabsTrigger value="methods" className="rounded-lg text-sm font-bold">
                        {t("Payment methods")}
                    </TabsTrigger>
                    <TabsTrigger value="receivables" className="rounded-lg text-sm font-bold">
                        {t("Customer debt")}
                    </TabsTrigger>
                    <TabsTrigger value="payables" className="rounded-lg text-sm font-bold">
                        {t("Supplier debt")}
                    </TabsTrigger>
                </TabsList>

                {/* ── Sales ─────────────────────────────────────────────── */}
                <TabsContent value="sales" className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {(["daily", "weekly", "monthly"] as const).map((p) => (
                            <Button
                                key={p}
                                size="sm"
                                variant={period === p ? "default" : "outline"}
                                onClick={() => setPeriod(p)}
                            >
                                {p[0].toUpperCase() + p.slice(1)}
                            </Button>
                        ))}
                        {sales && (
                            <div className="ml-auto">
                                <ExportMenu
                                    title={t("{0}-sales", {
            0: period,
        })}
                                    rows={sales.series as any[]}
                                    columns={SALES_COLUMNS}
                                    subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                />
                            </div>
                        )}
                    </div>

                    {sales ? (
                        <>
                            <StatStrip
                                stats={[
                                    { label: "Revenue", value: ugx(sales.totals.revenue) },
                                    {
                                        label: "Gross profit",
                                        value: ugx(sales.totals.grossProfit),
                                        tone: "good",
                                    },
                                    {
                                        label: "Transactions",
                                        value: String(sales.totals.transactions),
                                    },
                                    {
                                        label: "Average ticket",
                                        value: ugx(sales.totals.averageTicket),
                                    },
                                ]}
                            />
                            <Card>
                                <CardContent className="p-0">
                                    {sales.series.length === 0 ? (
                                        <EmptyState
                                            title={t("No sales in this period")}
                                            hint={t("Nothing was sold between these dates.")}
                                        />
                                    ) : (
                                        <ReportTable
                                            head={[
                                                "Period",
                                                "Revenue",
                                                "Cost",
                                                "Gross profit",
                                                "Sales",
                                                "Items",
                                                "Avg ticket",
                                            ]}
                                            rows={sales.series.map((row: any) => [
                                                row.period,
                                                number(row.revenue),
                                                number(row.cost),
                                                number(row.grossProfit),
                                                String(row.transactions),
                                                String(row.items),
                                                number(row.averageTicket),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Profit ────────────────────────────────────────────── */}
                <TabsContent value="profit" className="mt-4 space-y-4">
                    {profit ? (
                        <>
                            <StatStrip
                                stats={[
                                    { label: "Revenue", value: ugx(profit.revenue) },
                                    {
                                        label: "Gross profit",
                                        value: ugx(profit.grossProfit),
                                        tone: "good",
                                    },
                                    {
                                        label: "Running costs",
                                        value: ugx(profit.operatingExpenses),
                                        tone: "warn",
                                    },
                                    {
                                        label: "Net profit",
                                        value: ugx(profit.netProfit),
                                        tone: profit.netProfit >= 0 ? "good" : "danger",
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="text-base">
                                        {t("Profit and loss")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="profit-and-loss"
                                        rows={[
                                            { line: "Revenue", amount: profit.revenue },
                                            {
                                                line: "Cost of goods sold",
                                                amount: profit.costOfGoodsSold,
                                            },
                                            { line: "Gross profit", amount: profit.grossProfit },
                                            { line: "Other income", amount: profit.otherIncome },
                                            {
                                                line: "Running costs",
                                                amount: profit.operatingExpenses,
                                            },
                                            { line: "Net profit", amount: profit.netProfit },
                                        ]}
                                        columns={[
                                            { header: "Line", key: "line" },
                                            { header: "Amount", key: "amount", format: (v) => number(v) },
                                        ]}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Line label={t("Revenue")} value={ugx(profit.revenue)} />
                                    <Line
                                        label={t("Cost of the goods sold")}
                                        value={`− ${ugx(profit.costOfGoodsSold)}`}
                                    />
                                    <Line
                                        label={t("Gross profit")}
                                        value={ugx(profit.grossProfit)}
                                        strong
                                        hint={t("{0}% margin", {
            0: profit.grossMargin.toFixed(1),
        })}
                                    />
                                    <Line label={t("Other income")} value={ugx(profit.otherIncome)} />
                                    <Line
                                        label={t("Running costs")}
                                        value={`− ${ugx(profit.operatingExpenses)}`}
                                    />
                                    <div className="mt-3 flex items-center justify-between border-t pt-3 text-lg">
                                        <span className="font-semibold">{t("Net profit")}</span>
                                        <span
                                            className={`font-semibold tabular-nums ${profit.netProfit >= 0
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : "text-destructive"}`}
                                        >
                                            {ugx(profit.netProfit)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t("Net margin")} {profit.netMargin.toFixed(1)}% ·{" "}
                                        {profit.transactions} {t("transaction(s) ·")}{" "}
                                        {profit.itemsSold} {t("item(s) sold")}
                                    </p>
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Expenses ──────────────────────────────────────────── */}
                <TabsContent value="expenses" className="mt-4 space-y-4">
                    {expenses ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Total running costs",
                                        value: ugx(expenses.total),
                                        tone: "warn",
                                    },
                                    { label: "Entries", value: String(expenses.count) },
                                    {
                                        label: "Largest category",
                                        value: expenses.byType[0]?.type ?? "—",
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="text-base">{t("Running costs")}</CardTitle>
                                    <ExportMenu
                                        title="expenses"
                                        rows={(expenses.page ?? []) as any[]}
                                        columns={EXPENSE_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {expenses.page.length === 0 ? (
                                        <EmptyState title={t("No running costs")} hint={t("Nothing was recorded.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Date", "Type", "Expense", "Received by", "Amount"]}
                                            rows={expenses.page.map((row: any) => [
                                                date(row.date),
                                                row.type,
                                                row.expense,
                                                row.receivedBy,
                                                number(row.amount),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Products ──────────────────────────────────────────── */}
                <TabsContent value="products" className="mt-4 space-y-4">
                    {best && slow ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Units sold",
                                        value: String(best.totals.quantity),
                                    },
                                    {
                                        label: "Revenue",
                                        value: ugx(best.totals.revenue),
                                    },
                                    {
                                        label: "Gross profit",
                                        value: ugx(best.totals.grossProfit),
                                        tone: "good",
                                    },
                                    {
                                        label: "Money in dead stock",
                                        value: ugx(slow.totals.deadStockValue),
                                        tone: "warn",
                                    },
                                ]}
                            />

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                                        {t("Best sellers")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="best-selling-products"
                                        rows={(best.page ?? []) as any[]}
                                        columns={BEST_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {best.page.length === 0 ? (
                                        <EmptyState title={t("Nothing sold")} hint={t("No sales in this period.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Product", "Code", "Units", "Revenue", "Cost", "Gross profit", "Margin"]}
                                            rows={best.page.map((row: any) => [
                                                row.name,
                                                row.productCode || "—",
                                                String(row.quantity),
                                                number(row.revenue),
                                                number(row.cost),
                                                number(row.grossProfit),
                                                percent(row.margin),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <TrendingDown className="h-4 w-4 text-amber-600" />
                                        {t("Slow-moving stock")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="slow-moving-products"
                                        rows={(slow.page ?? []) as any[]}
                                        columns={SLOW_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {slow.page.length === 0 ? (
                                        <EmptyState
                                            title={t("No stock on the shelf")}
                                            hint={t("There is nothing sitting in stock.")}
                                        />
                                    ) : (
                                        <ReportTable
                                            head={["Product", "Code", "In stock", "Unit cost", "Stock value", "Sold in period", "Last sold"]}
                                            rows={slow.page.map((row: any) => [
                                                row.name,
                                                row.productCode || "—",
                                                String(row.qty),
                                                number(row.unitCost),
                                                number(row.stockValue),
                                                String(row.quantitySold),
                                                row.lastSaleDate ? date(row.lastSaleDate) : "never",
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Stock value ───────────────────────────────────────── */}
                <TabsContent value="stock" className="mt-4 space-y-4">
                    {valuation ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Value at cost",
                                        value: ugx(valuation.totals.costValue),
                                    },
                                    {
                                        label: "Value at the till",
                                        value: ugx(valuation.totals.retailValue),
                                    },
                                    {
                                        label: "Margin on the shelf",
                                        value: ugx(valuation.totals.marginValue),
                                        tone: "good",
                                    },
                                    { label: "Units", value: String(valuation.totals.units) },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Boxes className="h-4 w-4 text-muted-foreground" />
                                        {t("Stock valuation")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="stock-valuation"
                                        rows={(valuation.page ?? []) as any[]}
                                        columns={VALUATION_COLUMNS}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {valuation.page.length === 0 ? (
                                        <EmptyState title={t("No stock")} hint={t("Nothing to value.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Product", "Code", "Qty", "Unit cost", "Unit price", "Value at cost", "Value at retail"]}
                                            rows={valuation.page.map((row: any) => [
                                                row.name,
                                                row.productCode || "—",
                                                String(row.qty),
                                                number(row.unitCost),
                                                number(row.unitPrice),
                                                number(row.costValue),
                                                number(row.retailValue),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── By cashier ────────────────────────────────────────── */}
                <TabsContent value="people" className="mt-4 space-y-4">
                    {byCashier ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Revenue",
                                        value: ugx(byCashier.totals.revenue),
                                    },
                                    {
                                        label: "Gross profit",
                                        value: ugx(byCashier.totals.grossProfit),
                                        tone: "good",
                                    },
                                    {
                                        label: "Transactions",
                                        value: String(byCashier.totals.transactions),
                                    },
                                    {
                                        label: "Cashiers",
                                        value: String(byCashier.totalCount),
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        {t("Sales by cashier")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="sales-by-cashier"
                                        rows={(byCashier.page ?? []) as any[]}
                                        columns={CASHIER_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {byCashier.page.length === 0 ? (
                                        <EmptyState title={t("No sales")} hint={t("Nothing was sold in this period.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Cashier", "Sales", "Items", "Revenue", "Gross profit", "Avg ticket"]}
                                            rows={byCashier.page.map((row: any) => [
                                                row.name,
                                                String(row.transactions),
                                                String(row.items),
                                                number(row.revenue),
                                                number(row.grossProfit),
                                                number(row.averageTicket),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── By branch ─────────────────────────────────────────── */}
                <TabsContent value="branches" className="mt-4 space-y-4">
                    {byBranch ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Revenue",
                                        value: ugx(byBranch.totals.revenue),
                                    },
                                    {
                                        label: "Gross profit",
                                        value: ugx(byBranch.totals.grossProfit),
                                        tone: "good",
                                    },
                                    {
                                        label: "Transactions",
                                        value: String(byBranch.totals.transactions),
                                    },
                                    {
                                        label: "Branches trading",
                                        value: String(byBranch.totalCount),
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Building2 className="h-4 w-4 text-muted-foreground" />
                                        {t("Sales by branch")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="sales-by-branch"
                                        rows={(byBranch.page ?? []) as any[]}
                                        columns={BRANCH_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {byBranch.page.length === 0 ? (
                                        <EmptyState title={t("No sales")} hint={t("Nothing was sold in this period.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Branch", "Sales", "Revenue", "Cost", "Gross profit", "Avg ticket"]}
                                            rows={byBranch.page.map((row: any) => [
                                                row.name,
                                                String(row.transactions),
                                                number(row.revenue),
                                                number(row.cost),
                                                number(row.grossProfit),
                                                number(row.averageTicket),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Payment methods ──────────────────────────────────── */}
                <TabsContent value="methods" className="mt-4 space-y-4">
                    {methods ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Revenue",
                                        value: ugx(methods.totals.revenue),
                                    },
                                    {
                                        label: "Transactions",
                                        value: String(methods.totals.transactions),
                                    },
                                    {
                                        label: "Credit repaid",
                                        value: ugx(methods.totals.repaid),
                                    },
                                    {
                                        label: "Methods used",
                                        value: String(methods.totalCount),
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <PieChart className="h-4 w-4 text-muted-foreground" />
                                        {t("How the money came in")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="payment-method-analysis"
                                        rows={(methods.page ?? []) as any[]}
                                        columns={METHOD_COLUMNS}
                                        subtitle={t("{0} to {1}", {
            0: filters.from,
            1: filters.to,
        })}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {methods.page.length === 0 ? (
                                        <EmptyState title={t("No sales")} hint={t("Nothing was sold in this period.")} />
                                    ) : (
                                        <ReportTable
                                            head={["Method", "Sales", "Items", "Revenue", "Share", "Avg ticket", "Credit repaid"]}
                                            rows={methods.page.map((row: any) => [
                                                row.method,
                                                String(row.transactions),
                                                String(row.items),
                                                number(row.revenue),
                                                percent(row.share),
                                                number(row.averageTicket),
                                                number(row.repaid),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Customer debt ────────────────────────────────────── */}
                <TabsContent value="receivables" className="mt-4 space-y-4">
                    {customerDebt ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Total owed",
                                        value: ugx(customerDebt.totals.balance),
                                        tone: "warn",
                                    },
                                    {
                                        label: "Up to 30 days",
                                        value: ugx(customerDebt.totals.current),
                                    },
                                    {
                                        label: "31 to 60 days",
                                        value: ugx(customerDebt.totals.d30),
                                    },
                                    {
                                        label: "Over 90 days",
                                        value: ugx(customerDebt.totals.d90),
                                        tone: "danger",
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Banknote className="h-4 w-4 text-muted-foreground" />
                                        {t("Customer debt")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="customer-debt"
                                        rows={(customerDebt.page ?? []) as any[]}
                                        columns={CUSTOMER_DEBT_COLUMNS}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {customerDebt.page.length === 0 ? (
                                        <EmptyState
                                            title={t("Nobody owes anything")}
                                            hint={t("Every credit sale has been settled.")}
                                        />
                                    ) : (
                                        <ReportTable
                                            head={["Customer", "Phone", "Owed", "Limit", "Oldest", "Age (days)", "0-30", "31-60", "61-90", "90+"]}
                                            rows={customerDebt.page.map((row: any) => [
                                                row.name + (row.overLimit ? " ⚠" : ""),
                                                row.phone || "—",
                                                number(row.balance),
                                                row.creditLimit > 0 ? number(row.creditLimit) : "—",
                                                date(row.oldestDate),
                                                String(row.ageDays),
                                                number(row.buckets.current),
                                                number(row.buckets.d30),
                                                number(row.buckets.d60),
                                                number(row.buckets.d90),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>

                {/* ── Supplier debt ────────────────────────────────────── */}
                <TabsContent value="payables" className="mt-4 space-y-4">
                    {supplierDebt ? (
                        <>
                            <StatStrip
                                stats={[
                                    {
                                        label: "Total owed",
                                        value: ugx(supplierDebt.totals.balance),
                                        tone: "warn",
                                    },
                                    {
                                        label: "Charged",
                                        value: ugx(supplierDebt.totals.charged),
                                    },
                                    {
                                        label: "Paid",
                                        value: ugx(supplierDebt.totals.paid),
                                        tone: "good",
                                    },
                                    {
                                        label: "Suppliers",
                                        value: String(supplierDebt.totals.suppliers),
                                    },
                                ]}
                            />
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                                        {t("Supplier debt")}
                                    </CardTitle>
                                    <ExportMenu
                                        title="supplier-debt"
                                        rows={(supplierDebt.page ?? []) as any[]}
                                        columns={SUPPLIER_DEBT_COLUMNS}
                                    />
                                </CardHeader>
                                <CardContent className="p-0">
                                    {supplierDebt.page.length === 0 ? (
                                        <EmptyState
                                            title={t("Nothing owed")}
                                            hint={t("Every supplier invoice has been settled.")}
                                        />
                                    ) : (
                                        <ReportTable
                                            head={["Supplier", "Phone", "Charged", "Paid", "Owed", "Oldest"]}
                                            rows={supplierDebt.page.map((row: any) => [
                                                row.name,
                                                row.phone || "—",
                                                number(row.charged),
                                                number(row.paid),
                                                number(row.balance),
                                                date(row.oldestDate),
                                            ])}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                        <LoadingState />
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Building blocks
 * ──────────────────────────────────────────────────────────────────────── */

function Line({
    label,
    value,
    strong,
    hint,
}: {
    label: string;
    value: string;
    strong?: boolean;
    hint?: string;
}) {
    
    const t = useT();return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
                {label}
                {hint && <span className="ml-1 text-xs">({hint})</span>}
            </span>
            <span className={`font-bold tabular-nums ${strong ? "text-base" : ""}`}>
                {value}
            </span>
        </div>
    );
}

/**
 * A plain report table.
 *
 * Numbers are right-aligned so a column of figures can be read at a glance.
 */
function ReportTable({
    head,
    rows,
}: {
    head: string[];
    rows: (string | number)[][];
}) {
    
    const t = useT();return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead className="bg-muted/60">
                    <tr>
                        {head.map((h, i) => (
                            <th
                                key={h}
                                className={`px-3 py-2 font-bold ${i === 0 ? "text-left" : "text-right"}`}
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="border-t">
                            {row.map((cell, i) => (
                                <td
                                    key={i}
                                    className={`px-3 py-2 ${i === 0
                                            ? "text-left font-medium"
                                            : "text-right tabular-nums"}`}
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Export columns
 * ──────────────────────────────────────────────────────────────────────── */

const SALES_COLUMNS: ExportColumn[] = [
    { header: "Period", key: "period" },
    { header: "Revenue", key: "revenue", format: (v) => number(v) },
    { header: "Cost", key: "cost", format: (v) => number(v) },
    { header: "Gross profit", key: "grossProfit", format: (v) => number(v) },
    { header: "Transactions", key: "transactions" },
    { header: "Items", key: "items" },
    { header: "Average ticket", key: "averageTicket", format: (v) => number(v) },
];

const EXPENSE_COLUMNS: ExportColumn[] = [
    { header: "Date", key: "date", format: (v) => date(v) },
    { header: "Type", key: "type" },
    { header: "Expense", key: "expense" },
    { header: "Received by", key: "receivedBy" },
    { header: "Amount", key: "amount", format: (v) => number(v) },
];

const BEST_COLUMNS: ExportColumn[] = [
    { header: "Product", key: "name" },
    { header: "Code", key: "productCode" },
    { header: "Units sold", key: "quantity" },
    { header: "Revenue", key: "revenue", format: (v) => number(v) },
    { header: "Cost", key: "cost", format: (v) => number(v) },
    { header: "Gross profit", key: "grossProfit", format: (v) => number(v) },
    { header: "Margin", key: "margin", format: (v) => percent(v) },
];

const SLOW_COLUMNS: ExportColumn[] = [
    { header: "Product", key: "name" },
    { header: "Code", key: "productCode" },
    { header: "In stock", key: "qty" },
    { header: "Unit cost", key: "unitCost", format: (v) => number(v) },
    { header: "Stock value", key: "stockValue", format: (v) => number(v) },
    { header: "Sold in period", key: "quantitySold" },
    { header: "Last sold", key: "lastSaleDate", format: (v) => (v ? date(v) : "never") },
];

const VALUATION_COLUMNS: ExportColumn[] = [
    { header: "Product", key: "name" },
    { header: "Code", key: "productCode" },
    { header: "Qty", key: "qty" },
    { header: "Unit cost", key: "unitCost", format: (v) => number(v) },
    { header: "Unit price", key: "unitPrice", format: (v) => number(v) },
    { header: "Value at cost", key: "costValue", format: (v) => number(v) },
    { header: "Value at retail", key: "retailValue", format: (v) => number(v) },
];

const CASHIER_COLUMNS: ExportColumn[] = [
    { header: "Cashier", key: "name" },
    { header: "Transactions", key: "transactions" },
    { header: "Items", key: "items" },
    { header: "Revenue", key: "revenue", format: (v) => number(v) },
    { header: "Gross profit", key: "grossProfit", format: (v) => number(v) },
    { header: "Average ticket", key: "averageTicket", format: (v) => number(v) },
];

const BRANCH_COLUMNS: ExportColumn[] = [
    { header: "Branch", key: "name" },
    { header: "Transactions", key: "transactions" },
    { header: "Revenue", key: "revenue", format: (v) => number(v) },
    { header: "Cost", key: "cost", format: (v) => number(v) },
    { header: "Gross profit", key: "grossProfit", format: (v) => number(v) },
    { header: "Average ticket", key: "averageTicket", format: (v) => number(v) },
];

const METHOD_COLUMNS: ExportColumn[] = [
    { header: "Method", key: "method" },
    { header: "Transactions", key: "transactions" },
    { header: "Items", key: "items" },
    { header: "Revenue", key: "revenue", format: (v) => number(v) },
    { header: "Share", key: "share", format: (v) => percent(v) },
    { header: "Average ticket", key: "averageTicket", format: (v) => number(v) },
    { header: "Credit repaid", key: "repaid", format: (v) => number(v) },
];

const CUSTOMER_DEBT_COLUMNS: ExportColumn[] = [
    { header: "Customer", key: "name" },
    { header: "Phone", key: "phone" },
    { header: "Owed", key: "balance", format: (v) => number(v) },
    { header: "Credit limit", key: "creditLimit", format: (v) => number(v) },
    { header: "Oldest debt", key: "oldestDate", format: (v) => date(v) },
    { header: "Age (days)", key: "ageDays" },
    { header: "0-30 days", key: "current", format: (v) => number(v) },
    { header: "31-60 days", key: "d30", format: (v) => number(v) },
    { header: "61-90 days", key: "d60", format: (v) => number(v) },
    { header: "Over 90 days", key: "d90", format: (v) => number(v) },
];

const SUPPLIER_DEBT_COLUMNS: ExportColumn[] = [
    { header: "Supplier", key: "name" },
    { header: "Phone", key: "phone" },
    { header: "Charged", key: "charged", format: (v) => number(v) },
    { header: "Paid", key: "paid", format: (v) => number(v) },
    { header: "Owed", key: "balance", format: (v) => number(v) },
    { header: "Oldest", key: "oldestDate", format: (v) => date(v) },
];
