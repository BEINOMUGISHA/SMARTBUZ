/**
 * SMART_BUZ — fourth corrective pass for the reports codemod.
 *
 *   node scripts/tenant-scope-reports-fix4.mjs
 *
 * 1. Every report gets the optional `businessId` argument.
 * 2. Search-index reads are rewritten so the business filter sits on the
 *    search result set (a query cannot carry both an index and a search
 *    index).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILE = path.join(ROOT, "convex", "reports.ts");

let src = fs.readFileSync(FILE, "utf8");

/* ── 1. search-index reads ──────────────────────────────────────────── */
src = src.replace(
  /ctx\.db\.query\("(\w+)"\)\.withIndex\("by_businessId", q => q\.eq\("businessId", businessId\)\)\.withSearchIndex\("(\w+)", q => q\.search\("(\w+)", ([^)]+)\)\)/g,
  'ctx.db.query("$1").withSearchIndex("$2", q => q.search("$3", $4)).filter(q => q.eq(q.field("businessId"), businessId))'
);

/* ── 2. the optional businessId argument ────────────────────────────── */
function addBusinessIdArg(source) {
  let out = "";
  let i = 0;
  const marker = "args: {";
  while (i < source.length) {
    const at = source.indexOf(marker, i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, at) + marker;
    let j = at + marker.length;
    let depth = 1;
    while (j < source.length && depth > 0) {
      const ch = source[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    const body = source.slice(at + marker.length, j);
    if (!body.includes("businessId:")) {
      const trimmed = body.replace(/\s+$/, "");
      const needsComma = !trimmed.endsWith(",");
      const newBody = trimmed + (needsComma ? "," : "") + "\n        businessId: v.optional(v.id(\"businesses\")),\n    ";
      out += newBody;
    } else {
      out += body;
    }
    i = j;
  }
  return out;
}

src = addBusinessIdArg(src);

fs.writeFileSync(FILE, src, "utf8");
console.log("reports.ts: arguments and search reads fixed");
