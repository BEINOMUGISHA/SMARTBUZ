"use client";

/**
 * SMART_BUZ — the trade picker.
 *
 * One picker, used in two places: the registration screen, where a person
 * says what they trade in before they have an account, and the setup wizard,
 * where a person says it afterwards. Both must offer the same trades in the
 * same order, or a business would end up configured one way and described
 * another.
 */

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

import {
    BUSINESS_CATEGORIES,
    CATEGORY_SECTORS,
    type CategoryId,
} from "@/lib/business-categories";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

/** Icon map — the catalogue stores an icon name, we map it to a component. */
export const ICONS: Record<string, LucideIcon> = {
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

/**
 * The trades, grouped by sector.
 *
 * The sector is not decoration: a hardware owner and a salon owner have
 * nothing in common, and showing forty-five trades in one list is a wall.
 */
export function CategoryPicker({
    selected,
    onSelect,
    className,
}: {
    /** The trade that is chosen, if any. */
    selected: CategoryId | null;
    /** Called with the trade the person chose. */
    onSelect: (id: CategoryId) => void;
    className?: string;
}) {
    const t = useT();

    return (
        <div className={cn("space-y-8", className)}>
            {CATEGORY_SECTORS.map((sector) => (
                <div key={sector.id} className="space-y-3">
                    <div>
                        <h2 className="text-lg font-semibold">{t(sector.name)}</h2>
                        <p className="text-xs text-muted-foreground">
                            {t(sector.description)}
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sector.categories.map((id) => {
                            const c = BUSINESS_CATEGORIES.find((x) => x.id === id);
                            if (!c) return null;
                            const Icon = ICONS[c.icon] ?? StoreIcon;
                            const isSelected = selected === c.id;
                            return (
                                <Card
                                    key={c.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onSelect(c.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onSelect(c.id);
                                        }
                                    }}
                                    className={cn(
                                        "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                        isSelected &&
                                            "border-primary shadow-lg ring-2 ring-primary/30"
                                    )}
                                >
                                    <CardContent className="flex gap-3 p-4">
                                        <div
                                            className={cn(
                                                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted text-foreground"
                                            )}
                                        >
                                            <Icon className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold leading-tight">
                                                {t(c.name)}
                                            </p>
                                            <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                                                {t(c.description)}
                                            </p>
                                        </div>
                                        {isSelected && (
                                            <Check className="h-5 w-5 shrink-0 text-primary" />
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
