/**
 * SMART_BUZ — tenant-scope the reporting module.
 *
 *   node scripts/tenant-scope-reports.mjs
 *
 * `convex/reports.ts` reads sales, expenses, loans, payments, stock,
 * customers and shops. Before this change a report that omitted `shopId`
 * read every business's revenue. The rules below rewrite each read so it
 * is anchored on the caller's business, and every handler resolves the
 * tenant first.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

/** Tables that are not tenant-owned (no businessId index). */
const GLOBAL_TABLES = new Set(["users", "userTypes", "counters", "passwordResets", "businessProfiles"]);

let src = fs.readFileSync(FILE, "utf8");

/* ── 1. imports ─────────────────────────────────────────────────────── */
src = src.replace(
  /^import .*?from "convex\/server";$/m,
  (m) => m
);
if (!src.includes('from "./tenancy"')) {
  src = src.replace(
    /(import \{ v \} from "convex\/values";)/,
    '$1\nimport { ConvexError } from "convex/values";\nimport { requirePermission, requireTenant } from "./tenancy";'
  );
}

/* ── 2. shop-scoped indexes become business-scoped ─────────────────── */
src = src.replace(
  /\.withIndex\("by_shop_date", q =>\s*q\.eq\("shopId", ([^)]+)\)\.gte\("date", ([^)]+)\)\.lte\("date", ([^)]+)\)/g,
  '.withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", $1).gte("date", $2).lte("date", $3))'
);
src = src.replace(
  /\.withIndex\("by_shop_date", q =>\s*q\.eq\("shopId", ([^)]+)\)\)/g,
  '.withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", $1))'
);

/* ── 3. date-only indexes become business+date ─────────────────────── */
src = src.replace(
  /\.withIndex\("by_date", q =>\s*q\.gte\("date", ([^)]+)\)\.lte\("date", ([^)]+)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", $1).lte("date", $2))'
);
src = src.replace(
  /\.withIndex\("by_date", q =>\s*q\.gte\("date", ([^)]+)\)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", $1))'
);
src = src.replace(
  /\.withIndex\("by_date", q =>\s*q\.lte\("date", ([^)]+)\)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).lte("date", $1))'
);

/* ── 4. plain reads become business-scoped ──────────────────────────── */
src = src.replace(/ctx\.db\.query\("(\w+)"\)(?!\s*\.withIndex)/g, (match, table) => {
  if (GLOBAL_TABLES.has(table)) return match;
  return `ctx.db.query("${table}").withIndex("by_businessId", q => q.eq("businessId", businessId))`;
});

/* ── 5. search-index reads are filtered by business ─────────────────── */
src = src.replace(
  /\.withSearchIndex\("(\w+)", q => q\.search\("(\w+)", ([^)]+)\)\)\s*\.collect\(\)/g,
  '.withSearchIndex("$1", q => q.search("$2", $3)).filter(q => q.eq(q.field("businessId"), businessId)).collect()'
);
src = src.replace(
  /\.withSearchIndex\("(\w+)", q => q\.search\("(\w+)", ([^)]+)\)\)\s*\n(\s*)\.collect\(\)/g,
  '.withSearchIndex("$1", q => q.search("$2", $3))\n$4.filter(q => q.eq(q.field("businessId"), businessId))\n$4.collect()'
);

/* ── 6. product-code prefix reads ──────────────────────────────────── */
src = src.replace(
  /\.withIndex\("by_productCode", q => q\.gte\("productCode", ([^)]+)\)\.lte\("productCode", ([^)]+)\)\)/g,
  '.withIndex("by_businessId_productCode", q => q.eq("businessId", businessId).gte("productCode", $1).lte("productCode", $2))'
);

/* ── 7. every handler resolves the tenant and needs a permission ────── */
src = src.replace(
  /handler: async \(ctx, args\) => \{\r?\n/g,
  "handler: async (ctx, args) => {\n        const tenant = await requireTenant(ctx, args.businessId);\n        const businessId = tenant.businessId;\n        await requirePermission(ctx, businessId, \"reports.view\");\n"
);

fs.writeFileSync(FILE, src, "utf8");
console.log("reports.ts patched");
console.log(
  "\nRemaining manual work:\n" +
    "  • add the optional businessId argument to each args block\n" +
    "  • ownership-check documents reached by id (ctx.db.get(args.x))\n" +
    "  • handlers whose args have no businessId yet"
);
