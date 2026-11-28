/**
 * SMART_BUZ — development tenant provisioning.
 *
 *   node scripts/dev-provision.mjs
 *
 * Creates one business on the dev deployment, seeds it with the demo data the
 * product ships, and prints the credentials so a person can sign in and look
 * at a database that behaves like a real one.
 *
 * This only ever talks to a *dev* Convex deployment, and it refuses to run
 * against a production one.
 */
import { convex, ok, errText, ENV, signAccessToken } from "./lib/harness.mjs";

const DEPLOYMENT = String(ENV.CONVEX_DEPLOYMENT ?? "");
if (!DEPLOYMENT.startsWith("dev:")) {
    console.error(`Refusing to provision: CONVEX_DEPLOYMENT is "${DEPLOYMENT}", not a dev deployment.`);
    process.exit(1);
}

const stamp = Date.now().toString(36);
const email = `owner.${stamp}@smartbuz.invalid`;
const password = "Password123!";

const reg = await convex("mutation", "businesses:register", {
    businessName: `Harbour Retail ${stamp}`,
    ownerFirstName: "Amina",
    ownerLastName: "Nakato",
    ownerEmail: email,
    password,
    categoryId: "retail",
    currency: "UGX",
    timezone: "Africa/Kampala",
    country: "Uganda",
    businessAddress: "12 Plot 5, Kampala",
    businessPhone: "+256700000123",
});
if (!ok(reg)) {
    console.error("Could not create the business:", errText(reg));
    process.exit(1);
}
const { businessId, userId } = reg.value;
console.log(`business ${businessId}`);
console.log(`user     ${userId}`);

const token = signAccessToken({
    userId,
    email,
    name: "Amina Nakato",
    ttlSeconds: 3600,
});

const secret = ENV.SMARTBUZ_SERVER_SECRET ?? ENV.RESEND_API_KEY ?? ENV.SESSION_SECRET;

for (const [label, path] of [
    ["seed", "seed:seedEverything"],
]) {
    const res = await convex("mutation", path, { businessId, serverSecret: secret }, token);
    if (!ok(res)) {
        console.error(`${label} failed:`, errText(res));
        console.error(JSON.stringify(res).slice(0, 1200));
        process.exit(1);
    }
    console.log(`${label} ok:`, JSON.stringify(res.value).slice(0, 300));
}

console.log("\n--- sign in ---");
console.log(`email:    ${email}`);
console.log(`password: ${password}`);
