"use client";

/**
 * SMARTBUZ — the subscription page.
 *
 * What this business has bought, what it may use, what it has used, and
 * what it still owes.
 *
 * The page shows what the backend says. It never decides for itself whether
 * a feature is allowed — that is decided on the server, in
 * `convex/entitlements.ts`, whether or not this page was ever loaded.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
    FormDialog,
} from "@/components/vertical/ui-kit";
import { PlanPicker, planPrice } from "@/components/subscription/plan-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    CreditCard,
    KeyRound,
    Monitor,
    History,
    Wallet,
    AlertTriangle,
    CheckCircle2,
    Package,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useT } from "@/i18n/provider";

export default function SubscriptionPage() {
    
    const t = useT();const { can } = useAuth();
    const canView = can("subscriptions.self.view");
    const canManage = can("subscriptions.self.manage");

    const [tab, setTab] = useState("overview");
    const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
    const [pendingPlan, setPendingPlan] = useState<string | null>(null);
    const [showPayment, setShowPayment] = useState(false);
    const [showDevice, setShowDevice] = useState(false);
    const [showKey, setShowKey] = useState(false);

    const subscription = useQuery(
        api.subscriptions.getMySubscription,
        canView ? {} : "skip"
    );
    const entitlements = useQuery(
        api.entitlements.getMyEntitlements,
        canView ? {} : "skip"
    );
    const history = useQuery(api.subscriptions.getHistory, canView ? { limit: 50 } : "skip");

    const selectPlan = useMutation(api.subscriptions.selectPlan);
    const activate = useMutation(api.subscriptions.activateSubscription);
    const submitPayment = useMutation(api.billing.submitPayment);
    const registerDevice = useMutation(api.subscriptions.registerDevice);
    const revokeDevice = useMutation(api.subscriptions.revokeDevice);
    const redeemKey = useMutation(api.subscriptions.redeemLicenseKey);

    const plan = subscription?.plan;
    const status = subscription?.status ?? "trial";

    /** The price of the plan on this subscription, for the current cycle. */
    const price = useMemo(() => {
        if (!plan) return null;
        return {
            amount: cycle === "annual" ? plan.priceAnnual : plan.priceMonthly,
            currency: plan.currency,
        };
    }, [plan, cycle]);

    if (!canView) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={CreditCard}
                    title={t("Subscription")}
                    description={t("Your plan, your devices and your billing history.")}
                />
                <EmptyState
                    title={t("You may not view this business's subscription")}
                    hint={t("Ask the owner or an administrator if you need to see the plan.")}
                />
            </div>
        );
    }

    if (!subscription) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={CreditCard}
                    title={t("Subscription")}
                    description={t("Your plan, your devices and your billing history.")}
                />
                <LoadingState rows={2} />
            </div>
        );
    }

    const handleSelectPlan = async (planKey: string) => {
        setPendingPlan(planKey);
        try {
            await selectPlan({ planKey });
            toast.success("Your plan has been updated.");
        } catch (err: any) {
            toast.error(formatError(err));
        } finally {
            setPendingPlan(null);
        }
    };

    const handleActivate = async () => {
        try {
            await activate({});
            toast.success("Your subscription is now active.");
        } catch (err: any) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={CreditCard}
                title={t("Subscription")}
                description={t("Your plan, your devices and your billing history.")}
                actions={
                    canManage ? (
                        <>
                            <Button variant="outline" onClick={() => setShowPayment(true)}>
                                <Wallet className="mr-2 h-4 w-4" />
                                {t("Submit payment")}
                            </Button>
                            <Button onClick={() => setShowKey(true)}>
                                <KeyRound className="mr-2 h-4 w-4" />
                                {t("Redeem key")}
                            </Button>
                        </>
                    ) : undefined
                }
            />

            <StatStrip
                stats={[
                    {
                        label: "Plan",
                        value: plan?.name ?? "None",
                    },
                    {
                        label: "Status",
                        value: status.replace(/_/g, " "),
                        tone:
                            status === "active" || status === "trial"
                                ? "good"
                                : status === "grace" || status === "past_due"
                                  ? "warn"
                                  : "danger",
                    },
                    {
                        label: "Days remaining",
                        value:
                            subscription.daysRemaining === undefined
                                ? "—"
                                : subscription.daysRemaining,
                        tone:
                            (subscription.daysRemaining ?? 99) <= 7 ? "warn" : "default",
                    },
                    {
                        label: "Devices",
                        value: `${subscription.devices.used} / ${
                            subscription.devices.limit || "∞"
                        }`,
                    },
                ]}
            />

            {!subscription.writable && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div className="space-y-1">
                        <p className="text-sm font-bold">{subscription.explanation}</p>
                        <p className="text-xs text-muted-foreground">
                            {t("Nothing has been deleted. Your sales, stock and records are all still here — you simply cannot record anything new until the subscription is put right.")}
                        </p>
                    </div>
                </div>
            )}

            {status === "trial" && canManage && (
                <Card className="border-emerald-500/30 bg-emerald-500/5">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                            <div>
                                <p className="text-sm font-bold">
                                    {t("Your free trial is running")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {t("Submit your payment and it will be activated once the payment is confirmed against the provider&apos;s own record.")}
                                </p>
                            </div>
                        </div>
                        <Button onClick={() => setShowPayment(true)}>{t("Pay now")}</Button>
                    </CardContent>
                </Card>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
                    <TabsTrigger value="plans">{t("Plans")}</TabsTrigger>
                    <TabsTrigger value="devices">{t("Devices")}</TabsTrigger>
                    <TabsTrigger value="payments">{t("Payments")}</TabsTrigger>
                    <TabsTrigger value="history">{t("History")}</TabsTrigger>
                </TabsList>

                {/* ── Overview ── */}
                <TabsContent value="overview" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("What your plan allows")}</CardTitle>
                            <CardDescription>
                                {t("These are decided on the server. A feature that is not on your plan is refused even if it is called directly.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 sm:grid-cols-2">
                            {(entitlements?.entitlements ?? []).map((e) => (
                                <div
                                    key={e.key}
                                    className="flex items-start gap-2 rounded-lg border p-3"
                                >
                                    {e.included ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                    ) : (
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold">{t(e.label)}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {t(e.description)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Usage")}</CardTitle>
                            <CardDescription>
                                {t("Counted from your real records, so it cannot drift.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {Object.entries(entitlements?.usage ?? {}).map(
                                ([kind, usage]) => (
                                    <div
                                        key={kind}
                                        className="flex items-center justify-between text-sm"
                                    >
                                        <span className="capitalize text-muted-foreground">
                                            {kind}
                                        </span>
                                        <span className="font-bold tabular-nums">
                                            {usage.used}{" "}
                                            <span className="font-normal text-muted-foreground">
                                                / {usage.limit || "unlimited"}
                                            </span>
                                        </span>
                                    </div>
                                )
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Plans ── */}
                <TabsContent value="plans" className="space-y-4">
                    <PlanPicker
                        selected={subscription.subscription?.planKey ?? plan?.key}
                        onSelect={handleSelectPlan}
                        cycle={cycle}
                        onCycleChange={setCycle}
                        currentPlanKey={subscription.subscription?.planKey ?? plan?.key}
                    />
                    {!canManage && (
                        <p className="text-xs text-muted-foreground">
                            {t("Only the owner or an administrator can change the plan.")}
                        </p>
                    )}
                </TabsContent>

                {/* ── Devices ── */}
                <TabsContent value="devices" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            {subscription.devices.used} of{" "}
                            {subscription.devices.limit || "unlimited"} {t("devices registered.")}
                        </p>
                        {canManage && (
                            <Button size="sm" onClick={() => setShowDevice(true)}>
                                <Monitor className="mr-2 h-4 w-4" />
                                {t("Register device")}
                            </Button>
                        )}
                    </div>

                    {subscription.devices.registered.length === 0 ? (
                        <EmptyState
                            title={t("No devices registered")}
                            hint={t("Register the tills and devices that will use this account.")}
                        />
                    ) : (
                        <div className="space-y-2">
                            {subscription.devices.registered.map((d: any) => (
                                <div
                                    key={d._id}
                                    className="flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-bold">
                                            {d.deviceName}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {d.deviceId}
                                            {d.platform ? ` • ${d.platform}` : ""}
                                        </p>
                                    </div>
                                    {canManage && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={async () => {
                                                try {
                                                    await revokeDevice({
                                                        deviceId: d._id,
                                                        reason: "Revoked from the subscription page.",
                                                    });
                                                    toast.success("Device revoked.");
                                                } catch (err: any) {
                                                    toast.error(formatError(err));
                                                }
                                            }}
                                        >
                                            {t("Revoke")}
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── Payments ── */}
                <TabsContent value="payments" className="space-y-4">
                    {subscription.payments.length === 0 ? (
                        <EmptyState
                            title={t("No payments yet")}
                            hint={t("Submit a payment and it will be activated once confirmed.")}
                        />
                    ) : (
                        <div className="space-y-2">
                            {subscription.payments.map((p: any) => (
                                <div
                                    key={p._id}
                                    className="flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm"
                                >
                                    <div>
                                        <p className="text-sm font-bold">
                                            {p.currency} {p.amount.toLocaleString("en-UG")}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {p.billingCycle} • {p.provider}
                                            {p.providerReference
                                                ? ` • ref ${p.providerReference}`
                                                : ""}
                                        </p>
                                    </div>
                                    <StatusBadge status={p.status} />
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── History ── */}
                <TabsContent value="history" className="space-y-4">
                    {(history?.page ?? []).length === 0 ? (
                        <EmptyState title={t("Nothing has happened yet")} />
                    ) : (
                        <div className="space-y-2">
                            {(history?.page ?? []).map((e: any) => (
                                <div
                                    key={e._id}
                                    className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm"
                                >
                                    <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold">
                                            {e.type.replace(/_/g, " ")}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {e.note ??
                                                `${e.fromStatus ?? "—"} → ${e.toStatus ?? "—"}`}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {new Date(e.createdAt).toLocaleDateString("en-UG")}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* ── Submit payment ── */}
            <FormDialog
                open={showPayment}
                onOpenChange={setShowPayment}
                title={t("Submit a payment")}
                description={t("Your payment is recorded as pending. The subscription is activated once it has been confirmed against the provider's own record.")}
                submitLabel="Submit payment"
                fields={[
                    {
                        name: "amount",
                        label: "Amount",
                        type: "number",
                        required: true,
                        defaultValue: price?.amount ?? 0,
                        hint: price
                            ? `The ${cycle} price of the ${plan?.name} plan.`
                            : undefined,
                    },
                    {
                        name: "provider",
                        label: "Paid through",
                        type: "select",
                        required: true,
                        options: [
                            { value: "bank", label: "Bank transfer" },
                            { value: "mobile_money", label: "Mobile money" },
                            { value: "card", label: "Card" },
                            { value: "cash", label: "Cash" },
                        ],
                    },
                    {
                        name: "providerReference",
                        label: "Reference",
                        placeholder: "The transaction reference from the provider",
                        hint: "Used to make sure the same payment is not claimed twice.",
                    },
                    {
                        name: "billingCycle",
                        label: "Billing period",
                        type: "select",
                        required: true,
                        defaultValue: cycle,
                        options: [
                            { value: "monthly", label: "Monthly" },
                            { value: "annual", label: "Annual" },
                        ],
                    },
                ]}
                onSubmit={async (values) => {
                    await submitPayment({
                        amount: Number(values.amount),
                        billingCycle: values.billingCycle as "monthly" | "annual",
                        provider: values.provider,
                        providerReference: values.providerReference || undefined,
                    });
                    toast.success("Payment submitted. We will confirm it shortly.");
                }}
            />

            {/* ── Register a device ── */}
            <FormDialog
                open={showDevice}
                onOpenChange={setShowDevice}
                title={t("Register a device")}
                description={t("The device limit comes from your plan and is checked on the server.")}
                submitLabel="Register"
                fields={[
                    {
                        name: "deviceName",
                        label: "Device name",
                        required: true,
                        placeholder: "Till 1 — Kampala Road",
                    },
                    {
                        name: "deviceId",
                        label: "Device identifier",
                        required: true,
                        placeholder: "A stable id for this device",
                    },
                    {
                        name: "platform",
                        label: "Platform",
                        placeholder: "web, android, ios…",
                    },
                ]}
                onSubmit={async (values) => {
                    await registerDevice({
                        deviceId: values.deviceId,
                        deviceName: values.deviceName,
                        platform: values.platform || undefined,
                    });
                    toast.success("Device registered.");
                }}
            />

            {/* ── Redeem a license key ── */}
            <FormDialog
                open={showKey}
                onOpenChange={setShowKey}
                title={t("Redeem a license key")}
                description={t("A key moves your account onto the plan it was issued for.")}
                submitLabel="Redeem key"
                fields={[
                    {
                        name: "key",
                        label: "License key",
                        required: true,
                        full: true,
                        placeholder: "SBUZ-XXXXX-XXXXX-XXXXX-XXXXX",
                    },
                ]}
                onSubmit={async (values) => {
                    await redeemKey({ key: values.key.trim() });
                    toast.success("Key redeemed.");
                }}
            />

            {/* ── Activate (when a verified payment is waiting) ── */}
            {(status === "past_due" || status === "grace" || status === "expired") &&
                canManage && (
                    <div className="flex justify-end">
                        <Button variant="outline" onClick={handleActivate}>
                            <Package className="mr-2 h-4 w-4" />
                            {t("Activate now")}
                        </Button>
                    </div>
                )}
        </div>
    );
}
