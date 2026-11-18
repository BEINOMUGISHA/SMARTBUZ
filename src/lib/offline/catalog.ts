/**
 * SMARTBUZ — offline product catalogue
 *
 * A thin, documented wrapper over the `catalog` object store in the offline
 * IndexedDB database.
 *
 * Why this exists
 * ───────────────
 * The sales page loads its product list from a live Convex query
 * (`api.stocks.getShopStock`). With no network that query fails and the
 * cashier is left with an EMPTY product list — they cannot sell at all. The
 * last successful list is therefore kept locally, so the till can keep
 * selling while the link is down.
 *
 * Money
 * ─────
 * The cached price is ONLY what the till shows the customer on the receipt.
 * The server always recomputes the price from the `stocks` table when the
 * sale is pushed, so a stale cached price can never change the books. The
 * same applies to `qty`: it is what the till believed was on hand, used for
 * the cashier's information, not for the server's stock ledger.
 *
 * Freshness
 * ─────────
 * `cachedAt` records when the list was written. `catalogAge()` turns that
 * into milliseconds so the UI can say "price list from 3 hours ago" and warn
 * the cashier that prices may be stale.
 */

import {
  cacheCatalog as cacheCatalogInDb,
  readCatalog as readCatalogFromDb,
  readCatalogItem as readCatalogItemFromDb,
} from "./db";
import type { CatalogItem } from "./types";

/**
 * Replace the cached price list with `items`.
 *
 * The whole store is replaced, so a product deleted on the server does not
 * linger locally. `cachedAt` is stamped with the current time.
 */
export async function cacheCatalog(
  items: Omit<CatalogItem, "cachedAt">[]
): Promise<void> {
  const cachedAt = new Date().toISOString();
  const stamped: CatalogItem[] = items.map((item) => ({ ...item, cachedAt }));
  await cacheCatalogInDb(stamped);
}

/**
 * Remember the products on the current page.
 *
 * The shop's price list arrives a page at a time, so this **merges** rather
 * than replaces: a product that was on page three yesterday is still in the
 * local catalogue even though this page does not mention it. Use
 * `cacheCatalog` for a whole, authoritative list.
 */
export async function rememberCatalogItems(
  items: Omit<CatalogItem, "cachedAt">[]
): Promise<void> {
  if (items.length === 0) return;

  const cachedAt = new Date().toISOString();
  const existing = await readCatalogFromDb();

  const merged = new Map<string, CatalogItem>();
  for (const item of existing) merged.set(item.stockId, item);
  for (const item of items) {
    merged.set(item.stockId, { ...item, cachedAt });
  }

  await cacheCatalogInDb([...merged.values()]);
}

/** Every cached product. Empty when nothing has been cached yet. */
export async function readCatalog(): Promise<CatalogItem[]> {
  return readCatalogFromDb();
}

/** One cached product, or null when it is not cached. */
export async function readCatalogItem(
  stockId: string
): Promise<CatalogItem | null> {
  return readCatalogItemFromDb(stockId);
}

/**
 * How long ago the cached price list was written, in milliseconds.
 *
 * Returns `undefined` when there is no catalogue at all (nothing has ever
 * been cached, or the catalogue store is unavailable).
 */
export async function catalogAge(): Promise<number | undefined> {
  const items = await readCatalog();
  if (items.length === 0) return undefined;

  const newest = items.reduce<string>(
    (latest, item) => (item.cachedAt > latest ? item.cachedAt : latest),
    items[0].cachedAt
  );

  const writtenAt = new Date(newest).getTime();
  if (Number.isNaN(writtenAt)) return undefined;

  // Never report a negative age if the system clock moved backwards.
  return Math.max(0, Date.now() - writtenAt);
}
