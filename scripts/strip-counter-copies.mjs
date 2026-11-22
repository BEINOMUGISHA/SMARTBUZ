/**
 * SMART_BUZ — remove the legacy product copies from the counters.
 *
 *   node scripts/strip-counter-copies.mjs
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * A counter used to keep a copy of the product it held: the name, the code,
 * the selling price, the profit value and the book value, frozen at the
 * moment the goods were issued. The counter now keeps only a quantity and
 * reads the product from the master catalogue.
 *
 * The old copies are ignored when they are read, so nothing is *wrong* with
 * them while they sit there. But they are still there: dead weight on
 * every row, and a trap for the next person who reads them and believes
 * them. This removes them.
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
 *
 * ────────────────────────────────────────────────────────────────────────
 * Which deployment it talks to
 * ────────────────────────────────────────────────────────────────────────
 *
 * The script uses `NEXT_PUBLIC_CONVEX_URL` — the same deployment the web app
 * uses. See `docs/RUNBOOK.md` §2.
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
  const result = await convex("mutation", "migration:stripCounterStockCopies", {
    serverSecret,
  });

  if (!ok(result)) {
    console.error(`Could not strip the copies: ${errText(result)}`);
    process.exit(1);
  }

  const value = result.value ?? {};
  console.log(`Counters checked  : ${value.countersChecked ?? 0}`);
  console.log(`Counters cleaned  : ${value.countersTouched ?? 0}`);
  console.log(`Rows cleaned      : ${value.rowsCleaned ?? 0}`);
  console.log(`Businesses touched: ${(value.businessesTouched ?? []).length}`);

  if ((value.rowsCleaned ?? 0) === 0) {
    console.log("\nEvery counter was already clean.");
  } else {
    console.log("\nDone. The counters now hold a quantity, and nothing else.");
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
