/**
 * SMART_BUZ — Contract checker.
 * Verifies that every mutation call in the vertical frontend pages passes
 * exactly the argument names the Convex validator declares (no missing
 * required fields, no stray extra fields).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/* ── 1. Parse backend validators ─────────────────────────────── */

function parseBackend(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = {};
  const re = /export const (\w+) = (mutation|query)\(\{\s*\n?\s*args:\s*\{/g;
  let mm;
  while ((mm = re.exec(src))) {
    const name = mm[1];
    const start = mm.index + mm[0].length;
    // Walk braces to find the matching close of the args object.
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    const keys = {};
    // Top-level keys only: depth 0 within the args object.
    let d = 0;
    let buf = "";
    const parts = [];
    for (const ch of body) {
      if (ch === "{" || ch === "[" || ch === "(") d++;
      else if (ch === "}" || ch === "]" || ch === ")") d--;
      if (ch === "," && d === 0) {
        parts.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    parts.push(buf);
    for (const p of parts) {
      const km = p.match(/^\s*(\w+)\s*:\s*(.*)$/s);
      if (km) {
        // A field is optional when its validator is wrapped in v.optional(...).
        const optional = /^\s*v\.optional\(/.test(km[2]);
        keys[km[1]] = optional ? "optional" : "required";
      }
    }
    out[name] = keys;
  }
  return out;
}

const backend = {};
for (const rel of [
  "convex/verticals/batches.ts",
  "convex/verticals/scheduling.ts",
  "convex/verticals/members.ts",
  "convex/verticals/operations.ts",
  "convex/businessProfiles.ts",
]) {
  // Module path mirrors the generated api namespace: verticals/members, businessProfiles
  const mod = rel.replace(/^convex\//, "").replace(/\.ts$/, "").replace(/\//g, ".");
  const parsed = parseBackend(path.join(ROOT, rel));
  for (const [fn, keys] of Object.entries(parsed)) {
    backend[`${mod}.${fn}`] = keys;
  }
}

/* ── 2. Parse frontend call sites ────────────────────────────── */

const pageDirs = fs
  .readdirSync(path.join(ROOT, "src/app/(dashboard)"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const problems = [];
let checked = 0;

for (const dir of pageDirs) {
  const file = path.join(ROOT, "src/app/(dashboard)", dir, "page.tsx");
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");

  // alias -> fully qualified backend path, from `const x = useMutation(api.a.b.c)`
  const aliases = {};
  const are = /const\s+(\w+)\s*=\s*useMutation\(\s*api\.([\w.]+)\s*\)/g;
  let am;
  while ((am = are.exec(src))) {
    aliases[am[1]] = am[2];
  }

  // Find `await alias({ ... })` blocks
  const cre = /await\s+(\w+)\(\s*\{/g;
  let cm;
  while ((cm = cre.exec(src))) {
    const alias = cm[1];
    const fn = aliases[alias];
    if (!fn || !backend[fn]) continue;    const start = cm.index + cm[0].length - 1;
    let depth = 0;
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = src.slice(start + 1, i);

    // Top-level keys of the argument object.
    const keys = new Set();
    let d = 0;
    let buf = "";
    const parts = [];
    for (const ch of body) {
      if (ch === "{" || ch === "[" || ch === "(") d++;
      else if (ch === "}" || ch === "]" || ch === ")") d--;
      if (ch === "," && d === 0) {
        parts.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    parts.push(buf);
    for (const p of parts) {
      // Match `key:` , `key,` (shorthand) and a bare `key` (last entry).
      const km = p.match(/^\s*(\w+)\s*(?::|,|$)/);
      if (km) keys.add(km[1]);
    }

    const allowed = backend[fn];
    const missing = Object.entries(allowed)
      .filter(([k, req]) => req === "required" && !keys.has(k))
      .map(([k]) => k);
    const extra = [...keys].filter((k) => !(k in allowed));
    checked++;
    if (missing.length || extra.length) {
      problems.push({ page: dir, fn, missing, extra });
    }
  }
}

console.log(`Checked ${checked} frontend mutation call sites against ${Object.keys(backend).length} backend functions.\n`);
if (problems.length === 0) {
  console.log("No mismatches found.");
} else {
  console.log(`${problems.length} potential mismatches:\n`);
  for (const p of problems) {
    console.log(`  ${p.page}/page.tsx -> ${p.fn}`);
    if (p.missing.length) console.log(`      missing from call: ${p.missing.join(", ")}`);
    if (p.extra.length) console.log(`      extra in call (not in validator): ${p.extra.join(", ")}`);
  }
}
