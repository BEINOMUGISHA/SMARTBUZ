/**
 * SMARTBUZ Live In-Cart Promotion & MLM Evaluator
 * Runs in real-time in the browser as cashiers scan or adjust cart items.
 * Generates both "Unlocked Rewards" and "Upcoming Milestones (Nudges)" to boost sales.
 */

export interface CartItem {
    stockId: string;
    name: string;
    productCode?: string;
    price: number;
    quantity: number;
    pv: number;
    bv: number;
}

export interface PromotionRule {
    _id: string;
    name: string;
    prize: string;
    isActive: boolean;
    triggerType?: string; // "Product", "TotalPV", "TotalBV"
    threshold?: number;
}

export interface PromotionProductLink {
    promotionId: string;
    stockId: string;
    requiredQuantity: number;
}

export interface UnlockedReward {
    promotionId: string;
    promotionName: string;
    prize: string;
    count: number;
    triggerLabel: string;
}

export interface PromoNudge {
    promotionId: string;
    promotionName: string;
    prize: string;
    neededAmount: number;
    currentAmount: number;
    targetAmount: number;
    unit: "PV" | "BV" | "units";
    productName?: string;
    progressPercentage: number;
}

export interface CartPromoEvaluation {
    totalPV: number;
    totalBV: number;
    unlockedRewards: UnlockedReward[];
    nudges: PromoNudge[];
}

export function evaluateCartPromotions(
    cartItems: CartItem[],
    activePromotions: PromotionRule[] = [],
    promotionProducts: PromotionProductLink[] = []
): CartPromoEvaluation {
    const totalPV = cartItems.reduce((sum, item) => sum + (item.pv || 0) * item.quantity, 0);
    const totalBV = cartItems.reduce((sum, item) => sum + (item.bv || 0) * item.quantity, 0);

    const unlockedRewards: UnlockedReward[] = [];
    const nudges: PromoNudge[] = [];

    if (!activePromotions || activePromotions.length === 0) {
        return { totalPV, totalBV, unlockedRewards, nudges };
    }

    const livePromos = activePromotions.filter((p) => p.isActive);

    // 1. Evaluate Product-Specific Triggers
    for (const item of cartItems) {
        const itemTriggers = promotionProducts.filter((pp) => pp.stockId === item.stockId);
        for (const trigger of itemTriggers) {
            const promo = livePromos.find((p) => p._id === trigger.promotionId);
            if (!promo) continue;

            const qualifyingCount = Math.floor(item.quantity / trigger.requiredQuantity);
            if (qualifyingCount > 0) {
                unlockedRewards.push({
                    promotionId: promo._id,
                    promotionName: promo.name,
                    prize: promo.prize,
                    count: qualifyingCount,
                    triggerLabel: `${item.name} (x${item.quantity})`,
                });
            }

            // Nudge if close (within 50% or within 3 units of next reward tier)
            const remainingForNext = trigger.requiredQuantity - (item.quantity % trigger.requiredQuantity);
            if (remainingForNext > 0 && remainingForNext <= 3) {
                const currentInTier = item.quantity % trigger.requiredQuantity;
                nudges.push({
                    promotionId: promo._id,
                    promotionName: promo.name,
                    prize: promo.prize,
                    neededAmount: remainingForNext,
                    currentAmount: currentInTier,
                    targetAmount: trigger.requiredQuantity,
                    unit: "units",
                    productName: item.name,
                    progressPercentage: Math.round((currentInTier / trigger.requiredQuantity) * 100),
                });
            }
        }
    }

    // 2. Evaluate Global Threshold Triggers (Total PV / Total BV)
    for (const promo of livePromos) {
        if (!promo.threshold || promo.threshold <= 0) continue;

        if (promo.triggerType === "TotalPV") {
            const count = Math.floor(totalPV / promo.threshold);
            if (count > 0) {
                unlockedRewards.push({
                    promotionId: promo._id,
                    promotionName: promo.name,
                    prize: promo.prize,
                    count,
                    triggerLabel: `Total PV: ${totalPV.toFixed(1)} PV`,
                });
            } else {
                // If not reached yet, calculate nudge progress
                const remaining = promo.threshold - totalPV;
                const progress = Math.min(100, Math.round((totalPV / promo.threshold) * 100));
                // Show nudge if they reached at least 30% of the threshold
                if (progress >= 30) {
                    nudges.push({
                        promotionId: promo._id,
                        promotionName: promo.name,
                        prize: promo.prize,
                        neededAmount: Number(remaining.toFixed(1)),
                        currentAmount: Number(totalPV.toFixed(1)),
                        targetAmount: promo.threshold,
                        unit: "PV",
                        progressPercentage: progress,
                    });
                }
            }
        } else if (promo.triggerType === "TotalBV") {
            const count = Math.floor(totalBV / promo.threshold);
            if (count > 0) {
                unlockedRewards.push({
                    promotionId: promo._id,
                    promotionName: promo.name,
                    prize: promo.prize,
                    count,
                    triggerLabel: `Total BV: ${totalBV.toFixed(1)} BV`,
                });
            } else {
                const remaining = promo.threshold - totalBV;
                const progress = Math.min(100, Math.round((totalBV / promo.threshold) * 100));
                if (progress >= 30) {
                    nudges.push({
                        promotionId: promo._id,
                        promotionName: promo.name,
                        prize: promo.prize,
                        neededAmount: Number(remaining.toFixed(1)),
                        currentAmount: Number(totalBV.toFixed(1)),
                        targetAmount: promo.threshold,
                        unit: "BV",
                        progressPercentage: progress,
                    });
                }
            }
        }
    }

    return { totalPV, totalBV, unlockedRewards, nudges };
}
