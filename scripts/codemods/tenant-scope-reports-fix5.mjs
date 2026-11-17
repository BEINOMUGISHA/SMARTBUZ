/**
 * SMART_BUZ — fifth corrective pass for the reports codemod.
 *
 *   node scripts/tenant-scope-reports-fix5.mjs
 *
 * 1. A Convex query cannot carry both an index and a search index — the
 *    search form keeps only the business filter.
 * 2. `stockEntries` and `payments` have no business+date index, so they use
 *    the business index plus a date filter.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

let src = fs.readFileSync(FILE, "utf8");

/* 1 ── search index chains keep only the search + business filter */
src = src.replace(
  /ctx\.db\.query\("(\w+)"\)\.withIndex\("by_businessId", q => q\.eq\("businessId", businessId\)\)\r?\n(\s*)\.withSearchIndex/g,
  'ctx.db.query("$1")\r\n$2.withSearchIndex'
);
src = src.replace(
  /ctx\.db\.query\("(\w+)"\)\.withIndex\("by_businessId", q => q\.eq\("businessId", businessId\)\)\.withSearchIndex/g,
  'ctx.db.query("$1").withSearchIndex'
);

/* 2 ── stockEntries */
src = src.replace(
  /\.withIndex\("by_businessId_date", q => q\.eq\("businessId", businessId\)\.gte\("date", startOfToday\)\.lte\("date", endOfToday\)\)/g,
  '.withIndex("by_businessId", q => q.eq("businessId", businessId))\n            .filter(q => q.and(q.gte(q.field("date"), startOfToday), q.lte(q.field("date"), endOfToday)))'
);

/* 3 ── payments */
src = src.replace(
  /ctx\.db\.query\("payments"\)\.withIndex\("by_businessId_date", q => q\.eq\("businessId", businessId\)\.gte\("date", ([^)]+)\)\.lte\("date", ([^)]+)\)\)\.collect\(\)/g,
  'ctx.db.query("payments").withIndex("by_businessId", q => q.eq("businessId", businessId)).filter(q => q.and(q.gte(q.field("date"), $1), q.lte(q.field("date"), $2))).collect()'
);

fs.writeFileSync(FILE, src, "utf8");
console.log("reports.ts: index shapes corrected");
