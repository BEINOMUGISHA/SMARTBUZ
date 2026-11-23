/**
 * SMART_BUZ — say which trail each audit entry belongs to.
 *
 *   node scripts/backfill-audit-scope.mjs
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * The audit trail is read a page at a time. The platform trail used to be
 * found by reading every audit row in the deployment and throwing away the
 * ones that belonged to a business — so a page of platform events cost the
 * whole table.
 *
 * The fix is a `scope` field on every row, so the platform trail can be
 * read from an index. Rows written before the field existed carry no scope,
 * and an index that keys on the scope will not find them. This fills them
 * in.
 *
 * It is safe to run more than once.
 *
 * ────────────────────────────────────────────────────────────────────────
 * When to run it
 * ────────────────────────────────────────────────────────────────────────
 *
 * After the new backend is published. The function it calls only exists in
 * the new backend, so running it against the old one fails with "Could not
 * find public function".
 *
 * It is a server operation and needs the server-to-backend secret.
 */
import { convex, ok, errText, ENV } from "./lib/harness.mjs";

/**
 * The server-to-backend secret. The backend refuses every call without it.
 * The value is never printed — only the fact that it is present.
 */
const serverSecret =
  ENV.SMARTBUZ_SERVER_SECRET || ENV.RESEND_API_KEY || ENV.SESSION_SECRET || "";

if (!serverSecret || serverSecret.length < 16) {
  console.error(
    "No server secret is configured. Set SMARTBUZ_SERVER_SECRET (or RESEND_API_KEY / SESSION_SECRET) in .env.local,\n" +
      "using the same value the Convex deployment has configured."
  );
  process.exit(1);
}

async function main() {
  const result = await convex("mutation", "migration:backfillAuditScope", {
    serverSecret,
  });

  if (!ok(result)) {
    console.error(`Could not set the audit scopes: ${errText(result)}`);
    process.exit(1);
  }

  const value = result.value ?? {};
  console.log(`Rows checked : ${value.checked ?? 0}`);
  console.log(`Rows scoped : ${value.scoped ?? 0}`);

  if ((value.scoped ?? 0) === 0) {
    console.log("\nEvery audit row already knew which trail it belonged to.");
  } else {
    console.log("\nDone. The platform trail can be read from an index.");
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
