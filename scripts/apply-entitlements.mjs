// One-off helper: insert entitlement guards into the gated Convex modules.
//
// Each exported function is gated once, immediately after its first
// permission check. The guard is the plan tier check (`requireEntitlement`),
// which is deliberately separate from the write gate in `requirePermission`.
//
// Boundaries come in two shapes:
//   export const foo = query({...}) / mutation({...})
//   export async function fooHandler(ctx, args) {...}   <- exported so the
//       legacy `verticals.operations` wrappers can delegate to it
//
// Both shapes are real entry points, so both must be gated.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** file -> { functionName: featureKey }; "*" applies to every function. */
const PLAN = {
  "convex/analytics.ts": { "*": "business.intelligence" },
  "convex/purchasing.ts": { "*": "purchasing" },
  "convex/suppliers.ts": { "*": "purchasing" },
  "convex/customers.ts": {
    getAccount: "customer.credit",
    getStatement: "customer.credit",
    getOutstandingBalances: "customer.credit",
    setCreditLimit: "customer.credit",
    recordPayment: "customer.credit",
    getLoyalty: "loyalty.points",
    adjustLoyalty: "loyalty.points",
  },
  "convex/finance.ts": {
    recordIncome: "finance.reports",
    listIncome: "finance.reports",
    reconcile: "finance.reports",
    listReconciliations: "finance.reports",
    getFinancialSummary: "finance.reports",
  },
};

const GUARD = /^\s*await requireEntitlement\(ctx, tenant\.businessId, "[^"]+"\);$/;
const BOUNDARY = /^(?:export const (\w+) = (?:mutation|query)\(|export async function (\w+)\()/;

for (const [file, map] of Object.entries(PLAN)) {
  const path = join(ROOT, file);

  // 1. Strip any guard inserted by an earlier run.
  let lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !GUARD.test(line));

  // 2. Re-insert, one per function, after its first permission check.
  let currentFn = null;
  const gated = [];

  for (let i = 0; i < lines.length; i++) {
    const b = BOUNDARY.exec(lines[i]);
    if (b) currentFn = b[1] ?? b[2];

    const perm = /^\s*await requirePermission\(ctx, tenant\.businessId, "([^"]+)"\);$/.exec(
      lines[i]
    );
    if (!perm || !currentFn) continue;

    const feature = map["*"] ?? map[currentFn];
    if (!feature) continue;
    if (gated.includes(currentFn)) continue;

    const indent = lines[i].match(/^\s*/)[0];
    lines.splice(
      i + 1,
      0,
      `${indent}await requireEntitlement(ctx, tenant.businessId, "${feature}");`
    );
    gated.push(currentFn);
    i++;
  }

  let text = lines.join("\n");

  // 3. Make sure the import is there.
  if (!text.includes('from "./entitlements"')) {
    const all = text.split("\n");
    let lastImport = -1;
    all.forEach((line, idx) => {
      if (/^import .*from "\.\/[^"]+";$/.test(line)) lastImport = idx;
    });
    all.splice(lastImport + 1, 0, 'import { requireEntitlement } from "./entitlements";');
    text = all.join("\n");
  }

  writeFileSync(path, text, "utf8");
  console.log(`${file}: ${gated.length} function(s) -> ${gated.join(", ")}`);
}
