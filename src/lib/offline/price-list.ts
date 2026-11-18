/**
 * SMARTBUZ — the till's price list.
 *
 * A thin layer over the offline catalogue that knows how the sales page
 * actually works: its product list arrives a page at a time, so what the
 * till learns has to be *merged* into the local list rather than replacing
 * it. A product that was on page three yesterday is still sellable offline
 * today.
 *
 * The prices here are what the customer is shown on the receipt. The server
 * always recomputes the price from the `stocks` table when the sale is
 * pushed, so a stale price here can never change the books.
 */

import {
    cacheCatalog,
    catalogAge,
    readCatalog,
    readCatalogItem,
    rememberCatalogItems,
} from "./catalog";
import type { CatalogItem } from "./types";

export { readCatalog, readCatalogItem, rememberCatalogItems, catalogAge };
export type { CatalogItem };

/**
 * Replace the whole local price list.
 *
 * Only correct when the list is the complete one — for a whole catalogue
 * refresh, not for a page of results.
 */
export async function cacheFullCatalog(
    items: Omit<CatalogItem, "cachedAt">[]
): Promise<void> {
    await cacheCatalog(items);
}
