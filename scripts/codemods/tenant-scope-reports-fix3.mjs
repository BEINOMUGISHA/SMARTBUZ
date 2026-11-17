/**
 * SMART_BUZ — third corrective pass for the reports codemod.
 *
 *   node scripts/tenant-scope-reports-fix3.mjs
 *
 * The index rewrites left one surplus closing parenthesis in the
 * `await (cond ? … : …)` blocks. This removes it.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

let src = fs.readFileSync(FILE, "utf8");

const before = src;

/* the `await (…)` ternary form */
src = src.replace(
  /\.lte\("date", ([^)]+)\)\)\)\.collect\(\)/g,
  '.lte("date", $1)).collect()'
);

/* the multi-line chain form */
src = src.replace(
  /\.lte\("date", ([^)]+)\)\)\)\r?\n(\s*)\.collect\(\);/g,
  '.lte("date", $1))\r\n$2.collect();'
);

fs.writeFileSync(FILE, src, "utf8");
console.log(src === before ? "no change" : "reports.ts: surplus parentheses removed");
