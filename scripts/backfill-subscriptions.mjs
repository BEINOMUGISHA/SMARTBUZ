/**
 * SMART_BUZ — subscription backfill.
 *
 *   node scripts/backfill-subscriptions.mjs [--plan <planKey>] [--dry-run]
 *
 * Gives every business that has no subscription row a real one.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * A business used to be able to exist with **no subscription row at all**,
 * because the registration path forgot to create one. And a business with no
 * subscription row was not gated: it was given every entitlement, and it
 * could keep writing for ever. That is a hole in the licensing system, not
 * a missing feature.
 *
 * Two changes close it:
 *
 *   1. `businesses:register` now starts a trial, so no *new* business can
 *      be in that state;
 *   2. the entitlement gate fails closed, so a business with no
 *      subscription is not licensed and cannot write.
 *
 * This script is how the businesses that **already** exist get a
 * subscription, so that closing the gate does not lock them out.
 *
 * It is a server operation and needs the server-to-backend secret. Run it
 * **before** deploying the new backend, so that the tenants are ready the
 * moment the gate starts failing closed.
 */
import { convex, ok, errText, ENV } from "./lib/harness.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const dryRun = process.argv.includes("--dry-run");
const planKey = arg("plan") || null;

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
  const listed = await convex("query", "subscriptions:listUnsubscribed", {
    serverSecret,
  });

  if (!ok(listed)) {
    console.error(`Could not list the tenants without a subscription: ${errText(listed)}`);
    process.exit(1);
  }

  const businesses = listed.value ?? [];
  console.log(
    businesses.length === 0
      ? "Every business already has a subscription. Nothing to do."
      : `${businesses.length} business(es) have no subscription.`
  );

  if (dryRun) {
    for (const business of businesses) {
      console.log(`  would create a subscription for ${business.name} (${business.businessId})`);
    }
    console.log("\nDry run — nothing was written.");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const business of businesses) {
    const result = await convex("mutation", "subscriptions:backfillSubscription", {
      businessId: business.businessId,
      serverSecret,
      ...(planKey ? { planKey } : {}),
    });

    if (!ok(result)) {
      console.error(`  ✗ ${business.name}: ${errText(result)}`);
      skipped += 1;
      continue;
    }

    if (result.value?.created) {
      console.log(`  ✓ ${business.name} → trial on ${result.value.planKey}`);
      created += 1;
    } else {
      console.log(`  · ${business.name} already had a subscription — left alone`);
      skipped += 1;
    }
  }

  console.log(`\nDone. ${created} subscription(s) created, ${skipped} left alone.`);
  if (skipped > 0) {
    console.log(
      "Some businesses were not touched. Run this again before deploying the new backend."
    );
  }
}

main().catch((err) => {
  console.error(`\nBackfill failed: ${err.message}`);
  process.exit(1);
});
