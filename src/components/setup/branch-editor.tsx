"use client";

/**
 * SMART_BUZ — the branch editor.
 *
 * A business with one branch is the common case; a business with three is
 * the chain. The person says which branches they trade from while they are
 * setting up, because a branch that is added later is a branch nobody
 * stocks and nobody reports on.
 *
 * The first branch is the head office unless another one is marked as the
 * default — the server decides that, and this screen only says which one the
 * person means.
 */

import { Plus, Trash2, Building2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";

/** One branch the person is describing. */
export interface BranchDraft {
    name: string;
    address: string;
    phone: string;
    /** The head office — the branch everything else is measured against. */
    isDefault: boolean;
}

/** A branch with nothing filled in yet. */
export function emptyBranch(): BranchDraft {
    return { name: "", address: "", phone: "", isDefault: false };
}

export function BranchEditor({
    branches,
    onChange,
}: {
    branches: BranchDraft[];
    onChange: (branches: BranchDraft[]) => void;
}) {
    const t = useT();

    const update = (index: number, patch: Partial<BranchDraft>) => {
        onChange(branches.map((branch, i) => (i === index ? { ...branch, ...patch } : branch)));
    };

    /** Mark one branch as the head office. Only one can be. */
    const makeDefault = (index: number) => {
        onChange(branches.map((branch, i) => ({ ...branch, isDefault: i === index })));
    };

    const remove = (index: number) => {
        const next = branches.filter((_, i) => i !== index);
        // The head office always exists: a business with no head office has
        // nowhere to keep its stock.
        if (next.length === 0) {
            onChange([{ ...emptyBranch(), name: "Main Branch", isDefault: true }]);
            return;
        }
        if (!next.some((branch) => branch.isDefault)) {
            next[0] = { ...next[0], isDefault: true };
        }
        onChange(next);
    };

    const add = () => {
        onChange([...branches, emptyBranch()]);
    };

    return (
        <div className="space-y-4">
            {branches.map((branch, index) => (
                <div
                    key={index}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                >
                    <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">
                                {t("Branch")} {index + 1}
                            </span>
                            {branch.isDefault && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                    <Star className="h-3 w-3" />
                                    {t("Head office")}
                                </span>
                            )}
                        </div>
                        {branches.length > 1 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(index)}
                                aria-label={t("Remove branch")}
                            >
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor={`branch-name-${index}`}>{t("Branch name")}</Label>
                            <Input
                                id={`branch-name-${index}`}
                                value={branch.name}
                                placeholder={t("Main Branch")}
                                onChange={(e) => update(index, { name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`branch-phone-${index}`}>
                                {t("Branch phone")}
                            </Label>
                            <Input
                                id={`branch-phone-${index}`}
                                value={branch.phone}
                                placeholder="+256 700 000 000"
                                onChange={(e) => update(index, { phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor={`branch-address-${index}`}>
                                {t("Branch address")}
                            </Label>
                            <Input
                                id={`branch-address-${index}`}
                                value={branch.address}
                                placeholder={t("Where this branch is")}
                                onChange={(e) => update(index, { address: e.target.value })}
                            />
                        </div>
                    </div>

                    {!branch.isDefault && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => makeDefault(index)}
                        >
                            <Star className="mr-2 h-3.5 w-3.5" />
                            {t("Make this the head office")}
                        </Button>
                    )}
                </div>
            ))}

            <Button type="button" variant="outline" onClick={add}>
                <Plus className="mr-2 h-4 w-4" />
                {t("Add another branch")}
            </Button>
        </div>
    );
}
