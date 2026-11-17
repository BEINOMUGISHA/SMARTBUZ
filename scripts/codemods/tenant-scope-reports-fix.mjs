/**
 * SMART_BUZ — corrective pass for the reports codemod.
 *
 *   node scripts/tenant-scope-reports-fix.mjs
 *
 * Fixes the multi-line index chains and the stray parentheses the first
 * pass left behind, and rewrites every remaining date/shop index so it is
 * anchored on the caller's business.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

let src = fs.readFileSync(FILE, "utf8");

/* 1 ── multi-line .withIndex("by_date", (q) => …) */
src = src.replace(
  /\.withIndex\("by_date", \(q\) =>\s*\n\s*q\.gte\("date", ([^)]+)\)\.lte\("date", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_date", (q) => q.eq("businessId", businessId).gte("date", $1).lte("date", $2))'
);

/* 2 ── multi-line .withIndex("by_date", q => …) */
src = src.replace(
  /\.withIndex\("by_date", q =>\s*\n\s*q\.gte\("date", ([^)]+)\)\.lte\("date", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", $1).lte("date", $2))'
);
src = src.replace(
  /\.withIndex\("by_date", q =>\s*\n\s*q\.gte\("date", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", $1))'
);
src = src.replace(
  /\.withIndex\("by_date", q =>\s*\n\s*q\.lte\("date", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_date", q => q.eq("businessId", businessId).lte("date", $1))'
);

/* 3 ── multi-line .withIndex("by_shop_date", q => …) */
src = src.replace(
  /\.withIndex\("by_shop_date", q =>\s*\n\s*q\.eq\("shopId", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", $1))'
);
src = src.replace(
  /\.withIndex\("by_shop_date", \(q\) =>\s*\n\s*q\.eq\("shopId", ([^)]+)\)\s*\n(\s*)\)/g,
  '.withIndex("by_businessId_shop_date", (q) => q.eq("businessId", businessId).eq("shopId", $1))'
);

/* 4 ── stray closing parentheses left by the single-line rewrites */
src = src.replace(
  /(withIndex\("by_businessId_(?:shop_)?date", q =>[^\n]*\)\n)(\s*)\);\n/g,
  "$1"
);

/* 5 ── the "else" branch that still used the shop index */
src = src.replace(
  /ctx\.db\.query\("(\w+)"\)\.withIndex\("by_shop_date"/g,
  'ctx.db.query("$1").withIndex("by_businessId_shop_date"'
);

fs.writeFileSync(FILE, src, "utf8");
console.log("reports.ts corrected");
