/**
 * SMART_BUZ — put every barcode in the database into the stored form.
 *
 *   node scripts/normalise-barcodes.mjs
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * A barcode is stored upper case with the spaces and punctuation taken
 * out, so that a scanner reporting "abc-123" finds a barcode stored as
 * "ABC-123". The lookup reads the index, and the index only matches what
 * is actually stored.
 *
 * A barcode written before that rule was in force is still stored in the
 * form it was typed in, so the index cannot find it and the scan comes
 * back empty. This rewrites those rows.
 *
 * A barcode that another product in the same business already holds is
 * left alone: the clash is a question for a person, and resolving it by
 * guessing would give one product the other's barcode.
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
  const result = await convex("mutation", "migration:normaliseBarcodes", {
    serverSecret,
  });

  if (!ok(result)) {
    console.error(`Could not normalise the barcodes: ${errText(result)}`);
    process.exit(1);
  }

  const value = result.value ?? {};
  console.log(`Rows checked   : ${value.checked ?? 0}`);
  console.log(`Barcodes rewritten: ${value.normalised ?? 0}`);
  console.log(`Barcodes cleared  : ${value.cleared ?? 0}`);

  if ((value.normalised ?? 0) === 0 && (value.cleared ?? 0) === 0) {
    console.log("\nEvery barcode was already in the stored form.");
  } else {
    console.log("\nDone. Every barcode can now be found by the index.");
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
