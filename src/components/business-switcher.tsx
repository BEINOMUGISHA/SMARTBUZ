"use client";

/**
 * SMART_BUZ — Business switcher.
 *
 * Lets a user move between the businesses they belong to. The switch is a
 * server operation: `businesses.switchBusiness` verifies the membership
 * before it moves the caller, so the list only ever contains businesses the
 * user is actually a member of, and a tampered request to switch into
 * somebody else's business is refused.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useT } from "@/i18n/provider";

export function BusinessSwitcher({ collapsed = false }: { collapsed?: boolean }) {
    
    const t = useT();const { businesses, activeBusiness } = useAuth();
    const switchBusiness = useMutation(api.businesses.switchBusiness);
    const router = useRouter();
    const [switching, setSwitching] = useState(false);

    const handleSwitch = async (businessId: string) => {
        if (businessId === activeBusiness?._id) return;
        setSwitching(true);
        try {
            await switchBusiness({ businessId: businessId as any });
            toast.success("Switched business");
            // The tenant changed: re-read the data for the new business.
            router.refresh();
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setSwitching(false);
        }
    };

    if (businesses.length === 0) {
        return (
            <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => router.push("/setup")}
            >
                <Plus className="mr-2 h-4 w-4" />
                {t("Create a business")}
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={switching}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {switching ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                        ) : (
                            <Building2 className="h-4 w-4 shrink-0" />
                        )}
                        {!collapsed && (
                            <span className="truncate">
                                {activeBusiness?.name ?? "Select business"}
                            </span>
                        )}
                    </span>
                    {!collapsed && <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>{t("Your businesses")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {businesses.map(({ business, role }) => {
                    const isActive = business._id === activeBusiness?._id;
                    return (
                        <DropdownMenuItem
                            key={business._id}
                            onSelect={() => handleSwitch(business._id)}
                            className="flex items-center justify-between gap-2"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <Building2 className="h-4 w-4 shrink-0 opacity-70" />
                                <span className="truncate">{business.name}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                                <Badge variant="secondary" className="text-xs">
                                    {role}
                                </Badge>
                                {isActive && <Check className="h-4 w-4" />}
                            </span>
                        </DropdownMenuItem>
                    );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/setup")}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("Register another business")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
