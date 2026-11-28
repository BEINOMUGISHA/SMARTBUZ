"use client";

/**
 * SMARTBUZ — integrations.
 *
 * One page for everything SMARTBUZ can talk to: payment providers,
 * messaging channels, till hardware, and the industry packages.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule this page is built around
 * ────────────────────────────────────────────────────────────────────────
 *
 * **An integration is not working until it has been tested against the
 * real provider.**
 *
 * So every adapter here carries a badge that says which of the four
 * states it is in, and the words underneath explain what that means:
 *
 *   • **Not verified** — nothing has been tested. This is where every
 *     adapter starts, including a brand new one.
 *   • **Configured** — the credentials are saved, but nobody has made a
 *     real call with them.
 *   • **Verified** — a live test reached the real provider and it
 *     answered. This is the only state that lets the adapter move money
 *     or send a message.
 *   • **Failed** — a live test was attempted and the provider refused it.
 *
 * The limits are shown next to the badge too, before anything is
 * configured — so a business knows what it is buying before it buys it.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { CATEGORY_SECTORS } from "@/lib/business-categories";
import {
    VerticalPageHeader,
    StatStrip,
    LoadingState,
    EmptyState,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Plug,
    CreditCard,
    MessageSquare,
    Printer,
    Package,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    ShieldCheck,
    ShieldAlert,
    ShieldQuestion,
    Search,
    PlugZap,
    Info,
    Wrench,
    Scale,
    ScanLine,
    Banknote,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { drawerCapabilities, printerCapabilities } from "@/lib/hardware";
import { useT } from "@/i18n/provider";

/** The four verification states, and how each is shown. */
function verificationBadge(status: string) {
    switch (status) {
        case "verified":
            return {
                icon: ShieldCheck,
                label: "Verified",
                className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
            };
        case "configured":
            return {
                icon: ShieldQuestion,
                label: "Configured — not tested",
                className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            };
        case "failed":
            return {
                icon: ShieldAlert,
                label: "Last test failed",
                className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
            };
        default:
            return {
                icon: ShieldQuestion,
                label: "Not verified",
                className: "bg-muted text-muted-foreground border-border",
            };
    }
}

/**
 * The sandbox/live wording for an adapter.
 *
 * Every adapter starts pointed at the provider's sandbox, because a sandbox
 * is the only place a new integration can be tried without risk. The danger
 * is that nobody notices: an owner switches the adapter on, believes real
 * money is moving, and watches a sandbox account instead. So the interface
 * says plainly which side of that line the adapter is on.
 */
function sandboxNotice(adapter: any) {
    if (!adapter.enabled) return null;

    if (adapter.sandbox) {
        return {
            short: "Sandbox",
            label:
                adapter.category === "payment"
                    ? "Sandbox — this will not move real money"
                    : "Sandbox — messages will not reach a real handset",
            className:
                "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
        };
    }

    return {
        short: "Live",
        label: "Live",
        className:
            "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
    };
}

/** The icon for an adapter's category. */
function categoryIcon(category: string) {
    switch (category) {
        case "payment":
            return CreditCard;
        case "messaging":
            return MessageSquare;
        case "hardware":
            return Printer;
        default:
            return Plug;
    }
}

export default function IntegrationsPage() {
    
    const t = useT();const { can } = useAuth();
    const convex = useConvex();
    const canView = can("integrations.view");
    const canManage = can("integrations.manage");
    const canTest = can("integrations.test");

    const [tab, setTab] = useState("providers");

    const adapters = useQuery(api.integrations.manage.listAdapters, canView ? {} : "skip");
    const hardware = useQuery(
        api.integrations.hardware.listHardwareWithCatalogue,
        canView ? {} : "skip"
    );
    const packages = useQuery(api.packages.manage.listPackages, canView ? {} : "skip");

    // The payments taken through an adapter. The query needs the finance
    // permission, so it is skipped rather than allowed to fail for a role
    // that is allowed to configure an adapter but not to read the takings.
    const canSeePayments = can("finance.view");
    const paymentHistory = useQuery(
        api.integrations.payments.listPaymentIntents,
        canSeePayments ? { limit: 25 } : "skip"
    );

    const saveConfig = useMutation(api.integrations.manage.saveAdapterConfig);
    const setEnabled = useMutation(api.integrations.manage.setAdapterEnabled);

    const [testing, setTesting] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

    const payments = useMemo(
        () => (adapters ?? []).filter((a: any) => a.category === "payment"),
        [adapters]
    );
    const messaging = useMemo(
        () => (adapters ?? []).filter((a: any) => a.category === "messaging"),
        [adapters]
    );

    const verifiedCount = useMemo(
        () => (adapters ?? []).filter((a: any) => a.verificationStatus === "verified").length,
        [adapters]
    );
    const enabledCount = useMemo(
        () => (adapters ?? []).filter((a: any) => a.enabled).length,
        [adapters]
    );

    if (!canView) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={Plug}
                    title={t("Integrations")}
                    description={t("Payment providers, messaging channels, till hardware and industry packages.")}
                />
                <EmptyState
                    title={t("You may not view this")}
                    hint={t("Ask the owner or an administrator if you need to see the integrations.")}
                />
            </div>
        );
    }

    /**
     * Run the live test.
     *
     * This makes a real call to the provider. The result says what the
     * provider actually answered — there is no "assume it worked" path.
     */
    const runLiveTest = async (adapterKey: string) => {
        setTesting(adapterKey);
        try {
            const result = await convex.action(
                api.integrations.engine.runLiveTest,
                { adapterKey }
            );
            if (result.ok) {
                toast.success(result.detail);
            } else {
                toast.error(result.detail);
            }
        } catch (err: any) {
            toast.error(formatError(err));
        } finally {
            setTesting(null);
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Plug}
                title={t("Integrations")}
                description={t("Payment providers, messaging channels, till hardware and industry packages.")}
            />

            {adapters === undefined ? (
                <LoadingState />
            ) : (
                <>
                    <StatStrip
                        stats={[
                            {
                                label: "Adapters",
                                value: String(adapters.length),
                                tone: "default",
                            },
                            {
                                label: "Switched on",
                                value: String(enabledCount),
                                tone: "default",
                            },
                            {
                                label: "Verified",
                                value: String(verifiedCount),
                                tone: verifiedCount > 0 ? "good" : "warn",
                            },
                        ]}
                    />

                    <Tabs value={tab} onValueChange={setTab}>
                        <TabsList>
                            <TabsTrigger value="providers">{t("Providers")}</TabsTrigger>
                            <TabsTrigger value="hardware">{t("Hardware")}</TabsTrigger>
                            <TabsTrigger value="packages">{t("Industry packages")}</TabsTrigger>
                        </TabsList>

                        {/* ── Providers ─────────────────────────────────── */}
                        <TabsContent value="providers" className="space-y-6 mt-4">
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <CreditCard className="h-4 w-4" />
                                    {t("Payments")}
                                </h3>
                                {payments.map((adapter: any) => (
                                    <AdapterCard
                                        key={adapter.key}
                                        adapter={adapter}
                                        canManage={canManage}
                                        canTest={canTest}
                                        testing={testing === adapter.key}
                                        draft={drafts[adapter.key] ?? {}}
                                        onDraft={(key, value) =>
                                            setDrafts((prev) => ({
                                                ...prev,
                                                [adapter.key]: {
                                                    ...(prev[adapter.key] ?? {}),
                                                    [key]: value,
                                                },
                                            }))
                                        }
                                        onSave={async (config, secrets) => {
                                            try {
                                                await saveConfig({
                                                    adapterKey: adapter.key,
                                                    config,
                                                    secrets,
                                                });
                                                setDrafts((prev) => {
                                                    const next = { ...prev };
                                                    delete next[adapter.key];
                                                    return next;
                                                });
                                                toast.success(
                                                    `${adapter.label} saved. Run the live test to prove it works.`
                                                );
                                            } catch (err: any) {
                                                toast.error(formatError(err));
                                            }
                                        }}
                                        onToggle={async (enabled: boolean) => {
                                            try {
                                                await setEnabled({
                                                    adapterKey: adapter.key,
                                                    enabled,
                                                });
                                                toast.success(
                                                    enabled
                                                        ? `${adapter.label} switched on.`
                                                        : `${adapter.label} switched off.`
                                                );
                                            } catch (err: any) {
                                                toast.error(formatError(err));
                                            }
                                        }}
                                        onTest={() => runLiveTest(adapter.key)}
                                    />
                                ))}
                            </div>

                            {/* ── Payment history ─────────────────────────── */}
                            {/*
                             * The sandbox flag is repeated on every payment,
                             * not only on the adapter. A row in this list is
                             * the evidence a business shows a customer that
                             * they paid, so it must say on its own whether
                             * any real money moved.
                             */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <Banknote className="h-4 w-4" />
                                    {t("Payment history")}
                                </h3>

                                {!canSeePayments ? (
                                    <p className="text-xs text-muted-foreground">
                                        {t("Your role can configure the payment providers but cannot read the payments taken through them.")}
                                    </p>
                                ) : paymentHistory === undefined ? (
                                    <LoadingState rows={2} />
                                ) : paymentHistory.length === 0 ? (
                                    <EmptyState
                                        title={t("No payments yet")}
                                        hint={t("Payments taken through a provider appear here, with the environment they were taken in.")}
                                    />
                                ) : (
                                    <div className="space-y-2">
                                        {paymentHistory.map((payment: any) => (
                                            <div
                                                key={payment.id}
                                                className="rounded-xl border bg-card p-3 shadow-sm"
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-xs">
                                                        {payment.reference}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className={
                                                            payment.sandbox
                                                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                                                                : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                                                        }
                                                    >
                                                        {payment.sandbox
                                                            ? "Sandbox — no real money moved"
                                                            : "Live — real money"}
                                                    </Badge>
                                                    <Badge variant="outline">
                                                        {payment.status}
                                                    </Badge>
                                                </div>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {payment.adapterKey} ·{" "}
                                                    {payment.currency}{" "}
                                                    {Number(payment.amount).toLocaleString()} {t("· created")}{" "}
                                                    {new Date(
                                                        payment.createdAt
                                                    ).toLocaleString()}
                                                    {payment.phone
                                                        ? ` · ${payment.phone}`
                                                        : ""}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4" />
                                    {t("Messaging")}
                                </h3>
                                {messaging.map((adapter: any) => (
                                    <AdapterCard
                                        key={adapter.key}
                                        adapter={adapter}
                                        canManage={canManage}
                                        canTest={canTest}
                                        testing={testing === adapter.key}
                                        draft={drafts[adapter.key] ?? {}}
                                        onDraft={(key, value) =>
                                            setDrafts((prev) => ({
                                                ...prev,
                                                [adapter.key]: {
                                                    ...(prev[adapter.key] ?? {}),
                                                    [key]: value,
                                                },
                                            }))
                                        }
                                        onSave={async (config, secrets) => {
                                            try {
                                                await saveConfig({
                                                    adapterKey: adapter.key,
                                                    config,
                                                    secrets,
                                                });
                                                setDrafts((prev) => {
                                                    const next = { ...prev };
                                                    delete next[adapter.key];
                                                    return next;
                                                });
                                                toast.success(
                                                    `${adapter.label} saved. Run the live test to prove it works.`
                                                );
                                            } catch (err: any) {
                                                toast.error(formatError(err));
                                            }
                                        }}
                                        onToggle={async (enabled: boolean) => {
                                            try {
                                                await setEnabled({
                                                    adapterKey: adapter.key,
                                                    enabled,
                                                });
                                                toast.success(
                                                    enabled
                                                        ? `${adapter.label} switched on.`
                                                        : `${adapter.label} switched off.`
                                                );
                                            } catch (err: any) {
                                                toast.error(formatError(err));
                                            }
                                        }}
                                        onTest={() => runLiveTest(adapter.key)}
                                    />
                                ))}
                            </div>
                        </TabsContent>

                        {/* ── Hardware ───────────────────────────────────── */}
                        <TabsContent value="hardware" className="space-y-4 mt-4">
                            <HardwareTab hardware={hardware} canManage={canManage} />
                        </TabsContent>

                        {/* ── Industry packages ─────────────────────────── */}
                        <TabsContent value="packages" className="space-y-4 mt-4">
                            <PackagesTab packages={packages} />
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * One adapter
 * ──────────────────────────────────────────────────────────────────────── */

interface AdapterCardProps {
    adapter: any;
    canManage: boolean;
    canTest: boolean;
    testing: boolean;
    draft: Record<string, string>;
    onDraft: (key: string, value: string) => void;
    onSave: (config: Record<string, unknown>, secrets: Record<string, string>) => Promise<void>;
    onToggle: (enabled: boolean) => Promise<void>;
    onTest: () => Promise<void>;
}

function AdapterCard({
    adapter,
    canManage,
    canTest,
    testing,
    draft,
    onDraft,
    onSave,
    onToggle,
    onTest,
}: AdapterCardProps) {
    
    const t = useT();const [open, setOpen] = useState(false);
    const badge = verificationBadge(adapter.verificationStatus);
    const BadgeIcon = badge.icon;
    const Icon = categoryIcon(adapter.category);
    const environment = sandboxNotice(adapter);

    const pendingConfig: Record<string, unknown> = {};
    const pendingSecrets: Record<string, string> = {};

    for (const field of adapter.fields) {
        const value = draft[field.key];
        if (value === undefined || value === "") continue;
        if (field.type === "secret") {
            pendingSecrets[field.key] = value;
        } else if (field.type === "boolean") {
            pendingConfig[field.key] = value === "true";
        } else if (field.type === "number") {
            pendingConfig[field.key] = Number(value);
        } else {
            pendingConfig[field.key] = value;
        }
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <CardTitle className="text-base flex flex-wrap items-center gap-2">
                                {t(adapter.label)}
                                <Badge variant="outline" className={badge.className}>
                                    <BadgeIcon className="h-3 w-3 mr-1" />
                                    {t(badge.label)}
                                </Badge>
                                {environment && (
                                    <Badge
                                        variant="outline"
                                        className={environment.className}
                                    >
                                        {t(environment.label)}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {t(adapter.summary)}
                            </CardDescription>
                            <p className="text-xs text-muted-foreground mt-1">
                                {adapter.vendor}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {canManage && (
                            <div className="flex items-center gap-2">
                                <Label
                                    htmlFor={`enabled-${adapter.key}`}
                                    className="text-xs text-muted-foreground"
                                >
                                    {adapter.enabled ? "On" : "Off"}
                                </Label>
                                <Switch
                                    id={`enabled-${adapter.key}`}
                                    checked={adapter.enabled}
                                    onCheckedChange={(checked) => onToggle(checked)}
                                />
                            </div>
                        )}
                        {canManage && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setOpen((v) => !v)}
                            >
                                {open ? "Close" : "Configure"}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {/*
                 * The sandbox warning.
                 *
                 * It is in the body, not behind a hover, because the moment
                 * it is missed is the moment a business believes it has
                 * taken a payment it never took.
                 */}
                {adapter.enabled && adapter.sandbox && (
                    <div
                        role="alert"
                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
                    >
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="text-xs min-w-0 space-y-1.5">
                                <p className="font-semibold text-amber-800 dark:text-amber-200">
                                    {t("Sandbox —")}{" "}
                                    {adapter.category === "payment"
                                        ? "this will not move real money."
                                        : "messages will not reach a real handset."}
                                </p>
                                <p className="text-muted-foreground">
                                    {t("This adapter is switched on, but it is still pointed at the provider&apos;s sandbox. Nothing it does reaches a real account.")}
                                </p>
                                <p className="text-muted-foreground">
                                    {canManage ? (
                                        <>
                                            {t("To go live, open")}{" "}
                                            <span className="font-medium text-foreground">
                                                {t("Configure")}
                                            </span>
                                            {t(", set")}{" "}
                                            <span className="font-medium text-foreground">
                                                {t("Environment")}
                                            </span>{" "}
                                            to{" "}
                                            <span className="font-medium text-foreground">
                                                {t("Live")}
                                            </span>
                                            {t(", save, and then run the verification test again.")}
                                        </>
                                    ) : (
                                        <>
                                            {t("To go live, an administrator has to set")}{" "}
                                            <span className="font-medium text-foreground">
                                                {t("Environment")}
                                            </span>{" "}
                                            to{" "}
                                            <span className="font-medium text-foreground">
                                                {t("Live")}
                                            </span>{" "}
                                            {t("and re-verify the adapter.")}
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* What has to happen before it works */}
                <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="text-xs space-y-1.5 min-w-0">
                            <p className="font-medium">
                                {adapter.verification.method}
                            </p>
                            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                                {adapter.verification.requires.map((r: string) => (
                                    <li key={r}>{r}</li>
                                ))}
                            </ul>
                            <p className="text-muted-foreground">
                                {adapter.verification.testDescription}
                            </p>
                            {adapter.verification.docs && (
                                <a
                                    href={adapter.verification.docs}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2"
                                >
                                    {t("The provider&apos;s own documentation")}
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {/* The limits, stated up front */}
                {adapter.limitations && adapter.limitations.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="text-xs min-w-0">
                                <p className="font-medium mb-1">{t("What it does not do")}</p>
                                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                                    {adapter.limitations.map((l: string) => (
                                        <li key={l}>{l}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* The last test */}
                {adapter.lastTestedAt && (
                    <p className="text-xs text-muted-foreground">
                        {t("Last tested")} {new Date(adapter.lastTestedAt).toLocaleString()}
                        {adapter.lastTestResult ? ` — ${adapter.lastTestResult}` : ""}
                    </p>
                )}

                {/* What is still missing */}
                {adapter.missing && adapter.missing.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        {t("Still needed:")} {adapter.missing.join(", ")}
                    </p>
                )}

                {/* The configuration form */}
                {open && canManage && (
                    <div className="space-y-3 pt-2 border-t">
                        {adapter.fields.map((field: any) => (
                            <div key={field.key} className="space-y-1.5">
                                <Label htmlFor={`${adapter.key}-${field.key}`} className="text-xs font-semibold">
                                    {t(field.label)}
                                    {field.required && (
                                        <span className="text-destructive ml-1">*</span>
                                    )}
                                </Label>

                                {field.type === "boolean" ? (
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id={`${adapter.key}-${field.key}`}
                                            checked={Boolean(draft[field.key] ?? field.value)}
                                            onCheckedChange={(checked) =>
                                                onDraft(field.key, String(checked))
                                            }
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {field.help}
                                        </span>
                                    </div>
                                ) : field.type === "enum" && field.options ? (
                                    <select
                                        id={`${adapter.key}-${field.key}`}
                                        value={String(draft[field.key] ?? field.value ?? "")}
                                        onChange={(e) => onDraft(field.key, e.target.value)}
                                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                    >
                                        {field.options.map((o: any) => (
                                            <option key={o.value} value={o.value}>
                                                {t(o.label)}
                                            </option>
                                        ))}
                                    </select>
                                ) : field.type === "secret" ? (
                                    <Input
                                        id={`${adapter.key}-${field.key}`}
                                        type="password"
                                        placeholder={
                                            field.hasValue
                                                ? "Saved — leave blank to keep it"
                                                : field.placeholder
                                        }
                                        value={draft[field.key] ?? ""}
                                        onChange={(e) => onDraft(field.key, e.target.value)}
                                    />
                                ) : (
                                    <Input
                                        id={`${adapter.key}-${field.key}`}
                                        type={field.type === "number" ? "number" : "text"}
                                        placeholder={t(field.placeholder)}
                                        value={String(draft[field.key] ?? field.value ?? "")}
                                        onChange={(e) => onDraft(field.key, e.target.value)}
                                    />
                                )}

                                {field.type !== "boolean" && field.help && (
                                    <p className="text-xs text-muted-foreground">
                                        {field.help}
                                    </p>
                                )}
                                {field.type === "secret" && field.hasValue && (
                                    <p className="text-xs text-muted-foreground">
                                        {t("A value is saved. It is encrypted and cannot be read back — only replaced.")}
                                    </p>
                                )}
                            </div>
                        ))}

                        <Button
                            size="sm"
                            onClick={() => onSave(pendingConfig, pendingSecrets)}
                            disabled={Object.keys(draft).length === 0}
                        >
                            {t("Save configuration")}
                        </Button>
                    </div>
                )}

                {/* The live test */}
                {canTest && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        {adapter.supportsLiveTest ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onTest}
                                disabled={testing || !adapter.enabled}
                                className="gap-1.5"
                            >
                                {testing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <PlugZap className="h-3.5 w-3.5" />
                                )}
                                {t("Run the live test")}
                            </Button>
                        ) : (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Info className="h-3 w-3" />
                                {adapter.verification.testDescription}
                            </p>
                        )}

                        {!adapter.enabled && (
                            <span className="text-xs text-muted-foreground">
                                {t("Switch the adapter on to test it.")}
                            </span>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Hardware
 * ──────────────────────────────────────────────────────────────────────── */

function HardwareTab({ hardware, canManage }: { hardware: any; canManage: boolean }) {
    
    const t = useT();const [showCapabilities, setShowCapabilities] = useState(false);

    if (!hardware) return <LoadingState />;

    const printerCaps = printerCapabilities();
    const drawerCaps = drawerCapabilities();

    return (
        <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs space-y-1">
                    <p className="font-medium">{t("What this browser can do")}</p>
                    <p className="text-muted-foreground">
                        {t("Hardware runs in the browser, because the browser is what can reach a USB or serial port. What is available depends on the browser and the machine.")}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCapabilities((v) => !v)}
                    className="gap-1.5"
                >
                    <Wrench className="h-3.5 w-3.5" />
                    {showCapabilities ? "Hide" : "Check"} this browser
                </Button>
            </div>

            {showCapabilities && (
                <div className="rounded-lg border p-3 space-y-2 text-xs">
                    <div className="grid gap-1.5 sm:grid-cols-2">
                        <Capability label={t("Serial port (USB scales, printers)")} ok={printerCaps.webSerial} />
                        <Capability label={t("USB devices")} ok={printerCaps.webUsb} />
                        <Capability label={t("Bluetooth devices")} ok={printerCaps.webBluetooth} />
                        <Capability label={t("Cash drawer via the printer")} ok={drawerCaps.escposViaPrinter} />
                    </div>
                    <p className="text-muted-foreground pt-1">{drawerCaps.detail}</p>
                </div>
            )}

            {hardware.map((item: any) => (
                <Card key={item.key}>
                    <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                            <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                {item.kind === "barcode_scanner" ? (
                                    <ScanLine className="h-4 w-4" />
                                ) : item.kind === "thermal_printer" ? (
                                    <Printer className="h-4 w-4" />
                                ) : item.kind === "cash_drawer" ? (
                                    <Banknote className="h-4 w-4" />
                                ) : (
                                    <Scale className="h-4 w-4" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="text-base">{t(item.label)}</CardTitle>
                                <CardDescription className="mt-1">{t(item.summary)}</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="text-xs space-y-1.5">
                            <p className="font-medium">{t("What it needs")}</p>
                            <ul className="list-disc list-inside text-muted-foreground">
                                {item.requirements.map((r: string) => (
                                    <li key={r}>{r}</li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <div className="text-xs">
                                    <p className="font-medium mb-1">{t("What it does not do")}</p>
                                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                                        {item.limitations.map((l: string) => (
                                            <li key={l}>{l}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="text-xs">
                            <p className="font-medium">{t("How it is proved")}</p>
                            <p className="text-muted-foreground">{item.verification.method}</p>
                        </div>

                        {item.devices.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-xs font-medium">{t("Registered devices")}</p>
                                {item.devices.map((device: any) => (
                                    <div
                                        key={device.id}
                                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                                    >
                                        <span>{device.name}</span>
                                        <Badge variant="outline">
                                            {device.status === "verified" ? (
                                                <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                                            ) : null}
                                            {device.status === "verified"
                                                ? "Verified by a person"
                                                : device.status === "not_working"
                                                  ? "Not working"
                                                  : "Never confirmed"}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}

                        {item.devices.length === 0 && canManage && (
                            <p className="text-xs text-muted-foreground">
                                {t("No device is registered for this yet. Register one from the till once the hardware is connected.")}
                            </p>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function Capability({ label, ok }: { label: string; ok: boolean }) {
    return (
        <div className="flex items-center gap-2">
            {ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
            ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            )}
            <span className="text-muted-foreground">
                {label} — {ok ? "available" : "not available in this browser"}
            </span>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Industry packages
 * ──────────────────────────────────────────────────────────────────────── */

function PackagesTab({ packages }: { packages: any }) {
    
    const t = useT();const enablePackage = useMutation(api.packages.manage.enablePackage);
    const setFeature = useMutation(api.packages.manage.setPackageFeature);
    const setSettings = useMutation(api.packages.manage.setPackageSettings);

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"all" | "on" | "off">("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    if (!packages) return <LoadingState />;

    /**
     * There are now as many packages as there are trades, so a flat list
     * of cards is a wall. The list is searched, filtered and grouped by
     * the sector the trade sits in, and only the package being worked on
     * is open.
     */
    const term = search.trim().toLowerCase();

    const matching = packages.filter((pkg: any) => {
        const matchesFilter =
            filter === "all" || (filter === "on" ? pkg.enabled : !pkg.enabled);
        if (!matchesFilter) return false;
        if (!term) return true;
        return (
            pkg.label.toLowerCase().includes(term) ||
            pkg.summary.toLowerCase().includes(term) ||
            pkg.features.some(
                (feature: any) =>
                    feature.label.toLowerCase().includes(term) ||
                    feature.summary.toLowerCase().includes(term)
            )
        );
    });

    const sectorOf = (categoryId: string) =>
        CATEGORY_SECTORS.find((sector) =>
            (sector.categories as string[]).includes(categoryId)
        );

    const grouped = CATEGORY_SECTORS.map((sector) => ({
        sector,
        items: matching.filter(
            (pkg: any) => sectorOf(pkg.categoryId)?.id === sector.id
        ),
    })).filter((group) => group.items.length > 0);

    const ungrouped = matching.filter(
        (pkg: any) => !sectorOf(pkg.categoryId)
    );

    const onCount = packages.filter((pkg: any) => pkg.enabled).length;

    const renderPackage = (pkg: any) => {
        const isOpen = expanded === pkg.key;

        return (
            <Card key={pkg.key}>
                <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : pkg.key)}
                            className="flex min-w-0 flex-1 items-start gap-3 text-left"
                            aria-expanded={isOpen}
                        >
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Package className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    {t(pkg.label)}
                                    {pkg.enabled && (
                                        <Badge
                                            variant="success"
                                            className="border-green-500/20"
                                        >
                                            {t("On")}
                                        </Badge>
                                    )}
                                    <span className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                        {pkg.features.length} {t("features ·")}{" "}
                                        {pkg.modules?.length ?? 0} screens
                                    </span>
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    {t(pkg.summary)}
                                </CardDescription>
                            </div>
                        </button>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpanded(isOpen ? null : pkg.key)}
                            >
                                {isOpen ? "Close" : "Open"}
                            </Button>
                            <Button
                                variant={pkg.enabled ? "outline" : "default"}
                                size="sm"
                                onClick={async () => {
                                    try {
                                        await enablePackage({
                                            packageKey: pkg.key,
                                            enabled: !pkg.enabled,
                                        });
                                        toast.success(
                                            pkg.enabled
                                                ? `${pkg.label} switched off. Nothing it produced was deleted.`
                                                : `${pkg.label} switched on — ${pkg.modules?.length ?? 0} screens added to the menu.`
                                        );
                                    } catch (err: any) {
                                        toast.error(formatError(err));
                                    }
                                }}
                            >
                                {pkg.enabled ? "Switch off" : "Switch on"}
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                {isOpen && (
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                {t("Features")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t("A feature that is switched off is refused by the app: the work it belongs to cannot be done until the feature is back on.")}
                            </p>
                            {pkg.features.map((feature: any) => (
                                <div
                                    key={feature.key}
                                    className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                                >
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium">
                                            {t(feature.label)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t(feature.summary)}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={feature.enabled}
                                        disabled={!pkg.enabled}
                                        onCheckedChange={async (checked) => {
                                            try {
                                                await setFeature({
                                                    packageKey: pkg.key,
                                                    featureKey: feature.key,
                                                    enabled: checked,
                                                });
                                            } catch (err: any) {
                                                toast.error(formatError(err));
                                            }
                                        }}
                                    />
                                </div>
                            ))}
                        </div>

                        {pkg.settings.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                    {t("Settings")}
                                </p>
                                {pkg.settings.map((setting: any) => (
                                    <div
                                        key={setting.key}
                                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium">
                                                {t(setting.label)}
                                            </p>
                                            {setting.help && (
                                                <p className="text-xs text-muted-foreground">
                                                    {setting.help}
                                                </p>
                                            )}
                                        </div>
                                        <div className="shrink-0">
                                            {setting.type === "boolean" ? (
                                                <Switch
                                                    checked={Boolean(setting.value)}
                                                    disabled={!pkg.enabled}
                                                    onCheckedChange={async (checked) => {
                                                        try {
                                                            await setSettings({
                                                                packageKey: pkg.key,
                                                                settings: {
                                                                    [setting.key]: checked,
                                                                },
                                                            });
                                                        } catch (err: any) {
                                                            toast.error(formatError(err));
                                                        }
                                                    }}
                                                />
                                            ) : setting.type === "enum" ? (
                                                <select
                                                    value={String(setting.value ?? "")}
                                                    disabled={!pkg.enabled}
                                                    onChange={async (e) => {
                                                        try {
                                                            await setSettings({
                                                                packageKey: pkg.key,
                                                                settings: {
                                                                    [setting.key]: e.target.value,
                                                                },
                                                            });
                                                        } catch (err: any) {
                                                            toast.error(formatError(err));
                                                        }
                                                    }}
                                                    className="h-8 rounded-md border bg-background px-2 text-xs"
                                                >
                                                    {(setting.options ?? []).map(
                                                        (o: any) => (
                                                            <option
                                                                key={o.value}
                                                                value={o.value}
                                                            >
                                                                {t(o.label)}
                                                            </option>
                                                        )
                                                    )}
                                                </select>
                                            ) : (
                                                <Input
                                                    type={
                                                        setting.type === "number"
                                                            ? "number"
                                                            : "text"
                                                    }
                                                    defaultValue={String(
                                                        setting.value ?? ""
                                                    )}
                                                    disabled={!pkg.enabled}
                                                    className="h-8 w-40 text-xs"
                                                    onBlur={async (e) => {
                                                        const raw = e.target.value;
                                                        const value =
                                                            setting.type === "number"
                                                                ? Number(raw)
                                                                : raw;
                                                        if (
                                                            String(value) ===
                                                            String(
                                                                setting.value ?? ""
                                                            )
                                                        ) {
                                                            return;
                                                        }
                                                        try {
                                                            await setSettings({
                                                                packageKey: pkg.key,
                                                                settings: {
                                                                    [setting.key]: value,
                                                                },
                                                            });
                                                        } catch (err: any) {
                                                            toast.error(formatError(err));
                                                        }
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(pkg.modules?.length ?? 0) > 0 && (
                            <div className="space-y-2">
                                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                    {t("The screens it brings")}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {pkg.modules.map((moduleId: string) => (
                                        <Badge
                                            key={moduleId}
                                            variant="outline"
                                            className="font-normal"
                                        >
                                            {moduleId}
                                        </Badge>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {t("Switching this on puts these screens in the menu. Switching it off takes them away again — nothing they produced is deleted.")}
                                </p>
                            </div>
                        )}

                        {pkg.limitations.length > 0 && (
                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <div className="text-xs">
                                        <p className="mb-1 font-medium">
                                            {t("What it does not do")}
                                        </p>
                                        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                                            {pkg.limitations.map((l: string) => (
                                                <li key={l}>{l}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                )}
            </Card>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={t("Search the trades…")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-9 pl-10"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={filter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter("all")}
                    >
                        {t("All")} {packages.length}
                    </Button>
                    <Button
                        variant={filter === "on" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter("on")}
                    >
                        {t("On")} {onCount}
                    </Button>
                    <Button
                        variant={filter === "off" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter("off")}
                    >
                        {t("Off")} {packages.length - onCount}
                    </Button>
                </div>
            </div>

            {matching.length === 0 ? (
                <EmptyState
                    title={t("No trade matches that")}
                    hint={t("Try a different word, or clear the filter.")}
                />
            ) : (
                <>
                    {grouped.map(({ sector, items }) => (
                        <section key={sector.id} className="space-y-3">
                            <div>
                                <h3 className="text-section-title font-semibold">
                                    {sector.name}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {t(sector.description)}
                                </p>
                            </div>
                            <div className="space-y-3">
                                {items.map((pkg: any) => renderPackage(pkg))}
                            </div>
                        </section>
                    ))}

                    {ungrouped.length > 0 && (
                        <section className="space-y-3">
                            <div>
                                <h3 className="text-section-title font-semibold">
                                    {t("Other trades")}
                                </h3>
                            </div>
                            <div className="space-y-3">
                                {ungrouped.map((pkg: any) => renderPackage(pkg))}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
