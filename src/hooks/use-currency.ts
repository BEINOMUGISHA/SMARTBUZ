"use client";

/**
 * SMARTBUZ — the currency the business on screen trades in.
 *
 * A business chooses its currency when it is set up, and every figure it
 * sees afterwards belongs in that currency. The money used to be written
 * out as the literal "UGX" in a great many places, which meant a business
 * trading in dollars was shown "UGX 12,500" on its dashboard, on its
 * receipts and in its exports.
 *
 * So a screen that shows money asks for the currency rather than naming
 * one. The currency comes from the business record, which the backend
 * owns, through the auth context — so a component never has to be told
 * which business it is drawing for.
 *
 * Until the business record has arrived the default is used. That is also
 * what the server renders, so the page the browser paints first and the
 * page it settles on do not disagree with one another.
 */

import { useAuth } from "@/context/auth-context";
import { businessCurrency, currencySymbol } from "@/lib/currency";

export interface UseCurrency {
    /** The currency code, e.g. "UGX", "USD". */
    currency: string;
    /** The symbol to show, where the business has one. */
    symbol: string;
}

export function useCurrency(): UseCurrency {
    const { activeBusiness } = useAuth();

    const currency = businessCurrency(activeBusiness?.currency);

    return {
        currency,
        symbol: currencySymbol(currency, activeBusiness?.currencySymbol),
    };
}
