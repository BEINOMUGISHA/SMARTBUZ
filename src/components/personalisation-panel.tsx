"use client";

/**
 * SMART_BUZ — how this person wants this business to look.
 *
 * The business decides what it trades in. This is the other half: the
 * screens this person will actually use, the colour they like, the screen
 * that opens when they arrive, how crowded it is, and the language they
 * read it in.
 *
 * It is remembered per person *and* per business, so somebody who runs a
 * pharmacy and a hardware shop gets a different workspace in each — and
 * each one is still there when they come back to it.
 *
 * The trade's screens are the starting point. A person may turn off the
 * ones they will never use; they may not turn on one this trade does not
 * have, because there is nothing behind it.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toast } from "sonner";
import { Check, RotateCcw, Palette, LayoutDashboard, Languages, PanelTop } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ACCENT_NAMES, ACCENT_PREVIEW, MODULE_REGISTRY } from "@/lib/category-nav";
import { LOCALE_CODES, LOCALES } from "@/i18n/locales";
import { useI18n, useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

export function PersonalisationPanel() {
    const t = useT();
    const { locale, setLocale } = useI18n();

    const preferences = useQuery(api.userPreferences.getMine, {});
    const save = useMutation(api.userPreferences.update);
    const reset = useMutation(api.userPreferences.reset);

    const [saving, setSaving] = useState(false);

    /**
     * The name of every colour, in the reader's language.
     *
     * The colour itself is the swatch; this is the name of it, so that
     * somebody who cannot see the difference between two colours can still
     * tell them apart.
     */
    const accentLabels: Record<string, string> = {
        emerald: t("Emerald"),
        teal: t("Teal"),
        lime: t("Lime"),
        amber: t("Amber"),
        orange: t("Orange"),
        red: t("Red"),
        rose: t("Rose"),
        blue: t("Blue"),
        indigo: t("Indigo"),
        violet: t("Violet"),
        purple: t("Purple"),
        fuchsia: t("Fuchsia"),
        pink: t("Pink"),
        cyan: t("Cyan"),
        sky: t("Sky"),
        yellow: t("Yellow"),
        stone: t("Stone"),
        zinc: t("Zinc"),
        slate: t("Slate"),
        green: t("Green"),
        gray: t("Gray"),
    };

    const saved = preferences?.preferences ?? null;
    const allowed = preferences?.allowedModules ?? [];
    const chosen = saved?.modules ?? allowed;

    /** Save one change and tell the person it worked. */
    const persist = async (patch: Record<string, unknown>) => {
        setSaving(true);
        try {
            await save(patch);
        } catch (error: unknown) {
            toast.error(
                error instanceof Error ? error.message : t("Could not save your changes.")
            );
        } finally {
            setSaving(false);
        }
    };

    /** Turn one screen on or off. */
    const toggle = (moduleId: string) => {
        const next = chosen.includes(moduleId)
            ? chosen.filter((m) => m !== moduleId)
            : [...chosen, moduleId];
        // The dashboard is not a screen anybody can do without.
        if (!next.includes("dashboard")) next.push("dashboard");
        void persist({ modules: next });
    };

    /** The screens this business offers, grouped the way the menu groups them. */
    const groups: Array<{ id: string; label: string }> = [
        { id: "main", label: t("Main") },
        { id: "operations", label: t("Operations") },
        { id: "records", label: t("Records") },
        { id: "admin", label: t("Administration") },
    ];

    return (
        <div className="space-y-6">
            {preferences?.tradeChanged && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <p className="text-sm font-semibold">{t("Your business changed trade")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t(
                            "The screens you chose were picked for the old trade. Choose the ones you want now — the new trade's screens are the ones on offer."
                        )}
                    </p>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl font-bold">
                        <span className="inline-flex items-center gap-2">
                            <PanelTop className="h-5 w-5" />
                            {t("Your screens")}
                        </span>
                    </CardTitle>
                    <CardDescription>
                        {t(
                            "Switch off the screens you will not use. They stay off for you, in this business only."
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {groups.map((group) => {
                        const modules = Object.values(MODULE_REGISTRY).filter(
                            (module) => module.group === group.id && allowed.includes(module.id)
                        );
                        if (modules.length === 0) return null;
                        return (
                            <div key={group.id} className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {t(group.label)}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {modules.map((module) => {
                                        const on = chosen.includes(module.id);
                                        return (
                                            <button
                                                key={module.id}
                                                type="button"
                                                onClick={() => toggle(module.id)}
                                                disabled={saving}
                                                className={cn(
                                                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                                                    on
                                                        ? "border-primary bg-primary/10 text-primary"
                                                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {t(module.label)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl font-bold">
                        <span className="inline-flex items-center gap-2">
                            <Palette className="h-5 w-5" />
                            {t("Your colour")}
                        </span>
                    </CardTitle>
                    <CardDescription>
                        {t("The colour of your workspace. The trade's colour is used until you pick one.")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-3">
                        {ACCENT_NAMES.map((name) => {
                            const on = saved?.accent === name;
                            const label = accentLabels[name] ?? name;
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    title={label}
                                    aria-label={label}
                                    onClick={() => void persist({ accent: name })}
                                    disabled={saving}
                                    className={cn(
                                        "flex h-10 w-10 items-center justify-center rounded-xl border-2 transition-transform hover:scale-105 disabled:opacity-60",
                                        on ? "border-foreground" : "border-transparent"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "flex h-full w-full items-center justify-center rounded-lg",
                                            ACCENT_PREVIEW[name] ?? "bg-muted"
                                        )}
                                    >
                                        {on && <Check className="h-5 w-5 text-white" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl font-bold">
                        <span className="inline-flex items-center gap-2">
                            <LayoutDashboard className="h-5 w-5" />
                            {t("Open with")}
                        </span>
                    </CardTitle>
                    <CardDescription>
                        {t("The screen that opens when you come to this business.")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="landing">{t("Landing screen")}</Label>
                        <Select
                            value={saved?.landingModule ?? "dashboard"}
                            onValueChange={(value) => void persist({ landingModule: value })}
                        >
                            <SelectTrigger id="landing">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(MODULE_REGISTRY)
                                    .filter((module) => allowed.includes(module.id))
                                    .map((module) => (
                                        <SelectItem key={module.id} value={module.id}>
                                            {t(module.label)}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="density">{t("Spacing")}</Label>
                        <Select
                            value={saved?.density ?? "comfortable"}
                            onValueChange={(value) => void persist({ density: value })}
                        >
                            <SelectTrigger id="density">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="comfortable">{t("Comfortable")}</SelectItem>
                                <SelectItem value="compact">{t("Compact")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="workspace-language">
                            <span className="inline-flex items-center gap-2">
                                <Languages className="h-4 w-4" />
                                {t("Language")}
                            </span>
                        </Label>
                        <Select
                            value={saved?.locale ?? locale}
                            onValueChange={(value) => {
                                setLocale(value as never);
                                void persist({ locale: value });
                            }}
                        >
                            <SelectTrigger id="workspace-language">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {LOCALE_CODES.map((code) => (
                                    <SelectItem key={code} value={code}>
                                        {LOCALES[code].nativeName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl font-bold">{t("Start again")}</CardTitle>
                    <CardDescription>
                        {t(
                            "Put the workspace back the way the trade set it up. Your other businesses are not touched."
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {saved ? (
                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                disabled={saving}
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        await reset({});
                                        toast.success(t("Your workspace is back to the trade's own."));
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                            >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                {t("Back to the default workspace")}
                            </Button>
                            <Badge variant="neutral">{t("Personalised")}</Badge>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {t("You are using the trade's own workspace.")}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
