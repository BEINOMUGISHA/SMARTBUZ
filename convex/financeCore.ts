import { Id } from "./_generated/dataModel";
import { DEFAULT_TIMEZONE } from "./defaults";

/**
 * SMARTBUZ — the finance calculation core.
 *
 * Every figure in the finance pages, the reports and the dashboard is
 * computed here, from one place, so the dashboard and the reports cannot
 * tell three different stories about the same day.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Where the numbers come from
 * ────────────────────────────────────────────────────────────────────────
 *
 *   Revenue            the `sales` records — what was sold
 *   Cost of goods      the cost of the goods at the time they were sold
 *   Gross profit       revenue − cost of goods
 *   Operating expenses the `expenses` records — the running cost
 *   Other income       the `incomeRecords` — money that is not a sale
 *   Net profit         gross profit + other income − operating expenses
 *
 * Cash that moves between the business's own accounts — a pay-out of petty
 * cash, a payment to a supplier — is **not** an expense. It is a movement on
 * the balance sheet. Counting it as an expense would make a profitable
 * business look like it is losing money, so it is kept in `cashMovements`
 * and reported separately.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The cost of goods sold
 * ────────────────────────────────────────────────────────────────────────
 *
 * A product's cost changes over time. The cost of a sale has to be the cost
 * **at the time of that sale**, not today's price, or last month's profit
 * changes every time the owner buys stock. The cost is therefore resolved in
 * this order:
 *
 *   1. `stockCostHistory` — what the goods actually cost when they were
 *      bought (the most authoritative record there is).
 *   2. The base value recorded on the sale line itself.
 *   3. The product's current purchase price.
 *
 * Only if all three are missing is the cost taken as zero, and that shows
 * up as a gross profit that is too high — which is why it is documented
 * rather than hidden.
 */

/** A document id, kept loose so the helpers work with the test context. */
export type DocId = string;

/* ────────────────────────────────────────────────────────────────────────
 * Dates
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The inclusive bounds of a date range, as they can be compared with the
 * ISO date strings stored on the records.
 *
 * The lower bound is the bare date (`2026-01-01`) so that a record stored
 * as `2026-01-01T09:00:00.000Z` is included, and the upper bound runs to
 * the last millisecond of the day.
 *
 * When the business's time zone is known, the bounds are the *local* day in
 * that zone rather than the UTC day. A shop in Kampala closes its books at
 * midnight its own time, so "today's sales" has to mean from 00:00 in
 * Kampala — which is 21:00 UTC the previous day — to 23:59 in Kampala.
 * Without this, the last three hours of every trading day fall into
 * tomorrow's report and the first three hours of the next day fall into
 * this one's.
 */
export function dayBounds(
  from?: string,
  to?: string,
  timeZone?: string
): { start: string; end: string } {
  const zone = timeZone?.trim() || undefined;

  if (!zone || !isKnownTimeZone(zone)) {
    const start = from ? from.slice(0, 10) : "";
    const end = to ? `${to.slice(0, 10)}T23:59:59.999Z` : "9999-12-31T23:59:59.999Z";
    return { start, end };
  }

  const start = from ? localDayStartUtc(from.slice(0, 10), zone) : "";
  const end = to ? localDayEndUtc(to.slice(0, 10), zone) : "9999-12-31T23:59:59.999Z";
  return { start, end };
}

/** True when the runtime recognises the zone as a time zone. */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 *
 * The offset is read back out of the zone itself rather than from a table,
 * so a zone that changes its offset (a daylight-saving country) is
 * correct on the day it changes and not only on the other 364.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second")
  );

  return asUtc - instant.getTime();
}

/**
 * The instant a local calendar day begins, as a UTC ISO string.
 *
 * The offset is applied twice, because the offset in force at midnight may
 * not be the offset in force at the instant we are converting — the two
 * differ on the day a zone changes its clocks.
 */
function localDayStartUtc(day: string, timeZone: string): string {
  const naive = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(naive)) return `${day}T00:00:00.000Z`;

  let guess = naive - zoneOffsetMs(new Date(naive), timeZone);
  guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess).toISOString();
}

/**
 * The instant a local calendar day ends — the last millisecond before the
 * next local day begins.
 */
function localDayEndUtc(day: string, timeZone: string): string {
  const nextDay = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10))
    ) +
      24 * 60 * 60 * 1000
  );
  const next = nextDay.toISOString().slice(0, 10);
  const startOfNext = Date.parse(localDayStartUtc(next, timeZone));
  return new Date(startOfNext - 1).toISOString();
}

/**
 * The bounds of a date range for a particular business, in that business's
 * own time zone.
 *
 * Every report that reads a period of time goes through here, so that the
 * same range can never be interpreted two ways — once in UTC and once in
 * local time, which is how a day's sales end up split between two reports.
 */
export async function businessDayBounds(
  ctx: AnyCtx,
  businessId: DocId,
  from?: string,
  to?: string
): Promise<{ start: string; end: string }> {
  let timeZone: string | undefined;
  try {
    const business = await ctx.db.get(businessId);
    if (business) {
      timeZone = business.timezone ?? business.timeZone ?? DEFAULT_TIMEZONE;
    }
  } catch {
    // A business that cannot be read simply gets UTC bounds, which is the
    // behaviour the reports had before this was fixed.
  }
  return dayBounds(from, to, timeZone);
}

/** `2026-01-31T09:00:00.000Z` → `2026-01-31`. */
export function dayKey(date: string): string {
  return date.slice(0, 10);
}

/** `2026-01-31T09:00:00.000Z` → `2026-01`. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * The Monday of the week a date falls in, as `YYYY-MM-DD`.
 *
 * Weeks start on Monday, the way a business week does.
 */
export function weekKey(date: string): string {
  const d = new Date(`${dayKey(date)}T00:00:00.000Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // Monday is 0
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

/** The first and last day of the month a date falls in. */
export function monthBounds(date: string): { from: string; to: string } {
  const key = monthKey(date);
  const lastDay = new Date(
    Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)
  ).toISOString().slice(0, 10);
  return { from: `${key}-01`, to: lastDay };
}

/* ────────────────────────────────────────────────────────────────────────
 * Loading the records
 * ──────────────────────────────────────────────────────────────────────── */

export type AnyCtx = any;

/**
 * The sales of a business inside a date range, optionally narrowed to one
 * branch.
 */
export async function loadSales(
  ctx: AnyCtx,
  businessId: DocId,
  from?: string,
  to?: string,
  branchId?: DocId
): Promise<any[]> {
  const { start, end } = await businessDayBounds(ctx, businessId, from, to);

  if (branchId) {
    return await ctx.db
      .query("sales")
      .withIndex("by_businessId_branch_date", (q: any) =>
        q
          .eq("businessId", businessId)
          .eq("branchId", branchId)
          .gte("date", start)
          .lte("date", end)
      )
      .collect();
  }

  return await ctx.db
    .query("sales")
    .withIndex("by_businessId_date", (q: any) =>
      q.eq("businessId", businessId).gte("date", start).lte("date", end)
    )
    .collect();
}

/**
 * The expenses of a business inside a date range.
 *
 * An expense with no branch is an **unallocated** business expense. It is
 * counted in the business-wide figures and left out of a single branch's
 * figures, because it cannot honestly be said to belong to one branch.
 */
export async function loadExpenses(
  ctx: AnyCtx,
  businessId: DocId,
  from?: string,
  to?: string,
  branchId?: DocId
): Promise<any[]> {
  const { start, end } = await businessDayBounds(ctx, businessId, from, to);

  const expenses = await ctx.db
    .query("expenses")
    .withIndex("by_businessId_date", (q: any) =>
      q.eq("businessId", businessId).gte("date", start).lte("date", end)
    )
    .collect();

  if (!branchId) return expenses;

  return expenses.filter((e: any) => e.branchId === branchId);
}

/** The other-income records of a business inside a date range. */
export async function loadIncome(
  ctx: AnyCtx,
  businessId: DocId,
  from?: string,
  to?: string,
  branchId?: DocId
): Promise<any[]> {
  const { start, end } = await businessDayBounds(ctx, businessId, from, to);

  const records = await ctx.db
    .query("incomeRecords")
    .withIndex("by_businessId_date", (q: any) =>
      q.eq("businessId", businessId).gte("date", start).lte("date", end)
    )
    .collect();

  if (!branchId) return records;

  return records.filter((r: any) => r.branchId === branchId);
}

/* ────────────────────────────────────────────────────────────────────────
 * The cost of goods
 * ──────────────────────────────────────────────────────────────────────── */

/** Resolves the unit cost of a product at a point in time. */
export interface CostIndex {
  /** The unit cost of `stockId` as it stood on `atDate`. */
  costFor(stockId: DocId, baseValue: number, atDate?: string): number;
}

/**
 * Build the cost index for a business.
 *
 * The purchase history is loaded once and sorted per product, so resolving
 * the cost of a thousand sale lines is a map lookup rather than a thousand
 * queries.
 */
export async function buildCostIndex(
  ctx: AnyCtx,
  businessId: DocId
): Promise<CostIndex> {
  const [stocks, history] = await Promise.all([
    ctx.db
      .query("stocks")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
    ctx.db
      .query("stockCostHistory")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
  ]);

  const purchasePrice = new Map<string, number>(
    stocks.map((s: any) => [s._id as string, s.purchasePrice ?? 0])
  );

  const rowsByStock = new Map<string, { date: string; unitCost: number }[]>();
  for (const row of history) {
    const key = row.stockId as string;
    const list = rowsByStock.get(key) ?? [];
    list.push({ date: row.date, unitCost: row.unitCost ?? 0 });
    rowsByStock.set(key, list);
  }
  for (const list of rowsByStock.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    costFor(stockId, baseValue, atDate) {
      const rows = rowsByStock.get(stockId);
      if (rows && rows.length > 0) {
        if (atDate) {
          // The most recent purchase that happened on or before the sale.
          let found: number | undefined;
          for (const row of rows) {
            if (row.date <= atDate) found = row.unitCost;
            else break;
          }
          if (found !== undefined) return found;
        } else {
          // No date to go on: the most recent purchase is the best guess.
          return rows[rows.length - 1].unitCost;
        }
      }

      // The base value recorded on the sale line itself.
      if (baseValue > 0) return baseValue;

      // The product's current purchase price.
      return purchasePrice.get(stockId) ?? 0;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The profit of a sale
 * ──────────────────────────────────────────────────────────────────────── */

export interface SaleTotals {
  /** What was sold, after refunds. */
  revenue: number;
  /** What the goods cost. */
  cost: number;
  /** revenue − cost. */
  grossProfit: number;
  /** How many sales there were. */
  transactions: number;
  /** How many items were sold. */
  items: number;
  /** How many of those sales were on credit. */
  creditTransactions: number;
  /** The revenue that was paid in cash. */
  cashRevenue: number;
  /** The revenue that was paid by card or transfer. */
  otherRevenue: number;
  /**
   * The VAT that was charged, read from the sales.
   *
   * This is the figure a business files. It is the tax that was actually
   * charged at the moment each sale was made, not a rate applied to
   * today's prices.
   */
  vat: number;
  /** The revenue without the VAT in it. */
  netRevenue: number;
  /** The revenue that was sold on credit. */
  creditRevenue: number;
}

/** Is this sale a credit sale? */
export function isCreditSale(sale: any): boolean {
  if (sale.isLoan) return true;
  const mode = (sale.paymentMode ?? "").toLowerCase();
  return mode === "loan" || mode === "credit" || mode === "none";
}

/**
 * The totals of a set of sales.
 *
 * A refunded sale brings its revenue back down, and the cost of the goods
 * that came back with it.
 */
export function summariseSales(
  sales: any[],
  costs: CostIndex
): SaleTotals {
  const totals: SaleTotals = {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    transactions: 0,
    items: 0,
    creditTransactions: 0,
    cashRevenue: 0,
    otherRevenue: 0,
    creditRevenue: 0,
    vat: 0,
    netRevenue: 0,
  };

  for (const sale of sales) {
    const refund = sale.refundAmount ?? 0;
    const revenue = (sale.total ?? 0) - refund;

    let cost = 0;
    let items = 0;
    for (const item of sale.items ?? []) {
      const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
      cost += unit * (item.quantity ?? 0);
      items += item.quantity ?? 0;
    }
    // Goods that came back are no longer a cost of sale.
    for (const item of sale.refundedItems ?? []) {
      const unit = costs.costFor(item.stockId, 0, sale.date);
      cost -= unit * (item.quantity ?? 0);
    }

    totals.revenue += revenue;
    totals.cost += cost;
    totals.transactions += 1;
    totals.items += items;

    // The VAT that was actually charged on this sale.
    //
    // It is read from the sale, because that is where it was worked out at
    // the moment the sale was made. A sale made before the VAT was recorded
    // has none, and is counted as zero rather than guessed at — a figure
    // that moved when the tax rate moved would not be a figure anybody
    // could file.
    totals.vat += Math.max(0, (sale.taxAmount ?? 0) - (sale.refundTaxAmount ?? 0));
    totals.netRevenue += sale.netAmount ?? revenue;

    if (isCreditSale(sale)) {
      totals.creditTransactions += 1;
      totals.creditRevenue += revenue;
    } else {
      const mode = (sale.paymentMode ?? "").toLowerCase();
      if (mode === "cash") totals.cashRevenue += revenue;
      else totals.otherRevenue += revenue;
    }
  }

  totals.grossProfit = totals.revenue - totals.cost;
  return totals;
}

export interface ExpenseTotals {
  total: number;
  count: number;
  byType: { type: string; total: number; count: number }[];
}

/** The totals of a set of expenses, grouped by type. */
export function summariseExpenses(expenses: any[]): ExpenseTotals {
  const groups = new Map<string, { type: string; total: number; count: number }>();

  for (const expense of expenses) {
    const type = expense.type || "Uncategorised";
    const group = groups.get(type) ?? { type, total: 0, count: 0 };
    group.total += expense.amount ?? 0;
    group.count += 1;
    groups.set(type, group);
  }

  const byType = [...groups.values()].sort((a, b) => b.total - a.total);

  return {
    total: byType.reduce((sum, g) => sum + g.total, 0),
    count: expenses.length,
    byType,
  };
}

/** Round to two decimals, so floating point noise never reaches a report. */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The name to show for a person.
 *
 * A snapshot of the name is written onto the records that need one, so the
 * record still reads correctly after somebody is renamed or leaves.
 */
export function displayName(user: any): string {
  if (!user) return "Unknown";
  const full = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return full || user.email || "Unknown";
}
