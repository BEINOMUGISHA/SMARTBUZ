"use client";

/**
 * SMART_BUZ — Business Setup Wizard
 *
 * The first-run experience. The operator picks their trade, and SMART_BUZ
 * configures itself for that vertical: sidebar modules, URA VAT handling,
 * terminology and (optionally) a starter catalogue of sample products so
 * the till is usable immediately.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    BUSINESS_CATEGORIES,
    type CategoryId,
} from "@/lib/business-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { PlanPicker } from "@/components/subscription/plan-picker";
import { CategoryPicker } from "@/components/setup/category-picker";
import { Check, ChevronRight, Loader2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    Store as StoreIcon,
    ShoppingBasket,
    Truck,
    Pill,
    Stethoscope,
    UtensilsCrossed,
    Coffee,
    Scissors,
    Sparkles,
    BedDouble,
    Hammer,
    Sprout,
    Fuel,
    Smartphone,
    Tv,
    Wrench,
    Recycle,
    BookOpen,
    Printer,
    Pencil,
    Croissant,
    Drumstick,
    Milk,
    Wheat,
    Bus,
    Car,
    Footprints,
    Flower2,
    Dumbbell,
    Shirt,
    GraduationCap,
    Church,
    HeartHandshake,
    Building2,
    ShieldCheck,
    PartyPopper,
    Camera,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/i18n/provider";

/** Icon map — the catalog stores an icon name, we map it to a component. */
const ICONS: Record<string, LucideIcon> = {
    Store: StoreIcon,
    ShoppingBasket,
    Truck,
    Pill,
    Stethoscope,
    UtensilsCrossed,
    Coffee,
    Scissors,
    Sparkles,
    BedDouble,
    Hammer,
    Sprout,
    Fuel,
    Smartphone,
    Tv,
    Wrench,
    Recycle,
    BookOpen,
    Printer,
    Pencil,
    Croissant,
    Drumstick,
    Milk,
    Wheat,
    Bus,
    Car,
    Footprints,
    Flower2,
    Dumbbell,
    Shirt,
    GraduationCap,
    Church,
    HeartHandshake,
    Building2,
    ShieldCheck,
    PartyPopper,
    Camera,
};

export default function SetupPage() {
    
    const t = useT();const router = useRouter();
    const { user } = useAuth();
    const existingProfile = useQuery(api.businesses.getActive, {});
    const plans = useQuery(api.plans.list, {});

    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [selected, setSelected] = useState<CategoryId | null>(null);
    const [planKey, setPlanKey] = useState<string | null>(null);
    const [businessName, setBusinessName] = useState("");
    const [businessPhone, setBusinessPhone] = useState("");
    const [businessAddress, setBusinessAddress] = useState("");
    const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
    const [openingFloat, setOpeningFloat] = useState("0");
    const [seedProducts, setSeedProducts] = useState(true);
    const [saving, setSaving] = useState(false);

    // The selected plan is resolved only after `planKey` has been declared.
    // Reading it earlier is a temporal-dead-zone crash, and because the read
    // hides inside the `.find()` callback neither TypeScript nor ESLint sees
    // it — the wizard simply threw on every load.
    const chosenPlan = (plans ?? []).find((p) => p.key === planKey) ?? null;

    const createBusiness = useMutation(api.businesses.createForCurrentUser);
    const setCategory = useMutation(api.businesses.setCategory);
    const completeOnboarding = useMutation(api.businesses.completeOnboarding);
    const selectPlan = useMutation(api.subscriptions.selectPlan);
    const addCategory = useMutation(api.categories.add);
    const addStock = useMutation(api.stocks.add);

    const category = selected
        ? BUSINESS_CATEGORIES.find((c) => c.id === selected) ?? null
        : null;

    const handleCreate = async () => {
        if (!category || !user) return;
        setSaving(true);
        try {
            if (existingProfile) {
                // The business already exists — switch it to the chosen
                // vertical, put it on the chosen plan and finish the
                // remaining setup steps.
                await setCategory({
                    businessId: existingProfile._id,
                    categoryId: category.id,
                    modules: category.modules,
                });
                await completeOnboarding({
                    businessId: existingProfile._id,
                    categoryId: category.id,
                    modules: category.modules,
                    currency: existingProfile.currency || currency,
                    timezone: existingProfile.timezone || "Africa/Kampala",
                    country: existingProfile.country || "Uganda",
                    businessAddress: businessAddress.trim() || undefined,
                    businessPhone: businessPhone.trim() || undefined,
                });
                if (planKey) {
                    await selectPlan({
                        businessId: existingProfile._id,
                        planKey,
                    });
                }
            } else {
                // No business yet — create one. The caller becomes its owner
                // and gets a default branch, warehouse and categories.
                await createBusiness({
                    businessName: businessName.trim() || category.name,
                    categoryId: category.id,
                    modules: category.modules,
                    currency: currency,
                    country: "Uganda",
                    businessAddress: businessAddress.trim() || undefined,
                    businessPhone: businessPhone.trim() || undefined,
                    planKey: planKey ?? undefined,
                });
            }

            // Optionally seed a starter catalogue so the till works on day one.
            if (seedProducts && category.sampleProducts.length > 0) {
                const catIds = new Map<string, string>();
                let counter = 0;
                for (const sample of category.sampleProducts) {
                    let catId = catIds.get(sample.category);
                    if (!catId) {
                        catId = await addCategory({
                            type: sample.category,
                            userId: user._id,
                        });
                        catIds.set(sample.category, catId);
                    }
                    counter += 1;
                    await addStock({
                        name: sample.name,
                        productCode: `${category.id.toUpperCase().slice(0, 3)}-${String(
                            counter
                        ).padStart(3, "0")}`,
                        price: sample.price,
                        purchasePrice: sample.purchasePrice,
                        qty: 50,
                        pv: sample.pv ?? 0,
                        bv: sample.bv ?? 0,
                        categoryId: catId as any,
                        supplier: "Opening Stock",
                    });
                }
            }

            toast.success(t("{0} workspace ready!", { 0: t(category.name) }));
            router.push("/");
        } catch (err: any) {
            toast.error(err?.message ?? "Could not save your business profile.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 px-4 py-10">
            <div className="mx-auto max-w-5xl space-y-8">
                {/* Header */}
                <div className="space-y-3 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 shadow-lg">
                        <Store className="h-7 w-7 text-white" />
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                        {t("Set up your business")}
                    </h1>
                    <p className="mx-auto max-w-xl text-sm text-muted-foreground md:text-base">
                        {t("Choose the trade you are in. SMART_BUZ will tailor your interface, modules, VAT handling and receipts for it.")}
                    </p>
                </div>

                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2 text-xs font-bold">
                    {["Choose your trade", "Choose your plan", "Business details", "Confirm"].map((label, i) => {
                        const n = (i + 1) as 1 | 2 | 3 | 4;
                        const active = step === n;
                        const done = step > n;
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
                                    {done ? <Check className="h-4 w-4" /> : n}
                                </div>
                                <span
                                    className={cn(
                                        "hidden sm:inline",
                                        active ? "text-foreground" : "text-muted-foreground"
                                    )}
                                >
                                    {label}
                                </span>
                                {i < 2 && (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* STEP 1 — pick a trade */}
                {step === 1 && (
                    <CategoryPicker selected={selected} onSelect={setSelected} />
                )}

                {/* STEP 2 — choose a plan */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div className="text-center">
                            <h2 className="text-xl font-semibold">{t("Choose your plan")}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {t("Every plan starts with a free trial. You can change or cancel it at any time, and what you have already used is never taken away.")}
                            </p>
                        </div>

                        <PlanPicker
                            selected={planKey}
                            onSelect={setPlanKey}
                            cycle="monthly"
                            onCycleChange={() => {}}
                        />

                        <div className="flex justify-between gap-3">
                            <Button variant="outline" onClick={() => setStep(1)}>
                                {t("Back")}
                            </Button>
                            <Button onClick={() => setStep(3)} disabled={!planKey}>
                                {t("Continue")} <ChevronRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 3 — business details */}
                {step === 3 && category && (
                    <Card className="mx-auto max-w-2xl">
                        <CardContent className="space-y-6 p-6">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    {(() => {
                                        const Icon = ICONS[category.icon] ?? StoreIcon;
                                        return <Icon className="h-6 w-6" />;
                                    })()}
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold">{t(category.name)}</h2>
                                    <p className="text-xs text-muted-foreground">
                                        {t(category.description)}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="bizName">{t("Business name")}</Label>
                                    <Input
                                        id="bizName"
                                        value={businessName}
                                        onChange={(e) => setBusinessName(e.target.value)}
                                        placeholder={t(category.name)}
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="bizPhone">{t("Phone")}</Label>
                                        <Input
                                            id="bizPhone"
                                            value={businessPhone}
                                            onChange={(e) => setBusinessPhone(e.target.value)}
                                            placeholder="0772 123 456"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="float">{t("Opening cash float (")}{currency})</Label>
                                        <Input
                                            id="float"
                                            type="number"
                                            min="0"
                                            value={openingFloat}
                                            onChange={(e) => setOpeningFloat(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="bizCurrency">{t("Currency")}</Label>
                                    <Select value={currency} onValueChange={setCurrency}>
                                        <SelectTrigger id="bizCurrency">
                                            <SelectValue placeholder={t("Currency")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SUPPORTED_CURRENCIES.map((code) => (
                                                <SelectItem key={code} value={code}>{code}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        {t("Every figure this business records and shows will be in this currency.")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="bizAddress">{t("Business address")}</Label>
                                    <Input
                                        id="bizAddress"
                                        value={businessAddress}
                                        onChange={(e) => setBusinessAddress(e.target.value)}
                                        placeholder={t("Kampala, Uganda")}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
                                <label className="flex cursor-pointer items-start gap-3">
                                    <input
                                        type="checkbox"
                                        checked={seedProducts}
                                        onChange={(e) => setSeedProducts(e.target.checked)}
                                        className="mt-1 h-4 w-4 rounded border-input accent-primary"
                                    />
                                    <div>
                                        <p className="text-sm font-semibold">
                                            {t("Add starter")} {category.terminology.item.toLowerCase()}s
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {category.sampleProducts.length} common{" "}
                                            {category.terminology.item.toLowerCase()}s for a{" "}
                                            {t(category.name).toLowerCase()} {t("so you can start selling straight away. You can edit them later.")}
                                        </p>
                                    </div>
                                </label>
                            </div>

                            <div className="flex justify-between gap-3">
                                <Button variant="outline" onClick={() => setStep(2)}>
                                    {t("Back")}
                                </Button>
                                <Button onClick={() => setStep(4)} disabled={!category}>
                                    {t("Continue")} <ChevronRight className="ml-2 h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* STEP 4 — confirm */}
                {step === 4 && category && (
                    <Card className="mx-auto max-w-2xl">
                        <CardContent className="space-y-6 p-6">
                            <h2 className="text-xl font-semibold">{t("Confirm your setup")}</h2>

                            <div className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("Business")}</span>
                                    <span className="font-bold">
                                        {businessName.trim() || t(category.name)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("Trade")}</span>
                                    <span className="font-bold">{t(category.name)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("Units")}</span>
                                    <span className="font-bold">
                                        {category.units.default}
                                        {category.units.allowFractional && " (fractional allowed)"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("VAT")}</span>
                                    <span className="font-bold">
                                        {category.tax.enabled
                                            ? `${category.tax.rate}%${category.tax.inclusive ? " (inclusive)" : ""}`
                                            : "Not applicable"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("Modules")}</span>
                                    <span className="font-bold">{category.modules.length} enabled</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("Plan")}</span>
                                    <span className="font-bold">
                                        {chosenPlan?.name ?? planKey ?? "—"}
                                        {chosenPlan ? ` • ${chosenPlan.trialDays}-day trial` : ""}
                                    </span>
                                </div>
                                {seedProducts && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("Starter stock")}</span>
                                        <span className="font-bold">
                                            {category.sampleProducts.length} items
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                                    {t(category.tax.note)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {t("SMART_BUZ applies URA&apos;s 18% standard rate. Exempt and zero-rated items must be marked per product so your VAT split stays accurate on every receipt.")}
                                </p>
                            </div>

                            <div className="flex justify-between gap-3">
                                <Button variant="outline" onClick={() => setStep(3)}>
                                    {t("Back")}
                                </Button>
                                <Button onClick={handleCreate} disabled={saving}>
                                    {saving ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            {t("Setting up...")}
                                        </>
                                    ) : (
                                        "Finish setup"
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
