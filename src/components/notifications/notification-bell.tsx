"use client";

/**
 * SMART_BUZ — the notification bell.
 *
 * The small bell in the header, with the number of things waiting to be
 * read on it.
 *
 * Two kinds of thing sit behind it:
 *
 *   • **Notifications** — something happened. A sale was refunded, a
 *     payment was taken, a till did not balance.
 *   • **Needs attention** — something is true now. Stock is below its
 *     reorder point, a layaway payment is late, a term fee is overdue.
 *
 * The second kind is worked out from the records on every request, so it
 * is still there tomorrow if it has not been dealt with. The first kind
 * is on the record and can be read once.
 */

import React, { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Bell, BellRing, AlertTriangle, PackageX, CalendarClock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

/** How a notification is shown. */
function toneFor(severity?: string): string {
    switch (severity) {
        case "critical":
            return "text-destructive";
        case "warning":
            return "text-amber-600 dark:text-amber-400";
        default:
            return "text-muted-foreground";
    }
}

function iconFor(kind: string) {
    switch (kind) {
        case "stock":
            return PackageX;
        case "finance":
            return CalendarClock;
        case "system":
            return BellRing;
        default:
            return Bell;
    }
}

/**
 * The bell must never take the dashboard down with it.
 *
 * It reads from the server, and a server that is briefly unreachable
 * should leave a person with a working screen and no badge — not an error
 * page over the work they were doing.
 */
class BellBoundary extends React.Component<
    { children: React.ReactNode },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        if (this.state.failed) return null;
        return this.props.children;
    }
}

function BellInner() {
    
    const t = useT();const [open, setOpen] = useState(false);

    const unread = useQuery(api.notifications.unreadCount, {});
    const attention = useQuery(api.notifications.attentionCount, {});

    const markRead = useMutation(api.notifications.markRead);
    const markAllRead = useMutation(api.notifications.markAllRead);

    const unreadCount = unread ?? 0;
    const attentionCount = attention ?? 0;
    const total = unreadCount + attentionCount;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label={
                        total > 0
                            ? `${total} things to look at`
                            : "Nothing to look at"
                    }
                >
                    <Bell className="size-4" />
                    {total > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-xs font-semibold text-destructive-foreground">
                            {total > 9 ? "9+" : total}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-96 p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                        <p className="text-sm font-semibold">{t("Notifications")}</p>
                        <p className="text-xs text-muted-foreground">
                            {unreadCount} unread
                            {attentionCount > 0
                                ? ` · ${attentionCount} need attention`
                                : ""}
                        </p>
                    </div>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={async () => {
                                await markAllRead({});
                            }}
                        >
                            <Check className="mr-1 size-3" />
                            {t("Mark all read")}
                        </Button>
                    )}
                </div>

                <ScrollArea className="max-h-96">
                    <AttentionList />
                    <NotificationList onRead={async (id: string) => {
                        await markRead({ id: id as any });
                    }} />
                </ScrollArea>

                <div className="border-t p-2">
                    <Button variant="ghost" size="sm" className="w-full" asChild>
                        <Link href="/notifications">{t("Open the notifications page")}</Link>
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/**
 * The bell in the header.
 */
export function NotificationBell() {
    return (
        <BellBoundary>
            <BellInner />
        </BellBoundary>
    );
}

/**
 * The live list — the things that are true right now.
 */
function AttentionList() {
    
    const t = useT();const items = useQuery(api.notifications.listAttentionItems, {});

    if (!items || items.length === 0) return null;

    return (
        <div className="border-b">
            <p className="px-4 pb-1 pt-3 text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                {t("Needs attention")}
            </p>
            {items.slice(0, 5).map((item) => (
                <Link
                    key={item.key}
                    href={item.link}
                    className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                    <AlertTriangle
                        className={cn(
                            "mt-0.5 size-4 shrink-0",
                            toneFor(item.severity)
                        )}
                    />
                    <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">
                            {t(item.title)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.body}
                        </p>
                    </div>
                </Link>
            ))}
        </div>
    );
}

/**
 * The record — the things that happened.
 */
function NotificationList({
    onRead,
}: {
    onRead: (id: string) => Promise<void>;
}) {
    
    const t = useT();const notifications = useQuery(api.notifications.listNotifications, { limit: 20 });

    if (!notifications) {
        return (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("Loading…")}
            </div>
        );
    }

    if (notifications.length === 0) {
        return (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("Nothing yet. Notifications appear here as things happen.")}
            </div>
        );
    }

    return (
        <div>
            <p className="px-4 pb-1 pt-3 text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                {t("Recent")}
            </p>
            {notifications.map((notification) => {
                const Icon = iconFor(notification.kind);
                return (
                    <Link
                        key={notification._id}
                        href={notification.link ?? "/notifications"}
                        onClick={() => {
                            if (!notification.readAt) void onRead(notification._id);
                        }}
                        className={cn(
                            "flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60",
                            !notification.readAt && "bg-primary/[0.04]"
                        )}
                    >
                        <Icon
                            className={cn(
                                "mt-0.5 size-4 shrink-0",
                                notification.readAt
                                    ? "text-muted-foreground"
                                    : toneFor(notification.severity)
                            )}
                        />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight">
                                {t(notification.title)}
                            </p>
                            {notification.body && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {notification.body}
                                </p>
                            )}
                        </div>
                        {!notification.readAt && (
                            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
