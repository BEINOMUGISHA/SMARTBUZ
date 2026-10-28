"use client";

import Image from "next/image";
import { Gift, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UnlockedReward, PromoNudge } from "@/lib/promo-evaluator";

interface PromoCartBannerProps {
    unlockedRewards: UnlockedReward[];
    nudges: PromoNudge[];
}

export function PromoCartBanner({ unlockedRewards, nudges }: PromoCartBannerProps) {
    if (unlockedRewards.length === 0 && nudges.length === 0) {
        return null;
    }

    return (
        <div className="space-y-2.5 my-3 animate-in fade-in duration-300">
            {/* 1. Unlocked Rewards (Green Highlight) */}
            {unlockedRewards.map((reward, idx) => (
                <div
                    key={`${reward.promotionId}-${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200 text-xs shadow-sm"
                >
                    <div className="flex items-center gap-2.5">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/20 shadow-sm">
                            <Image
                                src="/images/promo-rewards.jpg"
                                alt="Reward Prize"
                                fill
                                className="object-cover"
                            />
                        </div>
                        <div>
                            <div className="font-bold flex items-center gap-1.5">
                                <span>{reward.promotionName}</span>
                                <Badge variant="outline" className="text-[9px] font-black border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0">
                                    Unlocked x{reward.count}
                                </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Prize: <span className="font-semibold text-foreground">{reward.prize}</span>
                            </p>
                        </div>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                </div>
            ))}

            {/* 2. Upsell / Target Nudges (Amber Highlight) */}
            {nudges.map((nudge, idx) => (
                <div
                    key={`${nudge.promotionId}-${idx}`}
                    className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs shadow-sm space-y-1.5"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                            <span className="font-bold text-foreground">{nudge.promotionName}</span>
                        </div>
                        <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                            {nudge.neededAmount} {nudge.unit} away!
                        </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                        {nudge.productName
                            ? `Add ${nudge.neededAmount} more unit(s) of ${nudge.productName} to win `
                            : `Add ${nudge.neededAmount} more ${nudge.unit} to your cart to win `}
                        <span className="font-bold text-foreground">{nudge.prize}</span>
                    </p>

                    <div className="flex items-center gap-2 pt-0.5">
                        <Progress value={nudge.progressPercentage} className="h-1.5 flex-1 bg-muted" />
                        <span className="text-[10px] font-bold text-muted-foreground">{nudge.progressPercentage}%</span>
                    </div>
                </div>
            ))}
        </div>
    );
}
