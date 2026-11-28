"use client";

/**
 * SMARTBUZ — the plan picker.
 *
 * Shows the plans on offer and lets one be chosen. Used in two places:
 *
 *   • the setup wizard, where choosing a plan starts the free trial;
 *   • the subscription page, where choosing a plan changes it.
 *
 * The prices shown come from the `plans` table, read by the backend. The
 * browser never decides what a plan costs, and the choice is only a request
 * — the server checks the plan exists, is on offer, and applies it.
 */

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

export interface PlanOption {
    key: string;
    name: string;
    description?: string;
    priceMonthly: number;
    priceAnnual: number;
    currency: string;
    trialDays: number;
    gracePeriodDays: number;
    deviceLimit: number;
    maxUsers: number;
    maxBranches: number;
    maxWarehouses: number;
    maxProducts: number;
    features: string[];
    isActive: boolean;
    sortOrder: number;
}

/** Format an amount in the plan's own currency. */
export function planPrice(plan: PlanOption, cycle: "monthly" | "annual"): string {
    const amount = cycle === "annual" ? plan.priceAnnual : plan.priceMonthly;
    return `${plan.currency} ${Math.round(amount).toLocaleString("en-UG")}`;
}

/** "3 branches" / "Unlimited" — the limit a plan places on one thing. */
function limitLabel(limit: number, singular: string, plural?: string): string {
    if (!limit || limit <= 0) return "Unlimited";
    return `${limit} ${limit === 1 ? singular : plural ?? `${singular}s`}`;
}

export function PlanPicker({
    selected,
    onSelect,
    cycle,
    onCycleChange,
    currentPlanKey,
    className,
}: {
    selected?: string | null;
    onSelect: (planKey: string) => void;
    cycle?: "monthly" | "annual";
    onCycleChange?: (cycle: "monthly" | "annual") => void;
    currentPlanKey?: string | null;
    className?: string;
}) {
    
    const t = useT();const plans = useQuery(api.plans.list, {});
    const entitlements = useQuery(api.plans.listEntitlements, {});

    const labels = new Map<string, { label: string; group: string }>(
        (entitlements ?? []).map((e) => [e.key, { label: e.label, group: e.group }])
    );

    const billingCycle = cycle ?? "monthly";

    if (!plans) {
        return (
            <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-64 animate-pulse rounded-xl border bg-muted/40" />
                ))}
            </div>
        );
    }

    if (plans.length === 0) {
        return (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("No plans are on offer at the moment. Please contact SMARTBUZ.")}
            </p>
        );
    }

    return (
        <div className={cn("space-y-4", className)}>
            {onCycleChange && (
                <div className="flex items-center gap-2">
                    {(["monthly", "annual"] as const).map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => onCycleChange(c)}
                            className={cn(
                                "rounded-full px-4 py-1.5 text-xs font-bold capitalize transition-colors",
                                billingCycle === c
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                            )}
                        >
                            {c}
                        </button>
                    ))}
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan) => {
                    const isSelected = selected === plan.key;
                    const isCurrent = currentPlanKey === plan.key;

                    return (
                        <Card
                            key={plan.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelect(plan.key)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onSelect(plan.key);
                                }
                            }}
                            className={cn(
                                "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                isSelected && "border-primary shadow-lg ring-2 ring-primary/30"
                            )}
                        >
                            <CardContent className="space-y-3 p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-base font-semibold leading-tight">
                                            {plan.name}
                                        </p>
                                        {plan.description && (
                                            <p className="mt-1 text-xs leading-snug text-muted-foreground">
                                                {t(plan.description)}
                                            </p>
                                        )}
                                    </div>
                                    {isCurrent && (
                                        <Badge
                                            variant="outline"
                                            className="shrink-0 border-primary/30 bg-primary/10 text-xs font-bold text-primary"
                                        >
                                            {t("Current")}
                                        </Badge>
                                    )}
                                </div>

                                <div>
                                    <p className="text-xl font-semibold tabular-nums">
                                        {planPrice(plan, billingCycle)}
                                    </p>
                                    <p className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">
                                        per {billingCycle === "annual" ? "year" : "month"}
                                        {billingCycle === "annual" && (
                                            <span className="ml-1 normal-case text-emerald-600">
                                                save{" "}
                                                {Math.round(
                                                    (1 -
                                                        plan.priceAnnual /
                                                            Math.max(
                                                                1,
                                                                plan.priceMonthly * 12
                                                            )) *
                                                        100
                                                )}
                                                %
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {plan.trialDays > 0 && (
                                    <p className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                        {plan.trialDays}-day free trial
                                    </p>
                                )}

                                <ul className="space-y-1 text-xs text-muted-foreground">
                                    <li>
                                        • {limitLabel(plan.maxUsers, "staff account")}
                                    </li>
                                    <li>
                                        • {limitLabel(plan.maxBranches, "branch", "branches")}
                                    </li>
                                    <li>
                                        • {limitLabel(
                                            plan.maxWarehouses,
                                            "warehouse",
                                            "warehouses"
                                        )}
                                    </li>
                                    <li>
                                        • {limitLabel(plan.deviceLimit, "device")}
                                    </li>
                                </ul>

                                <div className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                                    {plan.features.slice(0, 6).map((f) => (
                                        <p key={f} className="flex items-start gap-1">
                                            <Check className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-600" />
                                            {labels.get(f)?.label ?? f}
                                        </p>
                                    ))}
                                    {plan.features.length > 6 && (
                                        <p className="pl-3.5">
                                            +{plan.features.length - 6} more
                                        </p>
                                    )}
                                </div>

                                {isSelected && (
                                    <div className="flex items-center gap-1 text-xs font-bold text-primary">
                                        <Check className="h-3.5 w-3.5" /> {t("Selected")}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
