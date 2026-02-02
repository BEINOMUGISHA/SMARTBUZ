"use client";

import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRange {
    from: string;
    to: string;
}

interface ReportFiltersProps {
    dateRange: DateRange;
    reportMode: "daily" | "range";
    onDateRangeChange: (range: DateRange) => void;
    onReportModeChange: (mode: "daily" | "range") => void;
    showDailyAudit?: boolean;
}

export function ReportFilters({
    dateRange,
    reportMode,
    onDateRangeChange,
    onReportModeChange,
    showDailyAudit = true,
}: ReportFiltersProps) {
    const handleSingleDayChange = (date: Date | undefined) => {
        if (date) {
            const formatted = format(date, "yyyy-MM-dd");
            onDateRangeChange({ from: formatted, to: formatted });
            onReportModeChange("daily");
        }
    };

    const handleRangeChange = (type: "from" | "to", date: Date | undefined) => {
        if (date) {
            const formatted = format(date, "yyyy-MM-dd");
            onDateRangeChange({ ...dateRange, [type]: formatted });
            onReportModeChange("range");
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3 bg-white/50 p-2 rounded-xl border border-muted shadow-xs print:hidden">
            {showDailyAudit && (
                <div className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={cn(
                                    "h-8 px-3 text-[10px] font-black uppercase tracking-wider border-2 transition-all",
                                    reportMode === "daily" ? "border-primary bg-primary/5 text-primary" : "border-muted/20"
                                )}
                            >
                                <CalendarIcon className="mr-1.5 h-3 w-3 opacity-50" />
                                {reportMode === "daily" ? format(parseISO(dateRange.from), "dd MMM yyyy") : "Daily Audit"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                mode="single"
                                selected={parseISO(dateRange.from)}
                                onSelect={handleSingleDayChange}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                    <div className="h-4 w-px bg-muted mx-1" />
                </div>
            )}

            <div className="flex items-center gap-1.5">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "h-8 w-[110px] justify-start text-[10px] font-bold border transition-all",
                                reportMode === "range" ? "border-muted-foreground/30 bg-muted/5" : "border-muted/10 opacity-60"
                            )}
                        >
                            {format(parseISO(dateRange.from), "dd MMM yy")}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={parseISO(dateRange.from)}
                            onSelect={(d) => handleRangeChange("from", d)}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>

                <ArrowRight className="h-3 w-3 text-muted-foreground opacity-50" />

                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "h-8 w-[110px] justify-start text-[10px] font-bold border transition-all",
                                reportMode === "range" ? "border-muted-foreground/30 bg-muted/5" : "border-muted/10 opacity-60"
                            )}
                        >
                            {format(parseISO(dateRange.to), "dd MMM yy")}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={parseISO(dateRange.to)}
                            onSelect={(d) => handleRangeChange("to", d)}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </div>

            <div className="ml-auto px-3 h-8 flex items-center bg-muted/30 rounded-lg">
                <span className="text-[10px] font-black text-muted-foreground uppercase italic tracking-tighter">
                    {reportMode === "daily"
                        ? format(parseISO(dateRange.from), "MMMM dd, yyyy")
                        : `${format(parseISO(dateRange.from), "MMM dd")} - ${format(parseISO(dateRange.to), "MMM dd, yyyy")}`
                    }
                </span>
            </div>
        </div>
    );
}
