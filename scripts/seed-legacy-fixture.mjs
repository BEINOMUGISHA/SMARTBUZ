/**
 * SMART_BUZ — legacy fixture seeder.
 *
 *   node scripts/seed-legacy-fixture.mjs
 *
 * Creates the operator account the migration will run as, and writes the
 * JSON files that are imported with `npx convex import` to recreate a
 * pre-multi-tenant deployment:
 *
 *   • a legacy `businessProfiles` row (the old "one business" table)
 *   • legacy tenant rows that carry **no** tenant pointer at all
 *     (a customer, a category, an invoice counter, an audit-log entry)
 *
 * The imported rows are exactly what the old schema produced, which is what
 * the migration has to preserve.
 */
import fs from "node:fs";
import path from "node:path";
import { convex, ok, errText, ROOT } from "./lib/harness.mjs";

const stamp = Date.now().toString(36);
const email = process.argv.includes("--email")
  ? process.argv[process.argv.indexOf("--email") + 1]
  : `legacy.operator.${stamp}@smartbuz.test`;
const password = process.argv.includes("--password")
  ? process.argv[process.argv.indexOf("--password") + 1]
  : "Password123!";

const outDir = path.join(ROOT, "scripts", "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const reg = await convex("mutation", "businesses:register", {
  businessName: `Legacy Operator ${stamp}`,
  ownerFirstName: "Legacy",
  ownerLastName: "Operator",
  ownerEmail: email,
  password,
  currency: "UGX",
  timezone: "Africa/Kampala",
});
if (!ok(reg)) {
  console.error("Could not create the operator:", errText(reg));
  process.exit(1);
}
const userId = reg.value.userId;

const files = {
  "businessProfiles.json": [
    {
      businessName: `Legacy Mart ${stamp}`,
      businessType: "retail",
      categoryId: "retail",
      industry: "Retail",
      modules: ["sales", "stock"],
      currency: "UGX",
      country: "Uganda",
      taxEnabled: true,
      taxRate: 18,
      taxInclusive: false,
      taxNote: "VAT 18%",
      tin: "TIN-LEGACY-001",
      allowPriceOverrides: true,
      isActive: true,
      createdBy: userId,
      businessAddress: "1 Legacy Road",
      businessPhone: "+256700000001",
      openingFloat: 500000,
      plan: "pro",
      subscriptionStatus: "active",
    },
  ],
  "customers.json": [
    { name: "Legacy Customer", phone: "0700000001" },
    { name: "Legacy Customer Two", phone: "0700000002" },
  ],
  "categories.json": [{ type: "Legacy Category" }],
  "counters.json": [{ name: "invoice", lastValue: 41 }],
  "activityLogs.json": [
    {
      userId,
      action: "Legacy Sale",
      details: "Sale recorded before the multi-tenant migration",
      timestamp: "2024-01-15T10:00:00.000Z",
    },
  ],
};

for (const [name, rows] of Object.entries(files)) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  console.log(`wrote ${path.relative(ROOT, file)} (${rows.length} row(s))`);
}

console.log("\nOperator");
console.log(`  email   : ${email}`);
console.log(`  password: ${password}`);
console.log(`  userId  : ${userId}`);
console.log(`\nImport with:`);
for (const name of Object.keys(files)) {
  console.log(`  npx convex import --table ${name.replace(".json", "")} --format jsonArray scripts/fixtures/${name}`);
}
