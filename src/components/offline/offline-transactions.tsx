"use client";

/**
 * SMARTBUZ — the local record of sales.
 *
 * Everything this till has sold, whether or not the server has it yet.
 *
 * This is the cashier's own record. A sale that has not been sent is shown
 * as *waiting*, one the server refused is shown with the reason, and one
 * that was recorded but ran into a stock conflict is shown as needing a
 * decision. Nothing here is ever removed automatically — a sale leaves this
 * list only when a person throws it away on purpose.
 */

import { useEffect, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Clock,
    CloudOff,
    RefreshCw,
    Trash2,
    Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSync } from "./sync-provider";
import type { QueuedTransaction, TransactionStatus } from "@/lib/offline/types";
import { useT } from "@/i18n/provider";

/** How each state is shown. */
const PRESENTATION: Record<
    TransactionStatus,
    { label: string; tone: string; icon: typeof Clock }
> = {
    pending: {
        label: "Waiting",
        tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        icon: Clock,
    },
    syncing: {
        label: "Sending",
        tone: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
        icon: RefreshCw,
    },
    synced: {
        label: "On the books",
        tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        icon: CheckCircle2,
    },
    failed: {
        label: "Refused",
        tone: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
        icon: CloudOff,
    },
    conflict: {
        label: "Needs a decision",
        tone: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
        icon: AlertTriangle,
    },
};

/** When the sale happened, in a form a person can read. */
function when(iso?: string): string {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-UG", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** What the sale was for, and how much. */
function describe(transaction: QueuedTransaction): {
    label: string;
    amount: number;
} {
    const payload = transaction.payload as {
        total?: number;
        manualCustomerName?: string;
        clientType?: string;
        items?: Array<{ name: string; quantity: number }>;
    };

    const items = payload?.items ?? [];
    const first = items[0];
    const label = items.length
        ? items.length === 1
            ? `${first.quantity} × ${first.name}`
            : `${first.quantity} × ${first.name} + ${items.length - 1} more`
        : (payload?.clientType ?? "Sale");

    return {
        label,
        amount: payload?.total ?? 0,
    };
}

export function OfflineTransactionsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    
    const t = useT();const { history, retry, discard, refresh } = useSync();
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    const handleRetry = async (transactionId: string) => {
        setBusy(transactionId);
        try {
            await retry(transactionId);
            toast.success("Sent again.");
        } catch {
            toast.error("It could not be sent. It will be tried again.");
        } finally {
            setBusy(null);
        }
    };

    const handleDiscard = async (transactionId: string) => {
        setBusy(transactionId);
        try {
            await discard(transactionId);
            toast.success("Removed from this till's record.");
        } catch {
            toast.error("It could not be removed.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t("This till&apos;s sales")}</DialogTitle>
                    <DialogDescription>
                        {t("Everything this till has sold. Sales waiting to be sent are kept here until the server has them — closing the application does not lose them.")}
                    </DialogDescription>
                </DialogHeader>

                {history.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <Package className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-bold">{t("Nothing recorded on this till yet")}</p>
                        <p className="text-xs text-muted-foreground">
                            {t("Sales made here will be listed, whether or not the network is up.")}
                        </p>
                    </div>
                ) : (
                    <ScrollArea className="max-h-[55vh] pr-3">
                        <div className="space-y-2">
                            {history.map((transaction) => {
                                const presentation = PRESENTATION[transaction.status];
                                const Icon = presentation.icon;
                                const { label, amount } = describe(transaction);
                                const canRetry =
                                    transaction.status === "failed" ||
                                    transaction.status === "conflict";

                                return (
                                    <div
                                        key={transaction.transactionId}
                                        className="rounded-xl border bg-card p-3"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-bold">
                                                    {label}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {when(transaction.occurredAt)} •{" "}
                                                    {amount.toLocaleString("en-UG")}
                                                    {transaction.result?.invoiceNumber
                                                        ? ` • ${transaction.result.invoiceNumber}`
                                                        : ""}
                                                </p>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={`shrink-0 text-xs font-bold ${presentation.tone}`}
                                            >
                                                <Icon
                                                    className={`mr-1 h-3 w-3 ${transaction.status === "syncing"
                                                            ? "animate-spin"
                                                            : ""}`}
                                                />
                                                {t(presentation.label)}
                                            </Badge>
                                        </div>

                                        {transaction.lastError && (
                                            <p className="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-400">
                                                {transaction.lastError}
                                            </p>
                                        )}

                                        {transaction.status === "conflict" && (
                                            <p className="mt-2 rounded-md bg-orange-500/10 px-2 py-1 text-xs text-orange-700 dark:text-orange-400">
                                                {t("The sale is on the books, but the stock had already been sold by another device. The owner will see it in the conflicts list.")}
                                            </p>
                                        )}

                                        {transaction.attempts > 0 && (
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {transaction.attempts} attempt
                                                {transaction.attempts === 1 ? "" : "s"}
                                                {transaction.nextAttemptAt
                                                    ? ` • next attempt ${when(
                                                          transaction.nextAttemptAt
                                                      )}`
                                                    : ""}
                                            </p>
                                        )}

                                        {(canRetry || transaction.status === "synced") && (
                                            <>
                                                <Separator className="my-2" />
                                                <div className="flex justify-end gap-2">
                                                    {canRetry && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={busy === transaction.transactionId}
                                                            onClick={() =>
                                                                handleRetry(
                                                                    transaction.transactionId
                                                                )
                                                            }
                                                        >
                                                            <RefreshCw className="mr-1.5 h-3 w-3" />
                                                            {t("Send again")}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        disabled={busy === transaction.transactionId}
                                                        onClick={() =>
                                                            handleDiscard(
                                                                transaction.transactionId
                                                            )
                                                        }
                                                        className="text-muted-foreground hover:text-destructive"
                                                    >
                                                        <Trash2 className="mr-1.5 h-3 w-3" />
                                                        {t("Remove")}
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}
            </DialogContent>
        </Dialog>
    );
}
