/**
 * SMART_BUZ — URA VAT helpers
 *
 * Uganda's VAT regime:
 *   - Standard rate is 18% (URA).
 *   - Retail prices are normally VAT-*inclusive*: the shelf price is what the
 *     customer pays, and the VAT portion must be extracted for reporting.
 *   - Exempt goods (basic necessities) and zero-rated goods (agricultural
 *     inputs, certain services) carry 0%.
 *
 * Amounts are rounded to whole Ugandan shillings — UGX has no practical
 * subunit, and every figure here is an integer number of shillings.
 */

/** Round to whole shillings. */
export function roundUgx(amount: number): number {
    return Math.round(amount);
}

/**
 * Split a VAT-inclusive gross amount into its net and VAT parts.
 *
 * gross = net + VAT, where VAT = net * rate / 100
 * so net = gross / (1 + rate / 100)
 */
export function splitInclusive(gross: number, rate: number): {
    net: number;
    vat: number;
    gross: number;
} {
    if (rate <= 0) {
        return { net: roundUgx(gross), vat: 0, gross: roundUgx(gross) };
    }
    const net = roundUgx(gross / (1 + rate / 100));
    return { net, vat: roundUgx(gross) - net, gross: roundUgx(gross) };
}

/**
 * Split a VAT-exclusive net amount into net and VAT parts.
 */
export function splitExclusive(net: number, rate: number): {
    net: number;
    vat: number;
    gross: number;
} {
    const n = roundUgx(net);
    const vat = roundUgx((n * rate) / 100);
    return { net: n, vat, gross: n + vat };
}

/**
 * Compute the VAT figures for a sale.
 *
 * @param gross  the total charged to the customer (what appears on the receipt)
 * @param enabled whether VAT applies to this business
 * @param rate   the VAT rate (18 standard, 0 for exempt/zero-rated)
 * @param inclusive true when the shelf price already includes VAT
 */
export function computeVat(
    gross: number,
    enabled: boolean,
    rate: number,
    inclusive: boolean
): { net: number; vat: number; gross: number } {
    if (!enabled || rate <= 0) {
        return { net: roundUgx(gross), vat: 0, gross: roundUgx(gross) };
    }
    return inclusive ? splitInclusive(gross, rate) : splitExclusive(gross, rate);
}

/** Format Ugandan shillings for receipts and reports. */
export function formatUgx(amount: number): string {
    return roundUgx(amount).toLocaleString("en-UG");
}
