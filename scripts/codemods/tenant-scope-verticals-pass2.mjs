/**
 * SMART_BUZ — second codemod pass for the vertical modules.
 *
 *   node scripts/tenant-scope-verticals-pass2.mjs
 *
 * 1. Every handler that touches tenant data resolves the tenant first.
 * 2. Every document reached by id is ownership-checked, so a caller cannot
 *    pass somebody else's record id.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILES = ["scheduling.ts", "members.ts", "operations.ts"];

const TENANT_TABLES = new Set([
  "appointments", "serviceOutlets", "menuItems", "members", "memberTransactions",
  "customerWallets", "walletTransactions", "serviceTickets", "staffCommissions",
  "assets", "suppliers", "purchaseOrders", "goodsReceipts", "deliveries",
  "fuelDispenses", "vehicles", "classEnrolments", "attendance", "tillSessions",
  "donations", "tableOrders", "recurringCharges", "productSerials",
  "customerMeasurements", "productionBatches", "rentals", "routeFares",
  "categorySettings", "productBatches", "sales", "stocks", "customers", "shops",
  "users", "memberships", "employees", "branches", "warehouses", "promotions",
  "promotionProducts", "promotionRedemptions", "expenses", "banking",
  "activityLogs", "counters", "stockEntries", "shopIssueRecords", "stockLedger",
  "loans", "payments",
]);

for (const file of FILES) {
  const full = path.join(ROOT, "convex", "verticals", file);
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);

  /* ── 1. make sure every handler resolves the tenant ── */
  for (let i = 0; i < lines.length; i++) {
    if (!/handler: async \(ctx/.test(lines[i])) continue;

    // Find the end of this handler block (the closing "    }," of the handler).
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s{4}\},?\s*$/.test(lines[j])) { end = j; break; }
    }
    if (end === -1) continue;

    const body = lines.slice(i + 1, end).join("\n");
    if (/requireTenant/.test(body)) continue;
    if (!/\btenant\./.test(body) && !/\bbusinessId\b/.test(body)) continue;

    lines.splice(
      i + 1,
      0,
      "        const tenant = await requireTenant(ctx, args.businessId);",
      "        const businessId = tenant.businessId;"
    );
    i += 2;
  }

  let src = lines.join("\n");

  /* ── 2. ownership-check documents reached by id ── */
  src = src.replace(
    /const (\w+) = await ctx\.db\.get\(args\.(\w+)\);\r?\n(\s*)if \(!\1\) throw new Error\("([^"]+)"\);/g,
    (match, doc, arg, indent, message) =>
      `const ${doc} = await ctx.db.get(args.${arg});\n${indent}if (!${doc}) throw new Error("${message}");\n` +
      `${indent}if (${doc}.businessId !== businessId) {\n${indent}    throw new ConvexError("Forbidden: that record belongs to another business.");\n${indent}}`
  );

  fs.writeFileSync(full, src, "utf8");
  console.log(`patched ${file}`);
}
