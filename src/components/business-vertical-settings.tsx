"use client";

/**
 * SMART_BUZ — Business Vertical Settings
 *
 * Lets an operator retune their system for a different trade without a
 * reinstall: switching the vertical updates the sidebar modules, the URA VAT
 * configuration and the receipt format.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    BUSINESS_CATEGORIES,
    CATEGORY_SECTORS,
    type CategoryId,
} from "@/lib/business-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Loader2, Percent, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export function BusinessVerticalSettings() {
    const { user } = useAuth();
    const profile = useQuery(api.businessProfiles.getActive);
    const setCategory = useMutation(api.businessProfiles.setCategory);
    const updateProfile = useMutation(api.businessProfiles.update);

    const [selected, setSelected] = useState<CategoryId | null>(null);
    const [saving, setSaving] = useState(false);
    const [tin, setTin] = useState("");
    const [businessName, setBusinessName] = useState("");
    const [businessPhone, setBusinessPhone] = useState("");
    const [businessAddress, setBusinessAddress] = useState("");
    // null = "follow the server value"; a boolean = optimistic local change.
    const [allowOverrides, setAllowOverrides] = useState<boolean | null>(null);

    if (!user) return null;

    const isAdmin = user.roles.includes("admin");
    const currentCategory = profile?.categoryId ?? null;
    const overridesEnabled = allowOverrides ?? profile?.allowPriceOverrides ?? false;

    const handleSwitch = async () => {
        if (!selected || !profile) return;
        const cat = BUSINESS_CATEGORIES.find((c) => c.id === selected);
        if (!cat) return;

        setSaving(true);
        try {
            await setCategory({
                id: profile._id,
                categoryId: cat.id,
                modules: cat.modules,
                taxEnabled: cat.tax.enabled,
                taxRate: cat.tax.rate,
                taxInclusive: cat.tax.inclusive,
                taxNote: cat.tax.note,
                updatedBy: user._id,
            });
            toast.success(`Switched to ${cat.name}. Your sidebar and receipts have been updated.`);
            setSelected(null);
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    const handleSaveDetails = async () => {
        if (!profile) return;
        setSaving(true);
        try {
            await updateProfile({
                id: profile._id,
                businessName: businessName.trim() || undefined,
                businessPhone: businessPhone.trim() || undefined,
                businessAddress: businessAddress.trim() || undefined,
                tin: tin.trim() || undefined,
                updatedBy: user._id,
            });
            toast.success("Business details saved");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    const activeCat = BUSINESS_CATEGORIES.find((c) => c.id === currentCategory);

    const handleToggleOverrides = async (checked: boolean) => {
        if (!profile) return;
        setAllowOverrides(checked);
        try {
            await updateProfile({
                id: profile._id,
                allowPriceOverrides: checked,
                updatedBy: user._id,
            });
            toast.success(
                checked
                    ? "Price overrides enabled — cashiers may lower a price at the till"
                    : "Price overrides disabled — list prices are enforced again"
            );
        } catch (err) {
            setAllowOverrides(null);
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            {/* Current vertical */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Store className="h-4 w-4 text-primary" />
                        Your business type
                    </CardTitle>
                    <CardDescription>
                        SMART_BUZ tailors the menu, VAT handling and receipts to your trade.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-xl border bg-muted/30 p-4">
                        <p className="text-lg font-black">{activeCat?.name ?? "Not set"}</p>
                        {activeCat && (
                            <>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {activeCat.description}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    <Badge variant="outline" className="text-[10px]">
                                        {activeCat.modules.length} modules
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                        {activeCat.tax.enabled
                                            ? `VAT ${activeCat.tax.rate}%${activeCat.tax.inclusive ? " incl." : ""}`
                                            : "No VAT"}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                        Unit: {activeCat.units.default}
                                    </Badge>
                                </div>
                            </>
                        )}
                    </div>

                    {isAdmin && (
                        <div className="space-y-3">
                            <Label>Change business type</Label>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {BUSINESS_CATEGORIES.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => setSelected(c.id)}
                                        className={cn(
                                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors hover:border-primary/50 hover:bg-primary/5",
                                            selected === c.id && "border-primary bg-primary/10"
                                        )}
                                    >
                                        <span className="truncate">{c.name}</span>
                                        {selected === c.id && (
                                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                                        )}
                                    </button>
                                ))}
                            </div>
                            {selected && (
                                <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                                    <p className="flex-1 text-xs text-muted-foreground">
                                        Switching to{" "}
                                        <span className="font-bold text-foreground">
                                            {BUSINESS_CATEGORIES.find((c) => c.id === selected)?.name}
                                        </span>{" "}
                                        will change your sidebar, VAT settings and receipt format. Your
                                        existing products and sales are not affected.
                                    </p>
                                    <Button size="sm" onClick={handleSwitch} disabled={saving}>
                                        {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                        Switch
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Business details + URA TIN */}
            {profile && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Business details &amp; URA registration</CardTitle>
                        <CardDescription>
                            Your TIN appears on every fiscal receipt, as required by URA.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="s-bizName">Business name</Label>
                                <Input
                                    id="s-bizName"
                                    defaultValue={profile.businessName}
                                    onChange={(e) => setBusinessName(e.target.value)}
                                    placeholder={profile.businessName}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="s-tin">URA TIN</Label>
                                <Input
                                    id="s-tin"
                                    defaultValue={(profile as any).tin ?? ""}
                                    onChange={(e) => setTin(e.target.value)}
                                    placeholder="e.g. 4012345678901"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="s-bizPhone">Phone</Label>
                                <Input
                                    id="s-bizPhone"
                                    defaultValue={profile.businessPhone ?? ""}
                                    onChange={(e) => setBusinessPhone(e.target.value)}
                                    placeholder="0772 123 456"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="s-bizAddress">Address</Label>
                                <Input
                                    id="s-bizAddress"
                                    defaultValue={profile.businessAddress ?? ""}
                                    onChange={(e) => setBusinessAddress(e.target.value)}
                                    placeholder="Kampala, Uganda"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={handleSaveDetails} disabled={saving}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save details
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Till controls */}
            {profile && isAdmin && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Percent className="h-4 w-4 text-primary" />
                            Till controls
                        </CardTitle>
                        <CardDescription>
                            Decide what a cashier is allowed to change while a sale is open.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-4">
                            <div className="space-y-1">
                                <Label htmlFor="s-allowOverrides" className="text-sm">
                                    Allow price overrides at the till
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    When on, a cashier can lower a line price in the cart and the
                                    sale records both the original and the agreed price for audit.
                                    When off, the server always charges the list price.
                                </p>
                            </div>
                            <Switch
                                id="s-allowOverrides"
                                checked={overridesEnabled}
                                onCheckedChange={handleToggleOverrides}
                                aria-label="Allow price overrides at the till"
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Sector reference */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Supported trades</CardTitle>
                    <CardDescription>
                        {BUSINESS_CATEGORIES.length} business types across{" "}
                        {CATEGORY_SECTORS.length} sectors.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {CATEGORY_SECTORS.map((sector) => (
                        <div key={sector.id}>
                            <p className="mb-1.5 text-xs font-black uppercase tracking-wider text-muted-foreground">
                                {sector.name}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {sector.categories.map((id) => {
                                    const c = BUSINESS_CATEGORIES.find((x) => x.id === id);
                                    if (!c) return null;
                                    return (
                                        <Badge
                                            key={id}
                                            variant={currentCategory === id ? "default" : "outline"}
                                            className="text-[10px]"
                                        >
                                            {c.name}
                                        </Badge>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
