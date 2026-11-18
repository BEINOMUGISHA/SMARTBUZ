"use client";

/**
 * SMARTBUZ — devices and synchronisation.
 *
 * The owner's view of the tills: which ones exist, which ones have caught
 * up, which ones are holding sales that nobody has seen yet, and the stock
 * that two of them sold while offline.
 *
 * This is the page that answers "did my till's sales get in?".
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    MonitorSmartphone,
    AlertTriangle,
    ScrollText,
    Check,
    X,
    RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

/** When the device last spoke to the server. */
function ago(iso?: string): string {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return "never";
    if (ms < 60_000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DevicesPage() {
    const { can } = useAuth();
    const canView = can("sales.view");

    const [tab, setTab] = useState("devices");

    const status = useQuery(api.sync.getSyncStatus, canView ? {} : "skip");
    const conflicts = useQuery(api.sync.listConflicts, canView ? {} : "skip");
    const logs = useQuery(
        api.sync.listSyncLogs,
        canView ? { limit: 100 } : "skip"
    );

    const resolveConflict = useMutation(api.sync.resolveConflict);

    const pendingConflicts = useMemo(
        () => (conflicts ?? []).filter((c: any) => c.status === "pending"),
        [conflicts]
    );

    if (!canView) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={MonitorSmartphone}
                    title="Devices and synchronisation"
                    description="Your tills, their queues, and the stock they both sold."
                />
                <EmptyState
                    title="You may not view this"
                    hint="Ask the owner or an administrator if you need to see the tills."
                />
            </div>
        );
    }

    const devices = status?.devices ?? [];

    const handleResolve = async (
        conflictId: Id<"stockConflicts">,
        resolution: string
    ) => {
        try {
            await resolveConflict({ conflictId, resolution });
            toast.success("Conflict resolved.");
        } catch (err: any) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={MonitorSmartphone}
                title="Devices and synchronisation"
                description="Your tills, their queues, and the stock they both sold."
            />

            <StatStrip
                stats={[
                    { label: "Tills", value: devices.length },
                    {
                        label: "Caught up",
                        value: devices.filter(
                            (d: any) => d.status === "active" && d.lastSyncStatus === "ok"
                        ).length,
                        tone: "good",
                    },
                    {
                        label: "Never synced",
                        value: devices.filter((d: any) => !d.lastSyncAt).length,
                        tone: "warn",
                    },
                    {
                        label: "Stock conflicts",
                        value: pendingConflicts.length,
                        tone: pendingConflicts.length > 0 ? "danger" : "default",
                    },
                ]}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="devices">Tills</TabsTrigger>
                    <TabsTrigger value="conflicts">Stock conflicts</TabsTrigger>
                    <TabsTrigger value="logs">Synchronisation log</TabsTrigger>
                </TabsList>

                {/* ── Tills ── */}
                <TabsContent value="devices" className="space-y-3">
                    {!status ? (
                        <LoadingState rows={3} />
                    ) : devices.length === 0 ? (
                        <EmptyState
                            title="No tills registered"
                            hint="A till registers itself the first time it is used."
                        />
                    ) : (
                        devices.map((device: any) => (
                            <Card key={device.deviceId}>
                                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold">
                                            {device.deviceName}
                                        </p>
                                        <p className="truncate text-[11px] text-muted-foreground">
                                            {device.deviceId}
                                            {device.platform ? ` • ${device.platform}` : ""}
                                            {device.appVersion
                                                ? ` • v${device.appVersion}`
                                                : ""}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            Registered {ago(device.registeredAt)} • last seen{" "}
                                            {ago(device.lastSeenAt)} • last sync{" "}
                                            {ago(device.lastSyncAt)}
                                        </p>
                                        {device.lastSyncError && (
                                            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                                {device.lastSyncError}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <StatusBadge status={device.status} />
                                        {device.lastSyncStatus && (
                                            <Badge variant="outline" className="text-[10px]">
                                                {device.lastSyncStatus === "ok"
                                                    ? "caught up"
                                                    : device.lastSyncStatus}
                                            </Badge>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>

                {/* ── Stock conflicts ── */}
                <TabsContent value="conflicts" className="space-y-3">
                    {!conflicts ? (
                        <LoadingState rows={3} />
                    ) : conflicts.length === 0 ? (
                        <EmptyState
                            title="No conflicts"
                            hint="Two tills have not sold the same stock offline."
                        />
                    ) : (
                        conflicts.map((conflict: any) => (
                            <Card key={conflict._id}>
                                <CardContent className="space-y-3 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold">
                                                {conflict.stockName ?? "A product"}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                                The till thought{" "}
                                                {conflict.expectedQty ?? "?"} were on hand;
                                                the server says {conflict.availableQty}.{" "}
                                                {conflict.requestedQty} were sold.
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                                Till {conflict.deviceId ?? "unknown"} •{" "}
                                                {ago(conflict.createdAt)}
                                            </p>
                                        </div>
                                        <Badge
                                            variant="outline"
                                            className={
                                                conflict.kind === "insufficient"
                                                    ? "border-red-500/30 bg-red-500/10 text-[10px] font-bold text-red-700 dark:text-red-400"
                                                    : "border-amber-500/30 bg-amber-500/10 text-[10px] font-bold text-amber-700 dark:text-amber-400"
                                            }
                                        >
                                            {conflict.kind === "insufficient"
                                                ? "not enough stock"
                                                : "stock moved"}
                                        </Badge>
                                    </div>

                                    {conflict.status === "pending" ? (
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    handleResolve(
                                                        conflict._id,
                                                        "accepted"
                                                    )
                                                }
                                            >
                                                <Check className="mr-1.5 h-3 w-3" />
                                                Accept the sale
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    handleResolve(
                                                        conflict._id,
                                                        "stock_adjusted"
                                                    )
                                                }
                                            >
                                                <RefreshCw className="mr-1.5 h-3 w-3" />
                                                Stock corrected
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                    handleResolve(
                                                        conflict._id,
                                                        "rejected"
                                                    )
                                                }
                                                className="text-muted-foreground hover:text-destructive"
                                            >
                                                <X className="mr-1.5 h-3 w-3" />
                                                Reverse it
                                            </Button>
                                        </div>
                                    ) : (
                                        <p className="text-[11px] text-muted-foreground">
                                            Resolved: {conflict.resolution}{" "}
                                            {conflict.resolvedAt
                                                ? `• ${ago(conflict.resolvedAt)}`
                                                : ""}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>

                {/* ── The audit trail ── */}
                <TabsContent value="logs" className="space-y-3">
                    <Card>
                        <CardHeader>
                            <CardTitle>What the server received</CardTitle>
                            <CardDescription>
                                Every transaction that arrived, and what the server did
                                with it. A sale that arrives twice is recorded once.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!logs ? (
                                <LoadingState rows={4} />
                            ) : logs.length === 0 ? (
                                <EmptyState title="Nothing has arrived yet" />
                            ) : (
                                <div className="space-y-1">
                                    {logs.map((log: any) => (
                                        <div
                                            key={log._id}
                                            className="flex items-center justify-between gap-3 border-b py-2 text-xs last:border-0"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate font-bold">
                                                    {log.transactionId ?? "—"}
                                                </p>
                                                <p className="truncate text-[11px] text-muted-foreground">
                                                    {log.deviceId ?? "unknown till"}
                                                    {log.invoiceNumber
                                                        ? ` • ${log.invoiceNumber}`
                                                        : ""}
                                                    {log.reason ? ` • ${log.reason}` : ""}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        log.status === "applied"
                                                            ? "border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"
                                                            : log.status === "duplicate"
                                                              ? "text-[10px] font-bold"
                                                              : log.status === "conflict"
                                                                ? "border-amber-500/30 bg-amber-500/10 text-[10px] font-bold text-amber-700 dark:text-amber-400"
                                                                : "border-red-500/30 bg-red-500/10 text-[10px] font-bold text-red-700 dark:text-red-400"
                                                    }
                                                >
                                                    {log.status}
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {ago(log.createdAt)}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
