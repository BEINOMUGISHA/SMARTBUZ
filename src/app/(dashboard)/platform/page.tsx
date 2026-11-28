"use client";

/**
 * SMARTBUZ — the platform console.
 *
 * The SaaS owner's side of the house: the plans and their pricing, every
 * business's subscription, the payments waiting to be confirmed, and the
 * license keys.
 *
 * Everything here is decided on the server by the platform permissions. The
 * console shows what those permissions allow and refuses the rest.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
    SearchBox,
    FormDialog,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ShieldCheck,
    Layers,
    CreditCard,
    KeyRound,
    Search,
    Ban,
    Play,
    CalendarPlus,
    Repeat,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useT } from "@/i18n/provider";

export default function PlatformConsolePage() {
    
    const t = useT();const whoami = useQuery(api.platform.whoami, {});
    const [tab, setTab] = useState("subscriptions");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [selectedBusiness, setSelectedBusiness] = useState<Id<"businesses"> | null>(
        null
    );
    const [showCreatePlan, setShowCreatePlan] = useState(false);
    const [showEditPlan, setShowEditPlan] = useState<any | null>(null);
    const [showIssueKey, setShowIssueKey] = useState(false);
    const [showExtend, setShowExtend] = useState<any | null>(null);
    const [showChangePlan, setShowChangePlan] = useState<any | null>(null);
    const [showSuspend, setShowSuspend] = useState<any | null>(null);

    const subscriptions = useQuery(
        api.platform.listSubscriptions,
        whoami?.platformRole
            ? { searchTerm: search || undefined, status: statusFilter || undefined }
            : "skip"
    );
    const plans = useQuery(
        api.plans.listAll,
        whoami?.platformRole ? {} : "skip"
    );
    const allPayments = useQuery(
        api.billing.listAllPayments,
        whoami?.platformRole ? { limit: 100 } : "skip"
    );
    const keys = useQuery(
        api.license.listKeys,
        whoami?.platformRole ? {} : "skip"
    );

    const detail = useQuery(
        api.platform.getSubscription,
        selectedBusiness ? { businessId: selectedBusiness } : "skip"
    );

    const activate = useMutation(api.platform.activateSubscription);
    const suspend = useMutation(api.platform.suspendSubscription);
    const reactivate = useMutation(api.platform.reactivateSubscription);
    const extend = useMutation(api.platform.extendSubscription);
    const changePlan = useMutation(api.platform.changePlan);
    const cancel = useMutation(api.platform.cancelSubscription);
    const revokeDevice = useMutation(api.platform.revokeDevice);
    const verifyPayment = useMutation(api.billing.verifyPayment);
    const rejectPayment = useMutation(api.billing.rejectPayment);
    const createPlan = useMutation(api.plans.create);
    const updatePlan = useMutation(api.plans.update);
    const retirePlan = useMutation(api.plans.retire);
    const seedPlans = useMutation(api.plans.seedDefaults);
    const issueKey = useMutation(api.license.issue);
    const revokeKey = useMutation(api.license.revoke);

    const pendingPayments = useMemo(
        () => (allPayments?.page ?? []).filter((p: any) => p.status === "pending"),
        [allPayments]
    );

    if (!whoami) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={ShieldCheck}
                    title={t("Platform console")}
                    description={t("Plans, subscriptions, payments and license keys.")}
                />
                <LoadingState rows={2} />
            </div>
        );
    }

    if (!whoami.platformRole) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={ShieldCheck}
                    title={t("Platform console")}
                    description={t("Plans, subscriptions, payments and license keys.")}
                />
                <EmptyState
                    title={t("This area is for the SMARTBUZ platform team")}
                    hint={t("Your account is not a platform administrator. If you should have access, ask the platform owner to grant it.")}
                />
            </div>
        );
    }

    const counts = subscriptions?.counts;

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={ShieldCheck}
                title={t("Platform console")}
                description={t("Plans, subscriptions, payments and license keys.")}
                actions={
                    <Badge variant="outline" className="text-eyebrow uppercase tracking-eyebrow">
                        {whoami.platformRole.replace(/_/g, " ")}
                    </Badge>
                }
            />

            <StatStrip
                stats={[
                    { label: "Active", value: counts?.active ?? 0, tone: "good" },
                    { label: "On trial", value: counts?.trial ?? 0 },
                    { label: "In grace", value: counts?.grace ?? 0, tone: "warn" },
                    {
                        label: "Suspended / expired",
                        value: (counts?.suspended ?? 0) + (counts?.expired ?? 0),
                        tone: "danger",
                    },
                ]}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="subscriptions">{t("Subscriptions")}</TabsTrigger>
                    <TabsTrigger value="plans">{t("Plans")}</TabsTrigger>
                    <TabsTrigger value="payments">{t("Payments")}</TabsTrigger>
                    <TabsTrigger value="keys">{t("License keys")}</TabsTrigger>
                </TabsList>

                {/* ── Subscriptions ── */}
                <TabsContent value="subscriptions" className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <SearchBox
                            value={search}
                            onChange={setSearch}
                            placeholder={t("Search businesses…")}
                            className="w-full sm:w-72"
                        />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                        >
                            <option value="">{t("All states")}</option>
                            <option value="trial">{t("Trial")}</option>
                            <option value="active">{t("Active")}</option>
                            <option value="grace">{t("Grace")}</option>
                            <option value="past_due">{t("Past due")}</option>
                            <option value="suspended">{t("Suspended")}</option>
                            <option value="expired">{t("Expired")}</option>
                            <option value="cancelled">{t("Cancelled")}</option>
                        </select>
                    </div>

                    {!subscriptions ? (
                        <LoadingState rows={4} />
                    ) : subscriptions.page.length === 0 ? (
                        <EmptyState title={t("No subscriptions match")} />
                    ) : (
                        <div className="space-y-2">
                            {subscriptions.page.map((s: any) => (
                                <button
                                    key={s._id}
                                    type="button"
                                    onClick={() => setSelectedBusiness(s.businessId)}
                                    className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-bold">
                                            {s.businessName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {s.planName} •{" "}
                                            {s.currentPeriodEnd
                                                ? new Date(
                                                      s.currentPeriodEnd
                                                  ).toLocaleDateString("en-UG")
                                                : "no end date"}
                                            {s.daysRemaining !== undefined
                                                ? ` • ${s.daysRemaining} days left`
                                                : ""}
                                        </p>
                                    </div>
                                    <StatusBadge status={s.status} />
                                </button>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── Plans ── */}
                <TabsContent value="plans" className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setShowCreatePlan(true)}>
                            <Layers className="mr-2 h-4 w-4" />
                            {t("New plan")}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={async () => {
                                try {
                                    const res = await seedPlans({});
                                    toast.success(
                                        res.alreadySeeded
                                            ? "The catalogue already has plans — your prices were left alone."
                                            : `Seeded ${res.seeded} plans.`
                                    );
                                } catch (err: any) {
                                    toast.error(formatError(err));
                                }
                            }}
                        >
                            {t("Seed the built-in plans")}
                        </Button>
                    </div>

                    {!plans ? (
                        <LoadingState rows={4} />
                    ) : plans.length === 0 ? (
                        <EmptyState
                            title={t("No plans in the catalogue")}
                            hint={t("Seed the built-in plans, or create one of your own.")}
                        />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {plans.map((p: any) => (
                                <Card key={p._id}>
                                    <CardContent className="space-y-3 p-4">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="text-base font-semibold">{p.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t("key:")} {p.key}
                                                </p>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    p.isActive
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                                                        : "text-xs font-bold"
                                                }
                                            >
                                                {p.isActive ? "On offer" : "Retired"}
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <p className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">
                                                    {t("Monthly")}
                                                </p>
                                                <p className="font-semibold tabular-nums">
                                                    {p.currency}{" "}
                                                    {p.priceMonthly.toLocaleString("en-UG")}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">
                                                    {t("Annual")}
                                                </p>
                                                <p className="font-semibold tabular-nums">
                                                    {p.currency}{" "}
                                                    {p.priceAnnual.toLocaleString("en-UG")}
                                                </p>
                                            </div>
                                        </div>

                                        <p className="text-xs text-muted-foreground">
                                            {p.trialDays}{t("-day trial •")} {p.gracePeriodDays}{t("-day grace •")} {p.deviceLimit || "∞"} {t("devices •")}{" "}
                                            {p.features.length} features
                                        </p>

                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setShowEditPlan(p)}
                                            >
                                                {t("Edit")}
                                            </Button>
                                            {p.isActive && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={async () => {
                                                        try {
                                                            await retirePlan({
                                                                planId: p._id,
                                                                reason: "Retired from the console.",
                                                            });
                                                            toast.success("Plan taken off offer.");
                                                        } catch (err: any) {
                                                            toast.error(formatError(err));
                                                        }
                                                    }}
                                                >
                                                    {t("Retire")}
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── Payments ── */}
                <TabsContent value="payments" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("Payments waiting to be confirmed")}</CardTitle>
                            <CardDescription>
                                {t("A payment is not a payment until it has been confirmed against the provider&apos;s own record. The amount here must match what the provider shows.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {pendingPayments.length === 0 ? (
                                <EmptyState title={t("Nothing waiting")} />
                            ) : (
                                pendingPayments.map((p: any) => (
                                    <div
                                        key={p._id}
                                        className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div>
                                            <p className="text-sm font-bold">
                                                {p.currency} {p.amount.toLocaleString("en-UG")}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {p.businessName ?? p.businessId} • {p.provider}
                                                {p.providerReference
                                                    ? ` • ref ${p.providerReference}`
                                                    : ""}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                onClick={async () => {
                                                    try {
                                                        await verifyPayment({
                                                            paymentId: p._id,
                                                            confirmedAmount: p.amount,
                                                        });
                                                        toast.success("Payment confirmed.");
                                                    } catch (err: any) {
                                                        toast.error(formatError(err));
                                                    }
                                                }}
                                            >
                                                {t("Confirm")}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={async () => {
                                                    try {
                                                        await rejectPayment({
                                                            paymentId: p._id,
                                                            reason: "Not confirmed by the provider.",
                                                        });
                                                        toast.success("Payment rejected.");
                                                    } catch (err: any) {
                                                        toast.error(formatError(err));
                                                    }
                                                }}
                                            >
                                                {t("Reject")}
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── License keys ── */}
                <TabsContent value="keys" className="space-y-4">
                    <Button onClick={() => setShowIssueKey(true)}>
                        <KeyRound className="mr-2 h-4 w-4" />
                        {t("Issue a license key")}
                    </Button>

                    {!keys ? (
                        <LoadingState rows={3} />
                    ) : keys.length === 0 ? (
                        <EmptyState title={t("No license keys issued")} />
                    ) : (
                        <div className="space-y-2">
                            {keys.map((k: any) => (
                                <div
                                    key={k._id}
                                    className="flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold">
                                            {k.keyHint}{" "}
                                            <span className="font-normal text-muted-foreground">
                                                • {k.planKey}
                                            </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {k.businessName ?? "unassigned"} {t("• issued")}{" "}
                                            {new Date(k.issuedAt).toLocaleDateString("en-UG")}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <StatusBadge status={k.status} />
                                        {k.status === "active" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={async () => {
                                                    try {
                                                        await revokeKey({
                                                            licenseId: k._id,
                                                            reason: "Revoked from the console.",
                                                        });
                                                        toast.success("Key revoked.");
                                                    } catch (err: any) {
                                                        toast.error(formatError(err));
                                                    }
                                                }}
                                            >
                                                {t("Revoke")}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* ── Business detail ── */}
            {selectedBusiness && detail && (
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <CardTitle>{detail.business.name}</CardTitle>
                                <CardDescription>
                                    {detail.plan?.name ?? "No plan"} • {detail.status}
                                    {detail.daysRemaining !== undefined
                                        ? ` • ${detail.daysRemaining} days left`
                                        : ""}
                                </CardDescription>
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSelectedBusiness(null)}
                            >
                                {t("Close")}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {detail.status !== "active" && (
                                <Button
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            await activate({
                                                businessId: selectedBusiness,
                                            });
                                            toast.success("Subscription activated.");
                                        } catch (err: any) {
                                            toast.error(formatError(err));
                                        }
                                    }}
                                >
                                    <Play className="mr-2 h-4 w-4" />
                                    {t("Activate")}
                                </Button>
                            )}
                            {detail.status === "suspended" ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                        try {
                                            await reactivate({
                                                businessId: selectedBusiness,
                                            });
                                            toast.success("Subscription restored.");
                                        } catch (err: any) {
                                            toast.error(formatError(err));
                                        }
                                    }}
                                >
                                    <Repeat className="mr-2 h-4 w-4" />
                                    {t("Reactivate")}
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setShowSuspend(detail)}
                                >
                                    <Ban className="mr-2 h-4 w-4" />
                                    {t("Suspend")}
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setShowExtend(detail)}
                            >
                                <CalendarPlus className="mr-2 h-4 w-4" />
                                {t("Extend")}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setShowChangePlan(detail)}
                            >
                                {t("Change plan")}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                    try {
                                        await cancel({
                                            businessId: selectedBusiness,
                                            reason: "Cancelled from the console.",
                                        });
                                        toast.success("Subscription cancelled.");
                                    } catch (err: any) {
                                        toast.error(formatError(err));
                                    }
                                }}
                            >
                                <XCircle className="mr-2 h-4 w-4" />
                                {t("Cancel")}
                            </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    {t("Devices")}
                                </p>
                                {detail.devices.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        {t("No devices registered.")}
                                    </p>
                                ) : (
                                    <div className="space-y-1">
                                        {detail.devices.map((d: any) => (
                                            <div
                                                key={d._id}
                                                className="flex items-center justify-between text-xs"
                                            >
                                                <span className="truncate">
                                                    {d.deviceName}{" "}
                                                    <span className="text-muted-foreground">
                                                        ({d.status})
                                                    </span>
                                                </span>
                                                {d.status === "active" && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={async () => {
                                                            try {
                                                                await revokeDevice({
                                                                    deviceId: d._id,
                                                                    reason:
                                                                        "Revoked from the console.",
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
                            </div>

                            <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    {t("Payments")}
                                </p>
                                {detail.payments.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        {t("No payments recorded.")}
                                    </p>
                                ) : (
                                    <div className="space-y-1">
                                        {detail.payments.map((p: any) => (
                                            <div
                                                key={p._id}
                                                className="flex items-center justify-between text-xs"
                                            >
                                                <span>
                                                    {p.currency}{" "}
                                                    {p.amount.toLocaleString("en-UG")} •{" "}
                                                    {p.provider}
                                                </span>
                                                <StatusBadge status={p.status} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {t("History")}
                            </p>
                            <div className="space-y-1">
                                {detail.history.map((h: any) => (
                                    <p key={h._id} className="text-xs text-muted-foreground">
                                        <span className="font-bold text-foreground">
                                            {h.type.replace(/_/g, " ")}
                                        </span>{" "}
                                        — {h.note ?? `${h.fromStatus} → ${h.toStatus}`} (
                                        {new Date(h.createdAt).toLocaleDateString("en-UG")})
                                    </p>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Create a plan ── */}
            <FormDialog
                open={showCreatePlan}
                onOpenChange={setShowCreatePlan}
                title={t("New plan")}
                description={t("The key is the stable name a subscription refers to. It cannot be changed later.")}
                submitLabel="Create plan"
                fields={[
                    { name: "key", label: "Key", required: true, placeholder: "retail-plus" },
                    { name: "name", label: "Name", required: true },
                    {
                        name: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                    },
                    {
                        name: "priceMonthly",
                        label: "Monthly price",
                        type: "number",
                        required: true,
                        min: 0,
                    },
                    {
                        name: "priceAnnual",
                        label: "Annual price",
                        type: "number",
                        required: true,
                        min: 0,
                    },
                    { name: "trialDays", label: "Trial days", type: "number", min: 0 },
                    { name: "gracePeriodDays", label: "Grace days", type: "number", min: 0 },
                    { name: "deviceLimit", label: "Devices (0 = unlimited)", type: "number", min: 0 },
                    { name: "maxUsers", label: "Staff (0 = unlimited)", type: "number", min: 0 },
                    { name: "maxBranches", label: "Branches (0 = unlimited)", type: "number", min: 0 },
                    {
                        name: "maxWarehouses",
                        label: "Warehouses (0 = unlimited)",
                        type: "number",
                        min: 0,
                    },
                    {
                        name: "maxProducts",
                        label: "Products (0 = unlimited)",
                        type: "number",
                        min: 0,
                    },
                ]}
                onSubmit={async (values) => {
                    await createPlan({
                        key: values.key,
                        name: values.name,
                        description: values.description || undefined,
                        priceMonthly: Number(values.priceMonthly),
                        priceAnnual: Number(values.priceAnnual),
                        trialDays: Number(values.trialDays || 14),
                        gracePeriodDays: Number(values.gracePeriodDays || 7),
                        deviceLimit: Number(values.deviceLimit || 0),
                        maxUsers: Number(values.maxUsers || 0),
                        maxBranches: Number(values.maxBranches || 0),
                        maxWarehouses: Number(values.maxWarehouses || 0),
                        maxProducts: Number(values.maxProducts || 0),
                        features: ["core.sales", "core.stock", "core.customers"],
                    });
                    toast.success("Plan created.");
                }}
            />

            {/* ── Edit a plan ── */}
            <FormDialog
                open={!!showEditPlan}
                onOpenChange={(v) => !v && setShowEditPlan(null)}
                title={showEditPlan ? `Edit ${showEditPlan.name}` : "Edit plan"}
                description={t("A price change applies to the next period. What existing subscribers pay is already recorded on their subscription.")}
                submitLabel="Save"
                fields={[
                    { name: "name", label: "Name", defaultValue: showEditPlan?.name },
                    {
                        name: "priceMonthly",
                        label: "Monthly price",
                        type: "number",
                        defaultValue: showEditPlan?.priceMonthly,
                        min: 0,
                    },
                    {
                        name: "priceAnnual",
                        label: "Annual price",
                        type: "number",
                        defaultValue: showEditPlan?.priceAnnual,
                        min: 0,
                    },
                    {
                        name: "trialDays",
                        label: "Trial days",
                        type: "number",
                        defaultValue: showEditPlan?.trialDays,
                        min: 0,
                    },
                    {
                        name: "gracePeriodDays",
                        label: "Grace days",
                        type: "number",
                        defaultValue: showEditPlan?.gracePeriodDays,
                        min: 0,
                    },
                    {
                        name: "deviceLimit",
                        label: "Devices (0 = unlimited)",
                        type: "number",
                        defaultValue: showEditPlan?.deviceLimit,
                        min: 0,
                    },
                    {
                        name: "maxUsers",
                        label: "Staff (0 = unlimited)",
                        type: "number",
                        defaultValue: showEditPlan?.maxUsers,
                        min: 0,
                    },
                    {
                        name: "maxBranches",
                        label: "Branches (0 = unlimited)",
                        type: "number",
                        defaultValue: showEditPlan?.maxBranches,
                        min: 0,
                    },
                    {
                        name: "maxWarehouses",
                        label: "Warehouses (0 = unlimited)",
                        type: "number",
                        defaultValue: showEditPlan?.maxWarehouses,
                        min: 0,
                    },
                    {
                        name: "maxProducts",
                        label: "Products (0 = unlimited)",
                        type: "number",
                        defaultValue: showEditPlan?.maxProducts,
                        min: 0,
                    },
                ]}
                onSubmit={async (values) => {
                    await updatePlan({
                        planId: showEditPlan._id,
                        name: values.name,
                        priceMonthly: Number(values.priceMonthly),
                        priceAnnual: Number(values.priceAnnual),
                        trialDays: Number(values.trialDays),
                        gracePeriodDays: Number(values.gracePeriodDays),
                        deviceLimit: Number(values.deviceLimit),
                        maxUsers: Number(values.maxUsers),
                        maxBranches: Number(values.maxBranches),
                        maxWarehouses: Number(values.maxWarehouses),
                        maxProducts: Number(values.maxProducts),
                    });
                    toast.success("Plan updated.");
                }}
            />

            {/* ── Issue a license key ── */}
            <FormDialog
                open={showIssueKey}
                onOpenChange={setShowIssueKey}
                title={t("Issue a license key")}
                description={t("The key is shown once and never stored. Only its hash is kept.")}
                submitLabel="Issue key"
                fields={[
                    {
                        name: "planKey",
                        label: "Plan",
                        type: "select",
                        required: true,
                        options: (plans ?? []).map((p: any) => ({
                            value: p.key,
                            label: p.name,
                        })),
                    },
                    {
                        name: "businessId",
                        label: "Business id (optional)",
                        placeholder: "Leave empty for an unassigned key",
                    },
                ]}
                onSubmit={async (values) => {
                    const key = await issueKey({
                        planKey: values.planKey,
                        businessId: values.businessId
                            ? (values.businessId as Id<"businesses">)
                            : undefined,
                    });
                    toast.success(`Key issued: ${key.key} — copy it now, it is not shown again.`);
                }}
            />

            {/* ── Extend ── */}
            <FormDialog
                open={!!showExtend}
                onOpenChange={(v) => !v && setShowExtend(null)}
                title={t("Extend the subscription")}
                submitLabel="Extend"
                fields={[
                    {
                        name: "days",
                        label: "Days",
                        type: "number",
                        required: true,
                        defaultValue: 30,
                        min: 1,
                    },
                    { name: "note", label: "Note", type: "textarea", full: true },
                ]}
                onSubmit={async (values) => {
                    await extend({
                        businessId: showExtend.business._id,
                        days: Number(values.days),
                        note: values.note || undefined,
                    });
                    toast.success("Subscription extended.");
                }}
            />

            {/* ── Change plan ── */}
            <FormDialog
                open={!!showChangePlan}
                onOpenChange={(v) => !v && setShowChangePlan(null)}
                title={t("Change the plan")}
                submitLabel="Change plan"
                fields={[
                    {
                        name: "planKey",
                        label: "Plan",
                        type: "select",
                        required: true,
                        options: (plans ?? []).map((p: any) => ({
                            value: p.key,
                            label: p.name,
                        })),
                    },
                    { name: "note", label: "Note", type: "textarea", full: true },
                ]}
                onSubmit={async (values) => {
                    await changePlan({
                        businessId: showChangePlan.business._id,
                        planKey: values.planKey,
                        note: values.note || undefined,
                    });
                    toast.success("Plan changed.");
                }}
            />

            {/* ── Suspend ── */}
            <FormDialog
                open={!!showSuspend}
                onOpenChange={(v) => !v && setShowSuspend(null)}
                title={t("Suspend the subscription")}
                description={t("The business keeps its data. It simply cannot record anything new until the subscription is restored.")}
                submitLabel="Suspend"
                fields={[
                    {
                        name: "reason",
                        label: "Reason",
                        required: true,
                        full: true,
                        placeholder: "Why is this account being suspended?",
                    },
                ]}
                onSubmit={async (values) => {
                    await suspend({
                        businessId: showSuspend.business._id,
                        reason: values.reason,
                    });
                    toast.success("Subscription suspended.");
                }}
            />
        </div>
    );
}
