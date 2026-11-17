/**
 * One-shot codemod: express the sidebar's role gates in the Phase 2 role
 * vocabulary instead of the legacy six-role one.
 *
 * Usage: node scripts/phase2-nav-roles-codemod.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "src/lib/category-nav.ts");

/** Legacy role group → the Phase 2 roles that hold it. */
const GROUPS = {
  admin: ["business_owner", "business_admin"],
  settings: ["business_owner", "business_admin"],
  stock: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  sales: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "cashier",
    "salesperson",
  ],
  reports: ["business_owner", "business_admin", "accountant", "auditor"],
};

/** Per-module overrides, where the default grouping is too coarse. */
const OVERRIDES = {
  stock: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  inventory: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  shops: ["business_owner", "business_admin", "branch_manager"],
  suppliers: ["business_owner", "business_admin", "inventory_manager"],
  purchaseOrders: ["business_owner", "business_admin", "inventory_manager"],
  deliveries: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "inventory_manager",
  ],
  appointments: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  bookings: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  classes: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  tables: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "cashier",
    "salesperson",
  ],
  rooms: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  menu: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "cashier",
    "salesperson",
    "inventory_manager",
  ],
  batches: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  expiry: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  prescriptions: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  members: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "accountant",
    "auditor",
    "salesperson",
  ],
  attendance: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  customers: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "cashier",
    "salesperson",
    "accountant",
  ],
  loans: ["business_owner", "business_admin", "accountant"],
  receivables: ["business_owner", "business_admin", "accountant", "auditor"],
  services: ["business_owner", "business_admin", "branch_manager", "supervisor"],
  production: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
  fuelPump: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "cashier",
    "salesperson",
  ],
  assets: ["business_owner", "business_admin"],
  rentals: [
    "business_owner",
    "business_admin",
    "branch_manager",
    "supervisor",
    "salesperson",
  ],
  expenses: ["business_owner", "business_admin", "accountant"],
  reports: ["business_owner", "business_admin", "accountant", "auditor"],
  promotions: ["business_owner", "business_admin"],
  systemconfig: ["business_owner", "business_admin"],
  maintenance: ["business_owner", "business_admin"],
  grn: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
};

let source = fs.readFileSync(FILE, "utf8");

// Each module entry: `id: "x", ... roles: [...]`. Replace the roles array
// that belongs to that entry.
const pattern = /(\bid:\s*"([a-zA-Z]+)",[\s\S]*?roles:\s*)\[[^\]]*\]/g;

let replaced = 0;
source = source.replace(pattern, (match, prefix, id) => {
  const roles = OVERRIDES[id];
  if (!roles) {
    console.warn(`  ! no override for module "${id}" — left unchanged`);
    return match;
  }
  replaced++;
  return `${prefix}[${roles.map((r) => `"${r}"`).join(", ")}]`;
});

fs.writeFileSync(FILE, source, "utf8");
console.log(`Rewrote ${replaced} navigation role gate(s).`);

// Report anything still using the legacy vocabulary.
const leftovers = [...source.matchAll(/roles:\s*\[([^\]]*)\]/g)]
  .map((m) => m[1])
  .filter((list) => /"(admin|settings|stock|sales|reports)"/.test(list));
if (leftovers.length) {
  console.error("Legacy role names still present:");
  for (const leftover of leftovers) console.error("  - " + leftover);
  process.exitCode = 1;
}
