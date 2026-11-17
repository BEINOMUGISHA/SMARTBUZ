/**
 * SMART_BUZ — frontend codemod.
 *
 *   node scripts/fix-usequery-args.mjs
 *
 * Convex's `useQuery` may omit the args argument only when the query takes
 * no arguments. Every tenant query now takes an optional `businessId`, so
 * the single-argument call sites need an explicit `{}`.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const SRC = path.join(ROOT, "src");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let changed = 0;
for (const file of walk(SRC)) {
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(/useQuery\((api\.[A-Za-z0-9_.]+)\)/g, "useQuery($1, {})");
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed++;
    console.log(`patched ${path.relative(ROOT, file)}`);
  }
}
console.log(`\n${changed} file(s) patched.`);
