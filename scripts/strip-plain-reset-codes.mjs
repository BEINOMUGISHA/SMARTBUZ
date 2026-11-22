/**
 * SMART_BUZ — take the plain reset codes out of the database.
 *
 *   node scripts/strip-plain-reset-codes.mjs
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * Reset codes used to be stored in the row in the clear. They are stored
 * hashed now, and a code from the plain era is refused when it is used.
 *
 * But the plain codes are still there, sitting in the rows, readable by
 * anybody with a read on the database. Refusing them at the door does not
 * help if the key is still under the mat.
 *
 * A row that has a plain code and no hash cannot be used for anything at
 * all, so it is deleted. A row that has both keeps its hash and loses the
 * plain copy.
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
  const result = await convex("mutation", "migration:stripPlainResetCodes", {
    serverSecret,
  });

  if (!ok(result)) {
    console.error(`Could not strip the plain codes: ${errText(result)}`);
    process.exit(1);
  }

  const value = result.value ?? {};
  console.log(`Rows checked      : ${value.checked ?? 0}`);
  console.log(`Plain codes taken out: ${value.stripped ?? 0}`);
  console.log(`Dead rows deleted : ${value.deleted ?? 0}`);

  if ((value.stripped ?? 0) === 0 && (value.deleted ?? 0) === 0) {
    console.log("\nThere were no plain reset codes left.");
  } else {
    console.log("\nDone. No reset code is stored in the clear.");
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
