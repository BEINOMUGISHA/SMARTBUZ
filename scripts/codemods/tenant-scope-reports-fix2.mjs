/**
 * SMART_BUZ — second corrective pass for the reports codemod.
 *
 *   node scripts/tenant-scope-reports-fix2.mjs
 *
 * Removes the stray closing parentheses the single-line rewrites left
 * behind and restores the `await (…)` grouping the index rewrites broke.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

let src = fs.readFileSync(FILE, "utf8");

/* 1 ── a single-line business-scoped index assignment no longer needs the
       extra ");" that the old multi-line chain had. */
src = src.replace(
  /(withIndex\("by_businessId_(?:shop_)?date", q =>[^\r\n]*\))\r?\n[ \t]*\);\r?\n/g,
  "$1\r\n"
);

fs.writeFileSync(FILE, src, "utf8");
console.log("reports.ts: stray parentheses removed");
