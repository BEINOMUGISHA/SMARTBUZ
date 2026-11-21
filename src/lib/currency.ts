/**
 * SMARTBUZ — money, in the business's own currency.
 *
 * A business picks its currency when it is set up, and every figure it sees
 * afterwards is in that currency. The money was therefore hardcoded as
 * "UGX" in a good number of places, which was wrong in two different ways:
 *
 *  • **A label that lied.** A business trading in dollars was shown
 *    "UGX 12,500" on a screen and on a receipt.
 *  • **A request the provider refused.** The mobile-money request sent
 *    the provider the currency code "UGX" whatever the business trades in.
 *    A provider given the wrong code refuses the transaction, so a dollar
 *    business could not take a mobile-money payment at all.
 *
 * So the currency comes from the business record, and the formatter takes
 * it as an argument. Where a component cannot reach the business — a
 * receipt printed from a sale record — the sale record itself carries the
 * currency, and that is what should be used.
 */

/** The currency a business gets when it has not chosen one. */
export const DEFAULT_CURRENCY = "UGX";

/**
 * The currency a business trades in.
 *
 * It is read from the business record, which the backend owns. The default
 * is only the fallback for the moment before the business record has been
 * loaded.
 */
export function businessCurrency(currency?: string | null): string {
    const code = (currency ?? "").trim().toUpperCase();
    return code || DEFAULT_CURRENCY;
}

/**
 * Format an amount in a currency.
 *
 * The amount is rounded to two decimals, because a figure that a person is
 * going to pay has to be a figure they can pay.
 */
export function formatMoney(
    amount: number | string | null | undefined,
    currency?: string | null,
    options: { decimals?: boolean } = {}
): string {
    const value = Number(amount ?? 0);
    if (!Number.isFinite(value)) return `${businessCurrency(currency)} 0`;

    const code = businessCurrency(currency);
    const rounded = options.decimals === false ? Math.round(value) : value;

    return `${code} ${rounded.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: options.decimals === false ? 0 : 2,
    })}`;
}

/**
 * The currency symbol, where the business has one.
 *
 * "UGX" has no symbol of its own, so the code is used. "$" and "€" are
 * what a person expects to see on a till.
 */
export function currencySymbol(
    currency?: string | null,
    symbol?: string | null
): string {
    if (symbol && symbol.trim()) return symbol.trim();
    return businessCurrency(currency);
}
