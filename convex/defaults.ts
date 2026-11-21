/**
 * SMARTBUZ — server-side defaults for a newly registered business.
 *
 * These are the values the server applies when a business is created, so a
 * new tenant starts in a working state without having to trust anything the
 * browser sent.
 */

/** Product categories every new business starts with. */
export const DEFAULT_CATEGORIES = [
  "Health & Beauty",
  "Supplements",
  "Personal Care",
  "Home Essentials",
  "Electronics",
  "Home",
];

/**
 * The module ids a business may enable.
 *
 * The frontend catalogue (src/lib/business-categories.ts) decides which
 * modules a vertical shows, but the server keeps an allow-list so a
 * tampered client cannot inject unknown module ids into a business record.
 */
export const ALLOWED_MODULES = [
  "dashboard",
  "sales",
  "pos",
  "stock",
  "inventory",
  "shops",
  "expenses",
  "reports",
  "customers",
  "loans",
  "promotions",
  "suppliers",
  "purchaseOrders",
  "batches",
  "expiry",
  "deliveries",
  "receivables",
  "systemconfig",
  "production",
  "services",
  "tables",
  "menu",
  "rooms",
  "bookings",
  "members",
  "appointments",
  "classes",
  "attendance",
  "till",
  "assets",
  "fuel",
  "rentals",
  "prescriptions",
] as const;

/**
 * Keep only known module ids, and always include the two a business cannot
 * function without.
 */
export function sanitizeModules(modules: string[] | undefined): string[] {
  const allowed = new Set<string>(ALLOWED_MODULES);
  const cleaned = (modules ?? []).filter((m) => allowed.has(m));
  const result = new Set<string>(cleaned);
  result.add("dashboard");
  result.add("sales");
  return Array.from(result);
}

/** Currency metadata used when a business does not pick one. */
export const SUPPORTED_CURRENCIES = [
  { code: "UGX", symbol: "UGX", name: "Ugandan Shilling" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "RWF", symbol: "RWF", name: "Rwandan Franc" },
  { code: "KES", symbol: "KES", name: "Kenyan Shilling" },
  { code: "TZS", symbol: "TZS", name: "Tanzanian Shilling" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "Pound Sterling" },
] as const;

export const DEFAULT_CURRENCY = "UGX";
export const DEFAULT_TIMEZONE = "Africa/Kampala";

/**
 * The reorder point used for a product that has none of its own, and for a
 * business that has not set a default.
 *
 * It is a constant rather than a number typed into the browser so that the
 * low-stock alert means the same thing every time it is run.
 */
export const DEFAULT_REORDER_POINT = 10;
export const DEFAULT_COUNTRY = "Uganda";
export const DEFAULT_LOCALE = "en-UG";
export const DEFAULT_DATE_FORMAT = "dd/MM/yyyy";

/** Is this a currency the product knows how to format? */
export function isSupportedCurrency(code: string | undefined | null): boolean {
  if (!code) return false;
  return SUPPORTED_CURRENCIES.some((c) => c.code === code);
}

/** The display symbol for a currency code. */
export function currencySymbol(code: string | undefined | null): string {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  return found ? found.symbol : code || DEFAULT_CURRENCY;
}
