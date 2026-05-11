"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Calendar as CalendarIcon, FilterX, Eye, Clock, User, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { PaginationControls } from "./page";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

export function AuditLogsManager() {
    const [actionFilter, setActionFilter] = useState("");
    const [userFilter, setUserFilter] = useState<string>("all");
    const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
    const [selectedLog, setSelectedLog] = useState<any>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const users = useQuery(api.users.listAll) || [];

    const logsResult = useQuery(api.activityLogs.list, {
        paginationOpts: {
            numItems: rowsPerPage,
            cursor: currentPage === 1 ? null : ((currentPage - 1) * rowsPerPage).toString(), // simplified cursor for this manual implementation
        },
        userId: userFilter !== "all" ? userFilter as any : undefined,
        action: actionFilter || undefined,
        startDate: dateRange.from ? dateRange.from.toISOString() : undefined,
        endDate: dateRange.to ? dateRange.to.toISOString() : undefined,
    });

    const logs = logsResult?.page || [];
    const totalItems = logsResult?.totalCount || 0; // Using custom totalCount from backend
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);

    const clearFilters = () => {
        setActionFilter("");
        setUserFilter("all");
        setDateRange({});
        setCurrentPage(1);
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Audit Logs</CardTitle>
                    <CardDescription>View system activity and track user actions.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-6">
                    {/* Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-muted/20 p-4 rounded-xl border">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Filter by Action</Label>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search actions..."
                                    value={actionFilter}
                                    onChange={(e) => setActionFilter(e.target.value)}
                                    className="pl-9 bg-background"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Filter by User</Label>
                            <Select value={userFilter} onValueChange={setUserFilter}>
                                <SelectTrigger className="bg-background">
                                    <SelectValue placeholder="All Users" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Users</SelectItem>
                                    {users.map((u) => (
                                        <SelectItem key={u._id} value={u._id}>
                                            {u.first_name} {u.last_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Start Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal bg-background",
                                            !dateRange.from && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange.from ? format(dateRange.from, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={dateRange.from}
                                        onSelect={(date) => setDateRange((prev) => ({ ...prev, from: date }))}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">End Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal bg-background",
                                            !dateRange.to && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange.to ? format(dateRange.to, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={dateRange.to}
                                        onSelect={(date) => setDateRange((prev) => ({ ...prev, to: date }))}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>

                    {(actionFilter || userFilter !== "all" || dateRange.from || dateRange.to) && (
                        <div className="flex justify-end">
                            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground hover:text-destructive">
                                <FilterX className="mr-2 h-4 w-4" />
                                Clear Filters
                            </Button>
                        </div>
                    )}

                    {/* Table */}
                    <div className="rounded-md border overflow-auto max-h-[600px]">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Time</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead className="w-[50%]">Details</TableHead>
                                    <TableHead>Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!logsResult ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-32 text-center">
                                            <Loader2 className="animate-spin h-8 w-8 mx-auto text-muted-foreground" />
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                                            No activity logs found matching criteria.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    logs.map((log) => {
                                        const user = users.find(u => u._id === log.userId);
                                        return (
                                            <TableRow key={log._id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                    {format(new Date(log.timestamp), "MMM dd, yyyy HH:mm")}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {user ? (
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold">
                                                                {user.first_name[0]}{user.last_name[0]}
                                                            </div>
                                                            {user.first_name} {user.last_name}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground italic">Unknown User</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                                                    {log.details}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="link"
                                                            className="font-semibold text-foreground/80 hover:text-primary p-0 h-auto flex items-center gap-1"
                                                            onClick={() => setSelectedLog(log)}
                                                        >
                                                            {log.action}
                                                            <Eye className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <PaginationControls
                        currentPage={currentPage}
                        totalPages={totalPages}
                        rowsPerPage={rowsPerPage}
                        setRowsPerPage={setRowsPerPage}
                        setCurrentPage={setCurrentPage}
                        startIndex={startIndex}
                        endIndex={endIndex}
                        totalItems={totalItems}
                    />
                </div>
            </CardContent>
        </Card>

        {/* Detail Sheet */}
        <Sheet open={!!selectedLog} onOpenChange={(open) => {
            if (!open) setSelectedLog(null);
        }}>
            <SheetContent className="w-[500px] sm:w-[600px] p-6 overflow-y-auto">
                {selectedLog && (
                    <>
                        <SheetHeader>
                            <SheetTitle className="flex items-center gap-2">
                                <Eye className="h-5 w-5" />
                                Activity Log Details
                            </SheetTitle>
                            <SheetDescription>
                                View detailed information about this system activity.
                            </SheetDescription>
                        </SheetHeader>
                        <div className="space-y-6 mt-6">
                            {/* Action Badge */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">Action</Label>
                                <Badge variant="secondary" className="w-fit text-base py-1 px-3">
                                    {selectedLog.action}
                                </Badge>
                            </div>

                            {/* Timestamp */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    Timestamp
                                </Label>
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium">{format(new Date(selectedLog.timestamp), "MMMM dd, yyyy")}</span>
                                    <span className="text-muted-foreground">at</span>
                                    <span className="font-mono">{format(new Date(selectedLog.timestamp), "HH:mm:ss")}</span>
                                </div>
                            </div>

                            {/* User */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    User
                                </Label>
                                {(() => {
                                    const user = users.find(u => u._id === selectedLog.userId);
                                    return user ? (
                                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm text-primary font-bold">
                                                {user.first_name[0]}{user.last_name[0]}
                                            </div>
                                            <div>
                                                <div className="font-medium">{user.first_name} {user.last_name}</div>
                                                <div className="text-sm text-muted-foreground">{user.email}</div>
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground italic">Unknown User</span>
                                    );
                                })()}
                            </div>

                            {/* Details */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    Details
                                </Label>
                                <div className="p-4 rounded-lg bg-muted/50 text-sm leading-relaxed">
                                    {selectedLog.details}
                                </div>
                            </div>

                            {/* Log ID */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">Log ID</Label>
                                <div className="font-mono text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                                    {selectedLog._id}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
        </>
    );
}
