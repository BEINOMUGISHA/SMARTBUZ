/**
 * SMARTBUZ — bootstrap the first platform super administrator.
 *
 * Granting a platform role normally needs a platform role, so the very
 * first one is bootstrapped: `platform:bootstrapSuperAdmin` works only
 * while the platform has no active administrator at all, and only for a
 * caller holding the server secret.
 *
 * Usage:
 *   SMARTBUZ_SERVER_SECRET=... node scripts/bootstrap-platform-admin.mjs --email admin@example.com
 *
 * The secret is read from the environment — it is never passed as an
 * argument, so it does not end up in the shell history or in a process
 * listing.
 */
import fs from "node:fs";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.CONVEX_URL ||
  "";

const SERVER_SECRET =
  process.env.SMARTBUZ_SERVER_SECRET ||
  process.env.RESEND_API_KEY ||
  process.env.SESSION_SECRET ||
  "";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

if (!CONVEX_URL) {
  console.error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Point it at your deployment first."
  );
  process.exit(1);
}

if (!SERVER_SECRET) {
  console.error(
    "No server secret found. Set SMARTBUZ_SERVER_SECRET (the same value the Convex deployment has)."
  );
  process.exit(1);
}

const email = arg("email");
const userId = arg("userId");

if (!email && !userId) {
  console.error("Pass --email <address> or --userId <id>.");
  process.exit(1);
}

// Allow reading the secret from a file when the environment is awkward.
const secretFile = arg("secretFile");
let secret = SERVER_SECRET;
if (secretFile) {
  secret = fs.readFileSync(secretFile, "utf8").trim();
}

console.log(`Bootstrapping a platform super administrator on ${CONVEX_URL}…`);

const res = await fetch(`${CONVEX_URL}/api/mutation`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "platform:bootstrapSuperAdmin",
    args: {
      email,
      userId,
      serverSecret: secret,
    },
    format: "json",
  }),
});

const data = await res.json().catch(() => null);

if (data?.status === "success" && data.value) {
  console.log("Done.");
  console.log(`  userId: ${data.value.userId}`);
  console.log(`  adminId: ${data.value.adminId}`);
  console.log("");
  console.log("That account can now sign in to the platform console.");
  process.exit(0);
}

console.error("Bootstrap failed.");
console.error(data?.errorMessage ?? data ?? "Unknown error");
process.exit(1);
