"use client";

/**
 * SMART_BUZ — registration.
 *
 * A person joins SMART_BUZ by saying three things: who they are, what they
 * trade in, and where they trade from. This screen asks all three in one
 * sitting, so the workspace is theirs when they arrive — instead of making
 * an account, sending them to their inbox, and then asking the same three
 * questions again in a second wizard.
 *
 * The trade decides everything that follows: the VAT handling, the words on
 * the screen ("counter" or "table"), the modules, the receipts. It is
 * therefore the first of the three, and the person sees exactly what it
 * brings before they commit to it.
 *
 * The screens themselves are the person's own choice. A pharmacy owner may
 * want prescriptions and batches but not a restaurant's table orders; the
 * trade offers the screens, the person picks the ones they will use.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft, ArrowRight, MailCheck, Store, Check } from "lucide-react";
import { useT } from "@/i18n/provider";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import {
    BUSINESS_CATEGORIES,
    type CategoryId,
} from "@/lib/business-categories";
import { MODULE_REGISTRY } from "@/lib/category-nav";
import { CategoryPicker } from "@/components/setup/category-picker";
import { BranchEditor, emptyBranch, type BranchDraft } from "@/components/setup/branch-editor";
import { PlanPicker } from "@/components/subscription/plan-picker";
import { cn } from "@/lib/utils";

/**
 * The four steps, in order.
 *
 * The labels are translated where they are shown, not here: the translator
 * is not available at module scope.
 */
const STEP_COUNT = 4;

export default function RegisterPage() {
    const t = useT();
    const router = useRouter();

    const [step, setStep] = useState(0);

    const [form, setForm] = useState({
        first_name: "",
        last_name: "",
        email: "",
        phone_number: "",
        password: "",
        confirmPassword: "",
    });

    const [business, setBusiness] = useState({
        name: "",
        categoryId: "" as CategoryId | "",
        currency: DEFAULT_CURRENCY,
        address: "",
        phone: "",
    });

    const [branches, setBranches] = useState<BranchDraft[]>([
        { ...emptyBranch(), name: "Main Branch", isDefault: true },
    ]);

    /** The screens this person wants. Unset means "every screen the trade brings". */
    const [modules, setModules] = useState<string[] | null>(null);

    const [planKey, setPlanKey] = useState<string | null>(null);

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);

    /**
     * The account exists but cannot sign in until the address is proven.
     *
     * This is the second step of registration.
     */
    const [awaitingVerification, setAwaitingVerification] = useState(false);
    const [code, setCode] = useState("");
    const [verifying, setVerifying] = useState(false);

    const category = business.categoryId
        ? BUSINESS_CATEGORIES.find((c) => c.id === business.categoryId) ?? null
        : null;

    /** The screens the trade brings, and the ones this person kept. */
    const tradeModules = category?.modules ?? [];
    const chosenModules = modules ?? tradeModules;

    const handleChange = (key: string, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    /** Turn one of the trade's screens on or off. */
    const toggleModule = (moduleId: string) => {
        setModules((current) => {
            const list = current ?? tradeModules;
            const next = list.includes(moduleId)
                ? list.filter((m) => m !== moduleId)
                : [...list, moduleId];
            // The dashboard is not a screen anybody can do without.
            if (!next.includes("dashboard")) next.push("dashboard");
            return next;
        });
    };

    /* ── Step by step ──────────────────────────────────────────────── */

    const accountComplete =
        form.first_name.trim() &&
        form.last_name.trim() &&
        form.email.trim() &&
        form.password.length >= 8 &&
        form.password === form.confirmPassword;

    const businessComplete = business.name.trim().length >= 2 && !!business.categoryId;

    const branchesComplete = branches.every((b) => b.name.trim().length > 0);

    const canContinue = [accountComplete, businessComplete, branchesComplete, true][step];

    /* ── Sending ───────────────────────────────────────────────────── */

    /**
     * Ask the server to email a verification code.
     *
     * The code never reaches the browser — only the inbox.
     */
    const sendVerificationCode = async (email: string) => {
        setSending(true);
        try {
            const response = await fetch("/api/auth/send-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            if (!response.ok) throw new Error("Could not send the verification code.");
        } catch {
            // The account is created either way; the user can ask for another
            // code from the sign-in screen.
        } finally {
            setSending(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (form.password !== form.confirmPassword) {
            toast.error(t("Passwords do not match"));
            return;
        }

        if (form.password.length < 8) {
            toast.error(t("Password must be at least 8 characters long"));
            return;
        }

        if (!category) {
            toast.error(t("Choose the trade you are in."));
            return;
        }

        setLoading(true);
        try {
            // The server creates the account *and* the business, and emails
            // the verification code. The code never comes back through the
            // browser.
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    first_name: form.first_name,
                    last_name: form.last_name,
                    email: form.email,
                    password: form.password,
                    phone_number: form.phone_number || undefined,
                    business: {
                        name: business.name.trim(),
                        categoryId: category.id,
                        modules: chosenModules,
                        currency: business.currency,
                        timezone: "Africa/Kampala",
                        country: "Uganda",
                        address: business.address.trim() || undefined,
                        phone: business.phone.trim() || undefined,
                        branches: branches.map((b) => ({
                            name: b.name.trim(),
                            address: b.address.trim() || undefined,
                            phone: b.phone.trim() || undefined,
                            isDefault: b.isDefault,
                        })),
                    },
                    planKey: planKey ?? undefined,
                }),
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data?.success) {
                toast.error(data?.error ?? "Could not create the account.");
                return;
            }

            toast.success(t("Account created. Check your email for the verification code."));
            setAwaitingVerification(true);
        } catch {
            toast.error(t("Could not reach the server. Please try again."));
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!/^\d{6}$/.test(code.trim())) {
            toast.error(t("Enter the 6-digit code from your email"));
            return;
        }

        setVerifying(true);
        try {
            const response = await fetch("/api/auth/verify-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: form.email.trim().toLowerCase(),
                    code: code.trim(),
                }),
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data?.success) {
                toast.error(data?.error ?? t("That code is not valid."));
                return;
            }

            toast.success(t("Email verified. You can sign in now."));
            router.push("/auth/login");
        } catch {
            toast.error(t("Could not reach the server. Please try again."));
        } finally {
            setVerifying(false);
        }
    };

    /* ── The verification screen ───────────────────────────────────── */

    if (awaitingVerification) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
                <div className="w-full max-w-xl">
                    <Card className="shadow-xl border">
                        <CardHeader className="space-y-1">
                            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                                <MailCheck className="h-6 w-6 text-primary" />
                            </div>
                            <h1 className="text-3xl font-semibold leading-none">
                                {t("Verify your email")}
                            </h1>
                            <CardDescription>
                                {t("We sent a 6-digit code to")} {form.email}
                                {t(". Enter it below to activate your account.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleVerify} className="space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="code">{t("Verification code")}</Label>
                                    <Input
                                        id="code"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        placeholder="123456"
                                        required
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                                        className="text-center text-2xl font-bold tracking-[0.5em]"
                                    />
                                </div>

                                <Button type="submit" className="w-full" disabled={verifying}>
                                    {verifying ? t("Verifying...") : t("Verify email")}
                                </Button>

                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="w-full"
                                    disabled={sending}
                                    onClick={() =>
                                        sendVerificationCode(form.email.trim().toLowerCase())
                                    }
                                >
                                    {sending ? t("Sending...") : t("Send a new code")}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </main>
        );
    }

    /* ── The registration wizard ───────────────────────────────────── */

    return (
        <main className="min-h-screen bg-muted/30 px-4 py-8">
            <div className="mx-auto w-full max-w-4xl space-y-6">
                <div className="mb-2">
                    <Link
                        href="/auth/login"
                        className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-primary transition-colors group"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
                        {t("Back to Login")}
                    </Link>
                </div>

                <div className="space-y-3 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 shadow-lg">
                        <Store className="h-7 w-7 text-white" />
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight">{t("Create your account")}</h1>
                    <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
                        {t(
                            "Tell us who you are, what you trade in and where you trade from. SMART_BUZ will tailor your workspace to it."
                        )}
                    </p>
                </div>

                {/* The steps */}
                <div className="flex items-center justify-center gap-2 text-xs font-bold">
                    {[
                        t("Your account"),
                        t("Your business"),
                        t("Your branches"),
                        t("Confirm"),
                    ].map((label, i) => {
                        const active = step === i;
                        const done = step > i;
                        return (
                            <div key={label} className="flex items-center gap-2">
                                <div
                                    className={cn(
                                        "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                                        active && "bg-primary text-primary-foreground",
                                        done && "bg-emerald-500 text-white",
                                        !active && !done && "bg-muted text-muted-foreground"
                                    )}
                                >
                                    {done ? <Check className="h-4 w-4" /> : i + 1}
                                </div>
                                <span
                                    className={cn(
                                        "hidden sm:inline",
                                        active ? "text-foreground" : "text-muted-foreground"
                                    )}
                                >
                                    {label}
                                </span>
                                {i < STEP_COUNT - 1 && (
                                    <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* STEP 1 — the account */}
                {step === 0 && (
                    <Card className="shadow-xl border">
                        <CardHeader className="space-y-1">
                            <h2 className="text-2xl font-semibold leading-none">
                                {t("Your account")}
                            </h2>
                            <CardDescription>
                                {t("This is how you sign in and how your staff reach you.")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (canContinue) setStep(1);
                                }}
                                className="space-y-5"
                            >
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="first_name">{t("First name")}</Label>
                                        <Input
                                            id="first_name"
                                            required
                                            value={form.first_name}
                                            onChange={(e) =>
                                                handleChange("first_name", e.target.value)
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="last_name">{t("Last name")}</Label>
                                        <Input
                                            id="last_name"
                                            required
                                            value={form.last_name}
                                            onChange={(e) =>
                                                handleChange("last_name", e.target.value)
                                            }
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email">{t("Email")}</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        required
                                        value={form.email}
                                        onChange={(e) => handleChange("email", e.target.value)}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone_number">{t("Phone number")}</Label>
                                    <Input
                                        id="phone_number"
                                        type="tel"
                                        value={form.phone_number}
                                        onChange={(e) =>
                                            handleChange("phone_number", e.target.value)
                                        }
                                    />
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="password">{t("Password")}</Label>
                                        <div className="relative">
                                            <Input
                                                id="password"
                                                type={showPassword ? "text" : "password"}
                                                required
                                                minLength={8}
                                                value={form.password}
                                                onChange={(e) =>
                                                    handleChange("password", e.target.value)
                                                }
                                                className="pr-10"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                                                onClick={() => setShowPassword(!showPassword)}
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="h-4 w-4" />
                                                ) : (
                                                    <Eye className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="confirmPassword">
                                            {t("Confirm password")}
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="confirmPassword"
                                                type={
                                                    showConfirmPassword ? "text" : "password"
                                                }
                                                required
                                                value={form.confirmPassword}
                                                onChange={(e) =>
                                                    handleChange("confirmPassword", e.target.value)
                                                }
                                                className="pr-10"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                                                onClick={() =>
                                                    setShowConfirmPassword(!showConfirmPassword)
                                                }
                                            >
                                                {showConfirmPassword ? (
                                                    <EyeOff className="h-4 w-4" />
                                                ) : (
                                                    <Eye className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <Button type="submit" className="w-full" disabled={!accountComplete}>
                                    {t("Continue")} <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                )}

                {/* STEP 2 — the business and the trade */}
                {step === 1 && (
                    <div className="space-y-6">
                        <Card className="shadow-xl border">
                            <CardHeader className="space-y-1">
                                <h2 className="text-2xl font-semibold leading-none">
                                    {t("Your business")}
                                </h2>
                                <CardDescription>
                                    {t(
                                        "The trade you are in decides your VAT, your words and your screens."
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="business_name">
                                            {t("Business name")}
                                        </Label>
                                        <Input
                                            id="business_name"
                                            required
                                            value={business.name}
                                            placeholder={t("The name on your signboard")}
                                            onChange={(e) =>
                                                setBusiness({ ...business, name: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="currency">{t("Currency")}</Label>
                                        <Select
                                            value={business.currency}
                                            onValueChange={(value) =>
                                                setBusiness({ ...business, currency: value })
                                            }
                                        >
                                            <SelectTrigger id="currency">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {SUPPORTED_CURRENCIES.map((code) => (
                                                    <SelectItem key={code} value={code}>
                                                        {code}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="business_address">
                                            {t("Business address")}
                                        </Label>
                                        <Input
                                            id="business_address"
                                            value={business.address}
                                            placeholder={t("Where you trade from")}
                                            onChange={(e) =>
                                                setBusiness({ ...business, address: e.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="business_phone">
                                            {t("Business phone")}
                                        </Label>
                                        <Input
                                            id="business_phone"
                                            type="tel"
                                            value={business.phone}
                                            onChange={(e) =>
                                                setBusiness({ ...business, phone: e.target.value })
                                            }
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="shadow-xl border">
                            <CardHeader className="space-y-1">
                                <h2 className="text-2xl font-semibold leading-none">
                                    {t("What do you trade in?")}
                                </h2>
                                <CardDescription>
                                    {t("Pick the trade closest to yours. You can change it later.")}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <CategoryPicker
                                    selected={business.categoryId || null}
                                    onSelect={(id) => {
                                        // The screens belong to the trade. A new
                                        // trade brings its own, so the old
                                        // choices are dropped rather than
                                        // carried over.
                                        setModules(null);
                                        setBusiness({ ...business, categoryId: id });
                                    }}
                                />
                            </CardContent>
                        </Card>

                        {category && (
                            <Card className="shadow-xl border">
                                <CardHeader className="space-y-1">
                                    <h2 className="text-2xl font-semibold leading-none">
                                        {t("Your screens")}
                                    </h2>
                                    <CardDescription>
                                        {t(
                                            "These are the screens this trade brings. Switch off the ones you will not use — you can change this whenever you like."
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2">
                                        {tradeModules.map((moduleId) => {
                                            const entry = MODULE_REGISTRY[
                                                moduleId as keyof typeof MODULE_REGISTRY
                                            ];
                                            const on = chosenModules.includes(moduleId);
                                            return (
                                                <button
                                                    key={moduleId}
                                                    type="button"
                                                    onClick={() => toggleModule(moduleId)}
                                                    className={cn(
                                                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                                                        on
                                                            ? "border-primary bg-primary/10 text-primary"
                                                            : "border-border bg-muted/40 text-muted-foreground"
                                                    )}
                                                >
                                                    {t(entry?.label ?? moduleId)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        <div className="flex justify-between gap-3">
                            <Button variant="outline" onClick={() => setStep(0)}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                {t("Back")}
                            </Button>
                            <Button onClick={() => setStep(2)} disabled={!businessComplete}>
                                {t("Continue")} <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 3 — the branches */}
                {step === 2 && (
                    <div className="space-y-6">
                        <Card className="shadow-xl border">
                            <CardHeader className="space-y-1">
                                <h2 className="text-2xl font-semibold leading-none">
                                    {t("Where do you trade from?")}
                                </h2>
                                <CardDescription>
                                    {t(
                                        "Add every branch you trade from. Each one gets its own stock, its own staff and its own reports."
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <BranchEditor branches={branches} onChange={setBranches} />
                            </CardContent>
                        </Card>

                        <div className="flex justify-between gap-3">
                            <Button variant="outline" onClick={() => setStep(1)}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                {t("Back")}
                            </Button>
                            <Button onClick={() => setStep(3)} disabled={!branchesComplete}>
                                {t("Continue")} <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 4 — the plan and the confirmation */}
                {step === 3 && (
                    <div className="space-y-6">
                        <Card className="shadow-xl border">
                            <CardHeader className="space-y-1">
                                <h2 className="text-2xl font-semibold leading-none">
                                    {t("Your plan")}
                                </h2>
                                <CardDescription>
                                    {t(
                                        "Every plan starts with a free trial. You can change or cancel it at any time, and what you have already used is never taken away."
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <PlanPicker
                                    selected={planKey}
                                    onSelect={setPlanKey}
                                    cycle="monthly"
                                    onCycleChange={() => {}}
                                />
                            </CardContent>
                        </Card>

                        <Card className="shadow-xl border">
                            <CardHeader className="space-y-1">
                                <h2 className="text-2xl font-semibold leading-none">
                                    {t("Is this right?")}
                                </h2>
                                <CardDescription>
                                    {t("Check it over. You can change any of it later.")}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <SummaryRow label={t("Name")} value={form.first_name + " " + form.last_name} />
                                <SummaryRow label={t("Email")} value={form.email} />
                                <SummaryRow label={t("Business")} value={business.name} />
                                <SummaryRow
                                    label={t("Trade")}
                                    value={category ? t(category.name) : "—"}
                                />
                                <SummaryRow
                                    label={t("Currency")}
                                    value={business.currency}
                                />
                                <SummaryRow
                                    label={t("Branches")}
                                    value={branches
                                        .map((b) => b.name)
                                        .filter(Boolean)
                                        .join(", ")}
                                />
                            </CardContent>
                            <CardContent>
                                <Button
                                    type="button"
                                    className="w-full"
                                    disabled={loading}
                                    onClick={handleSubmit}
                                >
                                    {loading ? t("Creating your workspace...") : t("Create my business")}
                                </Button>
                            </CardContent>
                        </Card>

                        <div className="flex justify-between gap-3">
                            <Button variant="outline" onClick={() => setStep(2)}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                {t("Back")}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}

/** One line of the confirmation. */
function SummaryRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b py-2 last:border-0">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-right text-sm font-semibold">{value || "—"}</span>
        </div>
    );
}
