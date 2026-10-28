"use client";

import { useEffect, useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getQueuedSales, syncOfflineQueue } from "@/lib/offline-sales-manager";

export function OfflineStatusBanner() {
    const [isOnline, setIsOnline] = useState(true);
    const [queueCount, setQueueCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const createSaleMutation = useMutation(api.sales.create);

    const refreshQueueCount = useCallback(async () => {
        try {
            const queue = await getQueuedSales();
            setQueueCount(queue.length);
        } catch {
            setQueueCount(0);
        }
    }, []);

    const handleSync = useCallback(async () => {
        if (!navigator.onLine || isSyncing) return;
        setIsSyncing(true);
        try {
            const result = await syncOfflineQueue(createSaleMutation);
            if (result.synced > 0) {
                toast.success(`Successfully synchronized ${result.synced} offline sale(s)!`);
            }
            if (result.failed > 0) {
                toast.error(`${result.failed} sale(s) failed to sync. Will retry.`);
            }
            await refreshQueueCount();
        } catch {
            toast.error("Offline sync encountered an error.");
        } finally {
            setIsSyncing(false);
        }
    }, [createSaleMutation, isSyncing, refreshQueueCount]);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        refreshQueueCount();

        const handleOnline = () => {
            setIsOnline(true);
            toast.info("Internet connection restored. Synchronizing offline queue...");
            handleSync();
        };

        const handleOffline = () => {
            setIsOnline(false);
            toast.warning("Working in Offline Mode. Sales will be saved locally.");
            refreshQueueCount();
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        const interval = setInterval(refreshQueueCount, 15000);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            clearInterval(interval);
        };
    }, [handleSync, refreshQueueCount]);

    // Don't clutter header if completely online with zero pending syncs
    if (isOnline && queueCount === 0) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md shadow-sm transition-all duration-300">
            {!isOnline ? (
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                    <span>Offline Mode</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <Wifi className="h-3.5 w-3.5" />
                    <span>Online</span>
                </div>
            )}

            {queueCount > 0 && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold px-2 py-0">
                    {queueCount} Queued
                </Badge>
            )}

            {isOnline && queueCount > 0 && (
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="h-6 px-2 text-[10px] gap-1 text-primary hover:bg-primary/10 rounded-full"
                >
                    <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                    <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
                </Button>
            )}
        </div>
    );
}
