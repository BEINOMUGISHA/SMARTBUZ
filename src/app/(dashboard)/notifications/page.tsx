"use client";

/**
 * SMART_BUZ — Notifications.
 *
 * Two lists on one screen, because they answer two different questions.
 *
 *   • **Needs attention** — what is true right now and needs a person:
 *     stock below its reorder point, a layaway payment that has fallen
 *     due, a term fee that is overdue, a batch about to expire. These are
 *     worked out from the records on every request, so they are still here
 *     tomorrow if they have not been dealt with.
 *
 *   • **Notifications** — the record of what happened: a refund, a
 *     payment, a till that did not balance. These are read once and
 *     kept.
 */

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import {
    AlertTriangle,
    Bell,
    CalendarClock,
    Check,
    PackageX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    PageContainer,
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    CountBadge,
} from "@/components/app/page-shell";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

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

export default function NotificationsPage() {
    
    const t = useT();const attention = useQuery(api.notifications.listAttentionItems, {});
    const notifications = useQuery(api.notifications.listNotifications, { limit: 100 });
    const unread = useQuery(api.notifications.unreadCount, {});

    const markRead = useMutation(api.notifications.markRead);
    const markAllRead = useMutation(api.notifications.markAllRead);

    const unreadCount = unread ?? 0;
    const critical =
        attention?.filter((item) => item.severity === "critical").length ?? 0;
    const warnings =
        attention?.filter((item) => item.severity === "warning").length ?? 0;

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Overview"
                title={t("Notifications")}
                description={t("What happened, and what still needs a person to deal with it.")}
                icon={Bell}
                badge={<CountBadge tone={unreadCount ? "info" : "neutral"}>{unreadCount}</CountBadge>}
                actions={
                    unreadCount > 0 ? (
                        <Button
                            variant="outline"
                            onClick={async () => {
                                await markAllRead({});
                            }}
                        >
                            <Check className="mr-2 size-4" /> {t("Mark all read")}
                        </Button>
                    ) : undefined
                }
            />

            <StatGrid columns={3}>
                <StatCard
                    label={t("Unread")}
                    value={unreadCount}
                    hint={t("Notifications you have not opened yet")}
                    icon={Bell}
                    tone="info"
                    isLoading={unread === undefined}
                />
                <StatCard
                    label={t("Critical")}
                    value={critical}
                    hint={t("Out of stock, badly overdue, already expired")}
                    icon={AlertTriangle}
                    tone="danger"
                    isLoading={attention === undefined}
                />
                <StatCard
                    label={t("Needs a look")}
                    value={warnings}
                    hint={t("Low stock, a payment due, a batch expiring")}
                    icon={CalendarClock}
                    tone="warning"
                    isLoading={attention === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Needs attention")}
                description={t("These are worked out from the records every time this page is opened, so they stay here until they are actually dealt with.")}
            >
                {attention === undefined ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {t("Working out what needs attention…")}
                    </p>
                ) : attention.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-10 text-center">
                        <p className="text-sm font-medium">
                            {t("Nothing needs your attention")}
                        </p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            {t("Stock is above its reorder point, no payment is late and nothing is about to expire.")}
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {attention.map((item) => (
                            <li key={item.key}>
                                <Link
                                    href={item.link}
                                    className="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/50"
                                >
                                    {item.kind === "stock" ? (
                                        <PackageX
                                            className={cn(
                                                "mt-0.5 size-4 shrink-0",
                                                toneFor(item.severity)
                                            )}
                                        />
                                    ) : (
                                        <CalendarClock
                                            className={cn(
                                                "mt-0.5 size-4 shrink-0",
                                                toneFor(item.severity)
                                            )}
                                        />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                            {t(item.title)}
                                        </p>
                                        <p className="mt-0.5 text-sm text-muted-foreground">
                                            {item.body}
                                        </p>
                                    </div>
                                    <Badge
                                        variant={
                                            item.severity === "critical"
                                                ? "danger"
                                                : "warning"
                                        }
                                    >
                                        {item.severity === "critical"
                                            ? "Critical"
                                            : "Look"}
                                    </Badge>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            <SectionCard
                title={t("Notifications")}
                description={t("The record of what happened. These are kept after they are read.")}
            >
                {notifications === undefined ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {t("Loading…")}
                    </p>
                ) : notifications.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-10 text-center">
                        <p className="text-sm font-medium">{t("Nothing yet")}</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            {t("Notifications appear here as things happen — a refund, a payment, a till that did not balance.")}
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {notifications.map((notification) => (
                            <li key={notification._id}>
                                <Link
                                    href={notification.link ?? "#"}
                                    onClick={() => {
                                        if (!notification.readAt) {
                                            void markRead({
                                                id: notification._id,
                                            });
                                        }
                                    }}
                                    className={cn(
                                        "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/50",
                                        !notification.readAt &&
                                            "border-primary/30 bg-primary/[0.04]"
                                    )}
                                >
                                    <Bell
                                        className={cn(
                                            "mt-0.5 size-4 shrink-0",
                                            notification.readAt
                                                ? "text-muted-foreground"
                                                : toneFor(notification.severity)
                                        )}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                            {t(notification.title)}
                                        </p>
                                        {notification.body && (
                                            <p className="mt-0.5 text-sm text-muted-foreground">
                                                {notification.body}
                                            </p>
                                        )}
                                    </div>
                                    {!notification.readAt && (
                                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                                    )}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>
        </PageContainer>
    );
}
