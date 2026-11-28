"use client";

/**
 * SMARTBUZ — the offline status banner.
 *
 * The small strip in the header that tells the cashier, in one glance:
 *
 *   • whether the till can reach the server;
 *   • how many sales are still waiting to go;
 *   • whether something needs a person to look at it.
 *
 * It never hides a problem. A queue that cannot be pushed stays on the
 * screen, with the count, until it is pushed or dealt with.
 */

import { useState } from "react";
import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle2, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSync } from "./sync-provider";
import { OfflineTransactionsDialog } from "./offline-transactions";
import { useT } from "@/i18n/provider";

/** "just now", "4 minutes ago", "2 hours ago"… */
function ago(iso?: string): string | null {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return null;
    if (ms < 60_000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function OfflineStatusBanner() {
    
    const t = useT();const { status, syncNow } = useSync();
    const [open, setOpen] = useState(false);

    const waiting = status.pending;
    const trouble = status.failed + status.conflicts;
    const blocked = status.deviceBlocked;

    /**
     * A till the server will not accept is not the same as a till that is
     * offline. Offline sales are safe on the till and go up when the network
     * returns. A refused till cannot push at all, so the cashier has to know
     * before they take the next payment.
     */
    if (blocked) {
        return (
            <>
                <div
                    className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md"
                    title={blocked}
                >
                    <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{t("Till not registered")}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="text-xs font-bold text-muted-foreground underline-offset-2 hover:underline"
                    >
                        {t("Queue")}
                    </button>
                </div>
                <OfflineTransactionsDialog open={open} onOpenChange={setOpen} />
            </>
        );
    }

    // Nothing to say: online, nothing waiting, nothing wrong.
    if (status.online && waiting === 0 && trouble === 0) return null;

    const handleSync = async () => {
        try {
            const outcome = await syncNow();
            if (outcome.applied > 0 || outcome.duplicates > 0) {
                toast.success(
                    `Sent ${outcome.applied + outcome.duplicates} sale${
                        outcome.applied + outcome.duplicates === 1 ? "" : "s"
                    } to the server.`
                );
            }
            if (outcome.conflicts > 0) {
                toast.warning(
                    `${outcome.conflicts} sale${
                        outcome.conflicts === 1 ? " was" : "s were"
                    } recorded, but the stock had already been sold by another device.`
                );
            }
            if (outcome.rejected > 0) {
                toast.error(
                    `${outcome.rejected} sale${
                        outcome.rejected === 1 ? " was" : "s were"
                    } refused. Open the queue to see why.`
                );
            }
        } catch {
            toast.error("The server could not be reached. The sales are safe and will be sent later.");
        }
    };

    return (
        <>
            <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md transition-all duration-300">
                {!status.online ? (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                        <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                        <span>{t("Offline")}</span>
                    </div>
                ) : status.syncing ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>{t("Syncing")}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{t("Online")}</span>
                    </div>
                )}

                {waiting > 0 && (
                    <Badge
                        variant="outline"
                        className="border-amber-500/30 bg-amber-500/10 px-2 py-0 text-xs font-bold text-amber-600 dark:text-amber-400"
                    >
                        {waiting} waiting
                    </Badge>
                )}

                {trouble > 0 && (
                    <Badge
                        variant="outline"
                        className="border-red-500/30 bg-red-500/10 px-2 py-0 text-xs font-bold text-red-600 dark:text-red-400"
                    >
                        {trouble} need attention
                    </Badge>
                )}

                {status.online && waiting > 0 && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleSync}
                        disabled={status.syncing}
                        className="h-6 gap-1 rounded-full px-2 text-xs text-primary hover:bg-primary/10"
                    >
                        <CloudUpload className="h-3 w-3" />
                        <span>{t("Send now")}</span>
                    </Button>
                )}

                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="text-xs font-bold text-muted-foreground underline-offset-2 hover:underline"
                    title={t("Open the local record of sales")}
                >
                    {t("Queue")}
                </button>
            </div>

            <OfflineTransactionsDialog open={open} onOpenChange={setOpen} />
        </>
    );
}

/**
 * The banner shown when the till cannot reach the server and there is
 * nothing waiting — the cashier should still know they are working offline.
 */
export function OfflineNotice({ className }: { className?: string }) {
    
    const t = useT();const { status } = useSync();
    if (status.online) return null;

    return (
        <div
            className={`flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 ${className ?? ""}`}
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs">
                <p className="font-bold">{t("Working offline")}</p>
                <p className="text-muted-foreground">
                    {t("Sales are saved on this till and sent to the server when the network comes back. Nothing is lost. Prices shown are the last ones this till downloaded.")}
                </p>
            </div>
        </div>
    );
}
