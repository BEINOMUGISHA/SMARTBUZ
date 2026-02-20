import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { cn } from "@/lib/utils";
import { DateRange as DayPickerDateRange } from "react-day-picker";

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
    onClearFilters?: () => void;
}

export function ReportFilters({
    dateRange,
    reportMode,
    onDateRangeChange,
    onReportModeChange,
    showDailyAudit = true,
    onClearFilters,
}: ReportFiltersProps) {
    const handleDailySelect = (date: Date | undefined) => {
        if (date) {
            const formatted = format(date, "yyyy-MM-dd");
            onDateRangeChange({ from: formatted, to: formatted });
        }
    };

    const handleRangeSelect = (range: DayPickerDateRange | undefined) => {
        if (range?.from) {
            onDateRangeChange({
                from: format(range.from, "yyyy-MM-dd"),
                to: range.to ? format(range.to, "yyyy-MM-dd") : format(range.from, "yyyy-MM-dd")
            });
        }
    };

    // Convert string dateRange to Date objects for pickers
    const dateObject = {
        from: parseISO(dateRange.from),
        to: parseISO(dateRange.to)
    };

    return (
        <div className="flex flex-wrap items-center gap-3 bg-muted/20 p-2 rounded-xl border shadow-sm print:hidden">
            {showDailyAudit && (
                <Tabs
                    value={reportMode}
                    onValueChange={(v) => onReportModeChange(v as "daily" | "range")}
                    className="w-auto"
                >
                    <TabsList className="h-9 p-1 bg-linear-to-b from-muted/50 to-muted/80 border shadow-xs rounded-lg">
                        <TabsTrigger
                            value="daily"
                            className="text-[10px] font-bold uppercase tracking-wider h-7 px-3 rounded-md transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
                        >
                            Daily Audit
                        </TabsTrigger>
                        <TabsTrigger
                            value="range"
                            className="text-[10px] font-bold uppercase tracking-wider h-7 px-3 rounded-md transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
                        >
                            Date Range
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            )}

            {reportMode === "daily" ? (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "w-[160px] justify-start text-left font-normal h-9 bg-white text-xs",
                                !dateRange.from && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateObject.from ? format(dateObject.from, "PPP") : <span>Pick a date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={dateObject.from}
                            onSelect={handleDailySelect}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            ) : (
                <div className="scale-90 origin-left -ml-2">
                    {/* Scale down slightly to fit better if needed, or remove scale */}
                    <DatePickerWithRange
                        date={dateObject}
                        setDate={handleRangeSelect}
                        className="w-full"
                    />
                </div>
            )}

            {onClearFilters && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearFilters}
                    className="h-9 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                    title="Clear All Filters"
                >
                    <X className="h-4 w-4 mr-1" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Clear</span>
                </Button>
            )}
        </div>
    );
}
