"use client";

/**
 * SMART_BUZ — the language switch.
 *
 * The product is used in a country where the shop is run in one language and
 * the person in front of the screen is used to another. The language is a
 * personal choice, remembered in the browser and in a cookie, so the page is
 * painted in the right language the moment it arrives.
 *
 * Each language is written in its own name, because somebody looking for
 * Luganda is looking for "Luganda", not for a translation of the word.
 */

import * as React from "react";
import { Check, Languages } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/provider";
import { LOCALE_CODES, LOCALES } from "@/i18n/locales";

export function LanguageSwitcher({
    className,
    showLabel = false,
}: {
    className?: string;
    showLabel?: boolean;
}) {
    const { locale, setLocale, t } = useI18n();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size={showLabel ? "sm" : "icon"}
                    className={cn(
                        "text-muted-foreground hover:text-foreground",
                        className
                    )}
                    title={t("Change language")}
                    aria-label={t("Change language")}
                >
                    {showLabel ? (
                        <>
                            <Languages className="size-4" />
                            <span className="ml-2">
                                {LOCALES[locale].nativeName}
                            </span>
                        </>
                    ) : (
                        <Languages className="size-4" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t("Language")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {LOCALE_CODES.map((code) => (
                    <DropdownMenuItem
                        key={code}
                        onSelect={() => setLocale(code)}
                        className="flex cursor-pointer items-center justify-between gap-3"
                    >
                        <span className="flex flex-col">
                            <span>{LOCALES[code].nativeName}</span>
                            <span className="text-muted-foreground text-xs">
                                {LOCALES[code].name}
                            </span>
                        </span>
                        {code === locale ? (
                            <Check className="size-4 text-primary" />
                        ) : null}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
