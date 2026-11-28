"use client";

/**
 * SMART_BUZ — Category Dashboard Widgets
 *
 * Each vertical gets its own set of operational widgets. A pharmacy tracks
 * expiring stock; a restaurant tracks tables and open tabs; a school tracks
 * enrolment and fee arrears; a fuel station tracks litres and attendant
 * reconciliation.
 *
 * Widgets are opt-in per category via the `features` array in the catalog.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    AlertTriangle,
    CalendarClock,
    Clock,
    Droplets,
    Fuel,
    GraduationCap,
    Package,
    Scissors,
    TrendingUp,
    Users,
    Wallet,
    Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BusinessCategory } from "@/lib/business-categories";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";
import { useAuth } from "@/context/auth-context";

function WidgetShell({
    title,
    icon: Icon,
    children,
    action,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 text-primary" />
                    {title}
                </CardTitle>
                {action}
            </CardHeader>
            <CardContent className="pt-0">{children}</CardContent>
        </Card>
    );
}

function StatTile({
    label,
    value,
    tone = "default",
}: {
    label: string;
    value: string | number;
    tone?: "default" | "warn" | "danger" | "good";
}) {
    const tones = {
        default: "text-foreground",
        warn: "text-amber-600 dark:text-amber-400",
        danger: "text-red-600 dark:text-red-400",
        good: "text-emerald-600 dark:text-emerald-400",
    };
    return (
        <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">
                {label}
            </p>
            <p className={cn("mt-1 text-xl font-semibold tabular-nums", tones[tone])}>{value}</p>
        </div>
    );
}

/* ─────────────────────── Expiry / batch widget ─────────────────────── */

function ExpiryWidget() {
    
    const t = useT();const { currency } = useCurrency();
    const summary = useQuery(api.verticals.batches.getExpirySummary, { withinDays: 30 });

    if (!summary) {
        return (
            <WidgetShell title={t("Expiry Watch")} icon={AlertTriangle}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    return (
        <WidgetShell
            title={t("Expiry Watch (30 days)")}
            icon={AlertTriangle}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/batches?view=expiry">{t("View all")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-3 gap-2">
                <StatTile label={t("Expired")} value={summary.expired} tone="danger" />
                <StatTile label={t("Expiring")} value={summary.expiring} tone="warn" />
                <StatTile
                    label={t("Value at risk")}
                    value={`${currency} ${summary.expiringValue.toLocaleString()}`}
                    tone="warn"
                />
            </div>
            {summary.soon.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {summary.soon.slice(0, 4).map((b: any) => (
                        <li
                            key={b._id}
                            className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                        >
                            <span className="truncate font-semibold">{b.productName}</span>
                            <Badge
                                variant={b.daysToExpiry < 0 ? "destructive" : "outline"}
                                className="ml-2 shrink-0 text-xs"
                            >
                                {b.daysToExpiry < 0
                                    ? "Expired"
                                    : `${b.daysToExpiry}d left`}
                            </Badge>
                        </li>
                    ))}
                </ul>
            )}
            {summary.soon.length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                    {t("No stock is expiring in the next 30 days.")}
                </p>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Schedule widget ─────────────────────── */

function ScheduleWidget({ category }: { category: BusinessCategory }) {
    
    const t = useT();const summary = useQuery(api.verticals.scheduling.getScheduleSummary, {});
    const isRooms = category.modules.includes("rooms");
    const isTables = category.modules.includes("tables");

    if (!summary) {
        return (
            <WidgetShell title={t("Today's Schedule")} icon={CalendarClock}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    return (
        <WidgetShell
            title={isRooms ? "Rooms Today" : isTables ? "Service Floor" : "Today's Bookings"}
            icon={isRooms ? Boxes : CalendarClock}
        >
            <div className="grid grid-cols-3 gap-2">
                <StatTile label={t("Total")} value={summary.total} />
                <StatTile label={t("Confirmed")} value={summary.confirmed} tone="good" />
                <StatTile label={t("Pending")} value={summary.pending} tone="warn" />
            </div>
            {(isRooms || isTables) && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <StatTile label={t("Total")} value={summary.outletsTotal} />
                    <StatTile label={t("Free")} value={summary.outletsAvailable} tone="good" />
                    <StatTile label={t("In use")} value={summary.outletsOccupied} tone="warn" />
                </div>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Members widget ─────────────────────── */

function MembersWidget({ category }: { category: BusinessCategory }) {
    
    const t = useT();const { currency } = useCurrency();
    const summary = useQuery(api.verticals.members.getMembersSummary, {});
    const isMoney = ["sacco", "realestate", "church", "ngo"].includes(category.id);

    if (!summary) {
        return (
            <WidgetShell title={t("Members")} icon={Users}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    return (
        <WidgetShell
            title={isMoney ? "Member Accounts" : "Members"}
            icon={Users}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/members">{t("Manage")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-3 gap-2">
                <StatTile label={t("Total")} value={summary.totalMembers} />
                <StatTile label={t("Active")} value={summary.activeMembers} tone="good" />
                <StatTile
                    label={isMoney ? "Total Balance" : "Avg Balance"}
                    value={
                        isMoney
                            ? `${currency} ${summary.totalBalance.toLocaleString()}`
                            : Math.round(summary.averageBalance).toLocaleString()
                    }
                    tone="good"
                />
            </div>
        </WidgetShell>
    );
}

/* ─────────────────────── Fuel widget ─────────────────────── */

function FuelWidget() {
    
    const t = useT();const { currency } = useCurrency();
    const summary = useQuery(api.verticals.operations.getFuelSummary, {});

    if (!summary) {
        return (
            <WidgetShell title={t("Fuel Dispensing")} icon={Fuel}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    return (
        <WidgetShell
            title={t("Fuel Dispensing")}
            icon={Fuel}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/fuel">{t("Pumps")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <StatTile label={t("Litres Sold")} value={summary.totalLitres.toFixed(1)} />
                <StatTile
                    label={t("Revenue")}
                    value={`${currency} ${summary.totalRevenue.toLocaleString()}`}
                    tone="good"
                />
            </div>
            {Object.keys(summary.byType).length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {Object.entries(summary.byType).map(([type, v]: any) => (
                        <li
                            key={type}
                            className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                        >
                            <span className="font-semibold capitalize">{type}</span>
                            <span className="tabular-nums text-muted-foreground">
                                {v.litres.toFixed(1)} {t("L ·")} {currency} {v.revenue.toLocaleString()}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Service jobs widget ─────────────────────── */

function ServiceJobsWidget() {
    
    const tr = useT();const tickets = useQuery(api.verticals.operations.listServiceTickets, { limit: 50 });

    if (!tickets) {
        return (
            <WidgetShell title={tr("Service Jobs")} icon={Scissors}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    const open = tickets.filter((t: any) => t.status !== "delivered" && t.status !== "cancelled");
    const byStatus = open.reduce((acc: Record<string, number>, t: any) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
    }, {});

    return (
        <WidgetShell
            title={tr("Service Jobs")}
            icon={Scissors}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/service-tickets">{tr("Open")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <StatTile label={tr("Open Jobs")} value={open.length} />
                <StatTile label={tr("Total Tickets")} value={tickets.length} />
            </div>
            {open.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {open.slice(0, 4).map((t: any) => (
                        <li
                            key={t._id}
                            className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                        >
                            <span className="truncate font-semibold">
                                {t.ticketNumber} · {t.customerName}
                            </span>
                            <Badge variant="outline" className="ml-2 shrink-0 text-xs capitalize">
                                {t.status.replace("_", " ")}
                            </Badge>
                        </li>
                    ))}
                </ul>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Stock value widget ─────────────────────── */

function StockValueWidget({ category }: { category: BusinessCategory }) {
    
    const t = useT();const { currency } = useCurrency();
    const stats = useQuery(api.stocks.getInventoryStats, {});

    if (!stats) {
        return (
            <WidgetShell title={t("Stock Position")} icon={Package}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    const unit = category.units.default;

    return (
        <WidgetShell
            title={t("Stock Position")}
            icon={Package}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/inventory">{t("Details")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <StatTile label={t("Total {0}s", {
            0: unit,
        })} value={stats.totalItems} />
                <StatTile
                    label={t("Stock Value")}
                    value={`${currency} ${stats.totalSellValue.toLocaleString()}`}
                    tone="good"
                />
            </div>
            {stats.outOfStockCount > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {stats.outOfStockCount} {t("item(s) out of stock")}
                </p>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Till widget ─────────────────────── */

function TillWidget() {
    
    const t = useT();const { currency } = useCurrency();
    const sessions = useQuery(api.verticals.operations.listTillSessions, {
        status: "open",
        limit: 20,
    });

    if (!sessions) {
        return (
            <WidgetShell title={t("Open Tills")} icon={Wallet}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    const variances = sessions.filter((s: any) => s.variance !== undefined);

    return (
        <WidgetShell
            title={t("Cash Reconciliation")}
            icon={Wallet}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/till">{t("Tills")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <StatTile label={t("Open Sessions")} value={sessions.length} />
                <StatTile
                    label={t("Cash Variance")}
                    value={
                        variances.length === 0
                            ? "—"
                            : `${currency} ${variances
                                  .reduce((s: number, v: any) => s + (v.variance ?? 0), 0)
                                  .toLocaleString()}`
                    }
                    tone={variances.some((v: any) => (v.variance ?? 0) < 0) ? "danger" : "good"}
                />
            </div>
            {sessions.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {sessions.slice(0, 3).map((s: any) => (
                        <li
                            key={s._id}
                            className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                        >
                            <span className="truncate font-semibold">{s.userName}</span>
                            <span className="ml-2 shrink-0 text-muted-foreground">
                                {t("Float")} {currency} {s.openingFloat.toLocaleString()}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Enrolment widget ─────────────────────── */

function EnrolmentWidget() {
    
    const t = useT();const { currency } = useCurrency();
    const enrolments = useQuery(api.verticals.operations.listEnrolments, {});
    const attendance = useQuery(api.verticals.operations.listAttendance, {});

    if (!enrolments) {
        return (
            <WidgetShell title={t("Enrolment")} icon={GraduationCap}>
                <Skeleton className="h-24 w-full" />
            </WidgetShell>
        );
    }

    const due = enrolments.reduce((s: number, e: any) => s + ((e.amountDue ?? 0) - (e.amountPaid ?? 0)), 0);

    return (
        <WidgetShell
            title={t("Students & Fees")}
            icon={GraduationCap}
            action={
                <Button variant="ghost" size="sm" asChild>
                    <a href="/classes">{t("Manage")}</a>
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                <StatTile label={t("Enrolled")} value={enrolments.length} />
                <StatTile
                    label={t("Fees Outstanding")}
                    value={`${currency} ${Math.max(0, due).toLocaleString()}`}
                    tone={due > 0 ? "warn" : "good"}
                />
            </div>
            {attendance && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <StatTile label={t("Present Today")} value={attendance.present} tone="good" />
                    <StatTile label={t("Attendance")} value={`${attendance.attendanceRate}%`} />
                </div>
            )}
        </WidgetShell>
    );
}

/* ─────────────────────── Top products widget ─────────────────────── */

function TopProductsWidget({ category }: { category: BusinessCategory }) {
    
    const t = useT();const { currency } = useCurrency();
    const { can } = useAuth();

    /*
     * The report behind this widget needs the reports permission, and a role
     * that does not have it — a cashier, for one — must not ask for it. The
     * server refuses the query, and the refusal arrives as an error on the
     * dashboard for a person who is allowed to be there. So the question is
     * only asked of the roles that may answer it.
     */
    const canViewReports = can("finance.reports.view");

    /**
     * The report window is "the last 30 days", worked out once when the
     * widget mounts.
     *
     * It must not be worked out again on every render. Convex keys a query
     * subscription on the JSON of its arguments, so an argument that changes
     * on every render means a new subscription every render — and the new
     * subscription re-renders the widget, which takes a new timestamp, which
     * makes a new subscription. React finally stops it with "Maximum update
     * depth exceeded".
     */
    const reportArgs = useMemo(
        () => {
            const end = new Date();
            const start = new Date(end);
            start.setDate(start.getDate() - 30);
            return {
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                limit: 5,
            };
        },
        []
    );

    const report = useQuery(
        api.reports.getProductPerformanceReport,
        canViewReports ? reportArgs : "skip"
    );

    if (!canViewReports || !report || report.length === 0) {
        return null;
    }

    return (
        <WidgetShell
            title={t("Top {0}s (30d)", {
            0: category.terminology.item,
        })}
            icon={TrendingUp}
        >
            <ul className="space-y-1.5">
                {report.slice(0, 5).map((p: any, i: number) => (
                    <li
                        key={p._id ?? i}
                        className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">
                                {i + 1}
                            </span>
                            <span className="truncate font-semibold">
                                {p.productName ?? p.name}
                            </span>
                        </span>
                        <span className="ml-2 shrink-0 tabular-nums font-bold">
                            {currency} {(p.totalRevenue ?? p.revenue ?? 0).toLocaleString()}
                        </span>
                    </li>
                ))}
            </ul>
        </WidgetShell>
    );
}

/* ─────────────────────── Widget selection ─────────────────────── */

/**
 * Build the widget list for a category.
 * The order is deliberate: the most operationally urgent widget comes first.
 */
export function widgetsForCategory(category: BusinessCategory): Array<{
    key: string;
    render: () => React.ReactNode;
}> {
    const widgets: Array<{ key: string; render: () => React.ReactNode }> = [];
    const f = category.features;

    if (f.includes("expiryAlerts")) {
        widgets.push({ key: "expiry", render: () => <ExpiryWidget /> });
    }
    if (f.includes("appointmentBooking") || category.modules.includes("appointments")) {
        widgets.push({ key: "schedule", render: () => <ScheduleWidget category={category} /> });
    }
    if (f.includes("memberAccounts") || category.modules.includes("members")) {
        widgets.push({ key: "members", render: () => <MembersWidget category={category} /> });
    }
    if (f.includes("fuelDispensing")) {
        widgets.push({ key: "fuel", render: () => <FuelWidget /> });
    }
    if (f.includes("serviceTickets")) {
        widgets.push({ key: "jobs", render: () => <ServiceJobsWidget /> });
    }
    if (f.includes("studentFees") || category.modules.includes("classes")) {
        widgets.push({ key: "enrolment", render: () => <EnrolmentWidget /> });
    }
    if (f.includes("assetRegister") || category.modules.includes("assets")) {
        widgets.push({ key: "stock", render: () => <StockValueWidget category={category} /> });
    }
    if (category.modules.includes("stock") || category.modules.includes("inventory")) {
        widgets.push({ key: "stock2", render: () => <StockValueWidget category={category} /> });
    }
    widgets.push({ key: "till", render: () => <TillWidget /> });
    widgets.push({ key: "top", render: () => <TopProductsWidget category={category} /> });

    // De-duplicate by key so a category with two stock-ish features does not
    // render the same widget twice.
    const seen = new Set<string>();
    return widgets.filter((w) => {
        if (seen.has(w.key)) return false;
        seen.add(w.key);
        return true;
    });
}

/** Grid of category-specific widgets. */
export function CategoryWidgets({ category }: { category: BusinessCategory }) {
    const widgets = widgetsForCategory(category);
    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {widgets.map((w) => (
                <div key={w.key}>{w.render()}</div>
            ))}
        </div>
    );
}
