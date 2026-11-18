"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CalendarRange, RotateCcw, Building2 } from "lucide-react";

/**
 * The filters every finance report and dashboard shares: a date range and
 * an optional branch.
 *
 * The same filters everywhere means two reports can be compared with each
 * other — a daily sales report for this branch against a profit and loss
 * for the whole business is not a comparison, it is a mistake waiting to
 * happen.
 */
export interface FinanceFilters {
    from: string;
    to: string;
    branchId?: Id<"branches">;
}

export function FinanceFilterBar({
    filters,
    onChange,
    onReset,
    showBranch = true,
    className,
}: {
    filters: FinanceFilters;
    onChange: (filters: FinanceFilters) => void;
    onReset?: () => void;
    showBranch?: boolean;
    className?: string;
}) {
    const branches = useQuery(api.branches.list, {});

    return (
        <div
            className={`flex flex-wrap items-end gap-3 rounded-xl border bg-muted/20 p-3 shadow-sm print:hidden ${className ?? ""}`}
        >
            <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    <CalendarRange className="h-3.5 w-3.5" />
                    From
                </Label>
                <Input
                    type="date"
                    value={filters.from}
                    onChange={(e) => onChange({ ...filters, from: e.target.value })}
                    className="h-9 w-[150px] text-xs"
                    aria-label="From date"
                />
            </div>

            <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    To
                </Label>
                <Input
                    type="date"
                    value={filters.to}
                    onChange={(e) => onChange({ ...filters, to: e.target.value })}
                    className="h-9 w-[150px] text-xs"
                    aria-label="To date"
                />
            </div>

            {showBranch && (
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        Branch
                    </Label>
                    <select
                        value={filters.branchId ?? ""}
                        onChange={(e) =>
                            onChange({
                                ...filters,
                                branchId: (e.target.value || undefined) as
                                    | Id<"branches">
                                    | undefined,
                            })
                        }
                        className="flex h-9 w-[190px] rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        <option value="">All branches</option>
                        {(branches ?? []).map((branch: any) => (
                            <option key={branch._id} value={branch._id}>
                                {branch.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {onReset && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReset}
                    className="h-9 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset
                </Button>
            )}
        </div>
    );
}
