/**
 * SMART_BUZ — multi-tenant migration driver.
 *
 *   node scripts/migrate-to-multitenancy.mjs \
 *     --email admin@pos.com --password password123
 *
 * Migrates a deployment that still holds single-tenant data:
 *
 *   1. legacy `businessProfiles`  →  `businesses`
 *   2. memberships for every existing user
 *   3. `businessId` stamped on every tenant-owned row
 *
 * Nothing is deleted: the legacy `businessProfiles` rows are left in place
 * (marked deprecated) so the migration can be inspected, and re-running the
 * script is safe.
 *
 * The operator authenticates with their own account, so the migration runs
 * with the same permissions as that person — an administrator of the
 * business being migrated.
 *
 * The server additionally requires the server-to-backend secret on every
 * call (`SMARTBUZ_SERVER_SECRET`, or `RESEND_API_KEY` / `SESSION_SECRET` as
 * fallbacks). That secret is what keeps the migration a deployment-time
 * operation: a browser cannot obtain it, so a tenant administrator cannot
 * rewrite the deployment even though they hold an owner role.
 */
import { convex, ok, errText, signAccessToken, ENV, CONVEX_URL, SITE_URL } from "./lib/harness.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const email = (arg("email") || ENV.MIGRATION_EMAIL || "").trim().toLowerCase();
const password = arg("password") || ENV.MIGRATION_PASSWORD || "";
/**
 * Optional: the id of the business the legacy data belongs to. When it is not
 * given, the server picks it — the business that the operator's own legacy
 * profile became, or the one they own.
 */
const businessId = arg("business") || ENV.MIGRATION_BUSINESS_ID || null;

/**
 * The server-to-backend secret. The Convex side refuses every migration call
 * without it, so the script must send exactly the same value that the
 * deployment has configured. The value itself is never logged.
 */
const serverSecret =
  ENV.SMARTBUZ_SERVER_SECRET || ENV.RESEND_API_KEY || ENV.SESSION_SECRET || "";

if (!email || !password) {
  console.error(
    "Usage: node scripts/migrate-to-multitenancy.mjs --email <login> --password <password>\n" +
      "       (or set MIGRATION_EMAIL / MIGRATION_PASSWORD in .env.local)"
  );
  process.exit(1);
}

if (!serverSecret || serverSecret.length < 16) {
  console.error(
    "No server secret is configured. The migration can only be run by the server.\n" +
      "Set SMARTBUZ_SERVER_SECRET (or RESEND_API_KEY / SESSION_SECRET) in .env.local,\n" +
      "using the same value the Convex deployment has configured."
  );
  process.exit(1);
}

async function main() {
  console.log(`Target deployment: ${CONVEX_URL}`);

  /* ── 1. authenticate as the operator ─────────────────────────────── */
  const login = await convex("mutation", "users:login", { email, password });
  if (!ok(login)) {
    console.error(`Could not sign in as ${email}: ${errText(login)}`);
    process.exit(1);
  }
  const user = login.value;
  console.log(`Signed in as ${user.email} (${user._id})`);

  /* ── 2. mint an access token the backend accepts ─────────────────── */
  const token = signAccessToken({
    userId: user._id,
    email: user.email,
    issuer: SITE_URL,
  });

  const call = async (fnPath, args = {}) => {
    const res = await convex("mutation", fnPath, args, token);
    if (!ok(res)) {
      throw new Error(`${fnPath}: ${errText(res)}`);
    }
    return res.value;
  };

  /* ── 3. status before ────────────────────────────────────────────── */
  const before = await convex("query", "migration:migrationStatus", { serverSecret }, token);
  console.log("\nBefore migration:");
  console.log(
    ok(before)
      ? JSON.stringify(
            {
              legacyProfiles: before.value.legacyProfiles,
              businesses: before.value.businesses,
              memberships: before.value.memberships,
              users: before.value.users,
              usersWithoutMembership: before.value.usersWithoutMembership,
              rowsWithoutBusiness: before.value.rowsWithoutBusiness,
            },
            null,
            2
        )
      : errText(before)
  );

  /* ── 4. copy the business profiles ───────────────────────────────── */
  console.log("\n→ Copying legacy business profiles…");
  const profiles = await call("migration:migrateBusinessProfiles", { serverSecret });
  console.log(
    `   ${profiles.profiles} profile(s) → ${profiles.businesses} business(es).`
  );

  // The business the legacy data belongs to: the one the operator's own
  // profile became, unless the caller named one explicitly.
  const targetBusinessId = businessId || profiles.operatorBusinessId || null;
  console.log(`   Target business: ${targetBusinessId ?? "(server decides)"}`);

  /* ── 5. create the memberships ───────────────────────────────────── */
  console.log("→ Creating memberships…");
  const members = await call("migration:migrateMemberships", {
    mapping: profiles.mapping,
    businessId: targetBusinessId ?? undefined,
    serverSecret,
  });
  console.log(
    `   ${members.membershipsCreated} membership(s) created, ${members.activeBusinessSet} user(s) given an active business.`
  );

  /* ── 6. stamp the tenant id on every row ─────────────────────────── */
  console.log("→ Stamping businessId on tenant-owned rows…");
  const stamped = await call("migration:migrateTenantRows", {
    mapping: profiles.mapping,
    businessId: targetBusinessId ?? undefined,
    serverSecret,
  });
  for (const [table, count] of Object.entries(stamped.report)) {
    if (count > 0) console.log(`   ${table}: ${count} row(s)`);
  }
  for (const [table, count] of Object.entries(stamped.assignedByDefault ?? {})) {
    console.log(`   ${table}: ${count} row(s) assigned to the primary business (no legacy pointer)`);
  }

  /* ── 7. status after ─────────────────────────────────────────────── */
  const after = await convex("query", "migration:migrationStatus", { serverSecret }, token);
  console.log("\nAfter migration:");
  console.log(
    ok(after)
      ? JSON.stringify(
            {
              businesses: after.value.businesses,
              memberships: after.value.memberships,
              usersWithoutMembership: after.value.usersWithoutMembership,
              rowsWithoutBusiness: after.value.rowsWithoutBusiness,
              migrationComplete: after.value.migrationComplete,
            },
            null,
            2
        )
      : errText(after)
  );

  console.log(
    ok(after) && after.value.migrationComplete
      ? "\n✅ Migration complete."
      : "\n⚠️  Migration finished with items still outstanding (see above)."
  );
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
