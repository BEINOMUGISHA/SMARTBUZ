/**
 * One-shot codemod: replace coarse legacy permission gates with the
 * canonical Phase 2 permissions, per call site.
 *
 * Line-targeted on purpose — several files gate several handlers with the
 * same legacy permission but need different canonical ones (a catalogue
 * *create* is `products.create`; a catalogue *edit* is `products.update`).
 *
 * Usage: node scripts/phase2-permission-codemod.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** file -> { lineNumber (1-based) -> new permission } */
const EDITS = {
  "convex/categories.ts": {
    33: "products.create",
    61: "products.update",
    91: "products.update",
  },
  "convex/stocks.ts": {
    498: "products.create",
    588: "products.update",
    662: "products.update",
    709: "inventory.adjust",
  },
  "convex/promotions.ts": {
    101: "products.create",
    135: "products.update",
    173: "products.update",
    249: "products.update",
    309: "products.update",
    344: "products.update",
  },
  "convex/shops.ts": {
    271: "inventory.transfer",
    329: "inventory.transfer",
    361: "inventory.adjust",
    393: "inventory.adjust",
    470: "inventory.transfer",
    517: "inventory.transfer",
    606: "inventory.transfer",
  },
  "convex/verticals/batches.ts": {
    99: "inventory.adjust",
    182: "inventory.adjust",
    328: "products.create",
    377: "sales.create",
  },
  "convex/expenses.ts": {
    41: "finance.expenses.create",
    76: "finance.expenses.create",
    110: "finance.expenses.create",
    19: "finance.reports.view",
    148: "finance.reports.view",
    176: "finance.reports.view",
    221: "finance.reports.view",
  },
  "convex/warehouses.ts": {
    73: "inventory.transfer",
    120: "inventory.transfer",
    149: "inventory.transfer",
    195: "inventory.transfer",
    21: "inventory.view",
    51: "inventory.view",
  },
  "convex/banking.ts": {
    19: "finance.reports.view",
  },
  "convex/activityLogs.ts": {
    24: "finance.reports.view",
  },
  "convex/sales.ts": {
    550: "sales.cancel",
  },
  "convex/dashboard.ts": {
    21: "finance.reports.view",
  },
};

let changed = 0;
const problems = [];

for (const [file, edits] of Object.entries(EDITS)) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    problems.push(`${file}: missing`);
    continue;
  }
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);

  for (const [lineNo, permission] of Object.entries(edits)) {
    const index = Number(lineNo) - 1;
    const line = lines[index];
    if (line === undefined) {
      problems.push(`${file}:${lineNo}: line out of range`);
      continue;
    }
    if (!line.includes("requirePermission(")) {
      problems.push(`${file}:${lineNo}: not a permission gate -> ${line.trim()}`);
      continue;
    }
    const next = line.replace(
      /requirePermission\(\s*ctx,\s*[^,]+,\s*"[a-zA-Z.]+"\s*\)/,
      `requirePermission(ctx, tenant.businessId, "${permission}")`
    );
    if (next === line) {
      problems.push(`${file}:${lineNo}: pattern did not match -> ${line.trim()}`);
      continue;
    }
    lines[index] = next;
    changed++;
  }

  fs.writeFileSync(full, lines.join("\n"), "utf8");
}

console.log(`Rewrote ${changed} permission gate(s).`);
if (problems.length) {
  console.error("\nProblems:");
  for (const problem of problems) console.error("  - " + problem);
  process.exitCode = 1;
}
