"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { SearchableSelect } from "./SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useT } from "@/i18n/provider";

export function ShopIssuedReport() {
    
    const t = useT();const [issuedReportMode, setIssuedReportMode] = useState<"daily" | "range">("range");
    const [issuedDateRange, setIssuedDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd"),
    });
    const [issuedShop, setIssuedShop] = useState<string>("all");
    const [issuedType, setIssuedType] = useState<"all" | "regular" | "hp">("all");
    const [issuedSearch, setIssuedSearch] = useState("");

    const shops = useQuery(api.shops.listAll, {});

    const issueRecords = useQuery(api.stocks.getShopIssueRecords, {
        shopId: issuedShop === "all" ? undefined : (issuedShop as Id<"shops">),
        from: issuedDateRange.from,
        to: issuedDateRange.to,
        searchTerm: issuedSearch || undefined,
    });

    const filteredRecords = (issueRecords || []).filter((r) => {
        if (issuedType === "regular") return !r.halfPrice;
        if (issuedType === "hp") return r.halfPrice;
        return true;
    });

    const totalQty = filteredRecords.reduce((sum, r) => sum + r.quantity, 0);
    const uniqueProducts = new Set(filteredRecords.map((r) => r.stockId)).size;

    return (
        <div className="space-y-6">
            {/* ISSUED STOCK FILTERS */}
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                <ReportFilters
                    dateRange={issuedDateRange}
                    reportMode={issuedReportMode}
                    onDateRangeChange={setIssuedDateRange}
                    onReportModeChange={setIssuedReportMode}
                    onClearFilters={() => {
                        setIssuedDateRange({
                            from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                            to: format(new Date(), "yyyy-MM-dd"),
                        });
                        setIssuedReportMode("range");
                        setIssuedShop("all");
                        setIssuedType("all");
                        setIssuedSearch("");
                    }}
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Branches" },
                        ...(shops || []).map((s) => ({ value: s._id, label: s.name })),
                    ]}
                    value={issuedShop}
                    onValueChange={setIssuedShop}
                    placeholder={t("Select Branch")}
                    width="200px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Stock Types" },
                        { value: "regular", label: "Regular Stock" },
                        { value: "hp", label: "HP Stock (Half Price)" },
                    ]}
                    value={issuedType}
                    onValueChange={(val: any) => setIssuedType(val)}
                    placeholder={t("Stock Type")}
                    width="180px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                    <Input
                        placeholder={t("Search by product name or code...")}
                        value={issuedSearch}
                        onChange={(e) => setIssuedSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-emerald-50 border-emerald-100 shadow-sm p-4 rounded-xl border-l-4 border-l-emerald-600">
                    <div className="text-emerald-700 mb-1 font-mono text-eyebrow uppercase tracking-eyebrow">
                        {t("Total Quantity Issued")}
                    </div>
                    <div className="text-2xl font-semibold text-emerald-800">
                        {totalQty.toLocaleString()}
                    </div>
                    <div className="text-emerald-600/70 mt-0.5 text-eyebrow uppercase tracking-eyebrow">
                        {t("Physical items sent to branch")}
                    </div>
                </Card>

                <Card className="bg-blue-50 border-blue-100 shadow-sm p-4 rounded-xl border-l-4 border-l-blue-600">
                    <div className="text-blue-700 mb-1 font-mono text-eyebrow uppercase tracking-eyebrow">
                        {t("No. of Different Products")}
                    </div>
                    <div className="text-2xl font-semibold text-blue-800">
                        {uniqueProducts.toLocaleString()}
                    </div>
                    <div className="text-blue-600/70 mt-0.5 text-eyebrow uppercase tracking-eyebrow">
                        {t("Unique product lines")}
                    </div>
                </Card>
            </div>

            {/* TABLE */}
            <ReportTable
                title={
                    issuedShop === "all"
                        ? "Branch Stock Issue Log"
                        : `${shops?.find((s) => String(s._id) === issuedShop)?.name} - Issue Audit`
                }
                subtitle={t("Audit trail of {0} stock transferred from HQ", {
            0: issuedType !== "all" ? issuedType.toUpperCase() : "all",
        })}
                data={filteredRecords}
                isLoading={issueRecords === undefined}
                variant="overview"
                columns={[
                    {
                        header: "Date/Time",
                        accessor: (r: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-semibold">{format(new Date(r.date), "dd MMM yyyy")}</div>
                                <div className="text-xs text-muted-foreground">{format(new Date(r.date), "HH:mm")}</div>
                            </div>
                        ),
                    },
                    {
                        header: "Branch",
                        accessor: (r: any) => (
                            <div className="flex items-center gap-2 font-semibold text-primary">
                                <Store className="h-3 w-3 opacity-50" />
                                {r.shopName}
                            </div>
                        ),
                    },
                    {
                        header: "Product",
                        accessor: (r: any) => (
                            <div className="flex flex-col">
                                <span className="text-xs font-semibold flex items-center gap-1">
                                    {r.stockName}
                                    {r.halfPrice && (
                                        <Badge
                                            variant="outline"
                                            className="text-xs h-3.5 px-1 bg-amber-50 text-amber-700 border-amber-200"
                                        >
                                            {t("HP")}
                                        </Badge>
                                    )}
                                </span>
                                <span className="text-muted-foreground font-mono leading-none tracking-tighter text-eyebrow uppercase tracking-eyebrow">
                                    {r.productCode}
                                </span>
                            </div>
                        ),
                    },
                    {
                        header: "Qty Issued",
                        accessor: (r: any) => (
                            <Badge
                                variant="secondary"
                                className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold h-5"
                            >
                                {r.quantity}
                            </Badge>
                        ),
                        className: "text-center",
                    },
                    {
                        header: "Issued By",
                        accessor: "userName",
                        className: "text-right text-xs font-bold text-muted-foreground",
                    },
                ]}
            />
        </div>
    );
}
