/**
 * SMART_BUZ — migration verification.
 *
 *   node scripts/verify-migration.mjs --email <operator> --password <password>
 *
 * Proves the migration actually preserves and re-points legacy data:
 *
 *   1. Before: legacy rows exist that carry no tenant pointer.
 *   2. After:  every row carries a `businessId`, every user has a
 *      membership, and the legacy business exists with the legacy settings.
 *   3. The migrated rows are *reachable*: the operator can list the legacy
 *      customer through the legacy business, and cannot see it from another
 *      business.
 *   4. Re-running the migration changes nothing (it is idempotent and never
 *      overwrites a row that already has a tenant).
 */
import { convex, ok, errText, signAccessToken, createRunner, SITE_URL, ENV } from "./lib/harness.mjs";

const { check, summary } = createRunner("SMART_BUZ migration");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * The server-to-backend secret. The migration is a deployment-time
 * operation, so the backend refuses every call without it — the value is
 * never logged, only the fact that it is present.
 */
const serverSecret =
  ENV.SMARTBUZ_SERVER_SECRET || ENV.RESEND_API_KEY || ENV.SESSION_SECRET || "";

const email = arg("email");
const password = arg("password");
if (!email || !password) {
  console.error("Usage: node scripts/verify-migration.mjs --email <login> --password <password>");
  process.exit(1);
}
if (!serverSecret || serverSecret.length < 16) {
  console.error(
    "No server secret is configured. Set SMARTBUZ_SERVER_SECRET (or RESEND_API_KEY / SESSION_SECRET) in .env.local."
  );
  process.exit(1);
}

const login = await convex("mutation", "users:login", { email, password });
if (!ok(login)) {
  console.error(`Could not sign in as ${email}: ${errText(login)}`);
  process.exit(1);
}
const user = login.value;
const token = signAccessToken({ userId: user._id, email: user.email, issuer: SITE_URL });

const call = async (kind, path, args = {}) => {
  const res = await convex(kind, path, { ...args, serverSecret }, token);
  if (!ok(res)) throw new Error(`${path}: ${errText(res)}`);
  return res.value;
};

/* ── before ───────────────────────────────────────────────────────────── */
console.log("\nBefore migration");
const before = await call("query", "migration:migrationStatus");
const unassignedBefore = Object.values(before.rowsWithoutBusiness).reduce((a, b) => a + b, 0);
if (before.migrationComplete) {
  console.log("  already migrated — the before-checks are informational only.");
  console.log(
    `  ${before.legacyProfiles} legacy profile(s), ${before.businesses} business(es), ` +
      `${before.memberships} membership(s), ${before.users} user(s).`
  );
} else {
  check(
    "legacy rows without a tenant pointer exist",
    unassignedBefore > 0,
    `${unassignedBefore} row(s) in ${Object.keys(before.rowsWithoutBusiness).length} table(s)`
  );
  check("legacy business profiles exist", before.legacyProfiles > 0, `${before.legacyProfiles}`);
}

/* ── run ──────────────────────────────────────────────────────────────── */
console.log("\nRunning migration");
const profiles = await call("mutation", "migration:migrateBusinessProfiles");
console.log(`  ${profiles.profiles} profile(s) → ${profiles.businesses} business(es)`);
const targetBusinessId = profiles.operatorBusinessId;
check("a business was created for the legacy profile", !!targetBusinessId, targetBusinessId ?? "");

const members = await call("mutation", "migration:migrateMemberships", {
  mapping: profiles.mapping,
  businessId: targetBusinessId ?? undefined,
});
console.log(`  ${members.membershipsCreated} membership(s) created`);

const stamped = await call("mutation", "migration:migrateTenantRows", {
  mapping: profiles.mapping,
  businessId: targetBusinessId ?? undefined,
});
const stampedTotal = Object.values(stamped.report).reduce((a, b) => a + b, 0);
console.log(`  ${stampedTotal} row(s) stamped with a businessId`);

/* ── after ────────────────────────────────────────────────────────────── */
console.log("\nAfter migration");
const after = await call("query", "migration:migrationStatus");
check("every user has a membership", after.usersWithoutMembership === 0, `${after.usersWithoutMembership} without`);
check(
  "no row is left without a businessId",
  Object.keys(after.rowsWithoutBusiness).length === 0,
  JSON.stringify(after.rowsWithoutBusiness)
);
check("migrationComplete is true", after.migrationComplete === true);
check("the legacy profile was not deleted", after.legacyProfiles === before.legacyProfiles);
check("users were preserved", after.users === before.users, `${after.users}`);
if (!before.migrationComplete) {
  check(
    "memberships were created for the existing users",
    after.memberships > before.memberships,
    `${before.memberships} → ${after.memberships}`
  );
} else {
  console.log(
    `  memberships: ${before.memberships} → ${after.memberships} (already migrated, nothing to create)`
  );
}

/* ── the legacy data is reachable ─────────────────────────────────────── */
console.log("\nMigrated data");

// The operator keeps working in the business they were already in, so the
// migrated business has to be opened explicitly — that is the business
// switcher, and it is the only way in.
await call("mutation", "businesses:switchBusiness", { businessId: targetBusinessId });

const active = await call("query", "businesses:getActive", {});
check(
  "the operator can work in the migrated business",
  active._id === targetBusinessId,
  active._id
);
check(
  "the migrated business kept the legacy currency",
  active.currency === "UGX",
  active.currency
);
check(
  "the migrated business kept the legacy tax settings",
  active.taxRate === 18,
  String(active.taxRate)
);

const customers = await call("query", "customers:listAll");
const names = customers.map((c) => c.name);
check(
  "the legacy customer is visible in the migrated business",
  names.includes("Legacy Customer"),
  names.join(", ")
);
const legacyCustomer = customers.find((c) => c.name === "Legacy Customer");
check(
  "the legacy customer row now carries the businessId",
  legacyCustomer?.businessId === targetBusinessId,
  legacyCustomer?.businessId ?? "missing"
);

/* The operator also owns another business — the legacy data must not leak
   into it, and its own rows must not have been rewritten. */
const mine = await call("query", "businesses:listMine");
const otherBusiness = mine.find((m) => m.business._id !== targetBusinessId);
if (otherBusiness) {
  await call("mutation", "businesses:switchBusiness", {
    businessId: otherBusiness.business._id,
  });
  const otherCustomers = await call("query", "customers:listAll");
  check(
    "the legacy customer is not visible from another business",
    !otherCustomers.some((c) => c.name === "Legacy Customer"),
    `${otherCustomers.length} customer(s) visible`
  );
  await call("mutation", "businesses:switchBusiness", { businessId: targetBusinessId });
} else {
  check("a second business exists to test isolation against", false, "none found");
}

/* ── idempotency ──────────────────────────────────────────────────────── */
console.log("\nRe-running the migration");
const customerBefore = legacyCustomer?.businessId;
const profiles2 = await call("mutation", "migration:migrateBusinessProfiles");
const members2 = await call("mutation", "migration:migrateMemberships", {
  mapping: profiles2.mapping,
  businessId: targetBusinessId ?? undefined,
});
const stamped2 = await call("mutation", "migration:migrateTenantRows", {
  mapping: profiles2.mapping,
  businessId: targetBusinessId ?? undefined,
});
check("no duplicate businesses were created", profiles2.businesses === profiles.businesses);
check("no duplicate memberships were created", members2.membershipsCreated === 0, `${members2.membershipsCreated}`);
check(
  "no already-migrated row was rewritten",
  (stamped2.report?.customers ?? 0) === 0,
  `${stamped2.report?.customers ?? 0} customer row(s) re-stamped`
);

const customersAfter = await call("query", "customers:listAll");
const legacyCustomerAfter = customersAfter.find((c) => c.name === "Legacy Customer");
check(
  "the migrated customer still points at the same business",
  legacyCustomerAfter?.businessId === customerBefore,
  `${customerBefore} → ${legacyCustomerAfter?.businessId}`
);

const final = await call("query", "migration:migrationStatus");
check("the migration is still complete", final.migrationComplete === true);

process.exit(summary() ? 0 : 1);
