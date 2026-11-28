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
import { loadMockData } from "./lib/mock-data.mjs";

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

// The demo data: a real catalogue for the trade, a month of sales recorded
// by the real sale engine, customers, suppliers, promotions and expenses.
try {
    const report = await loadMockData({
        businessId,
        token,
        serverSecret: secret,
        deployment: DEPLOYMENT,
        onBatch: (result, batch) => {
            console.log(`  batch ${batch}: ${result.salesWritten} sales written`);
        },
    });
    console.log(
        `demo data loaded: ${report.products} products, ${report.customers} customers, ${report.salesPlanned} sales`
    );
    for (const person of report.staff ?? []) {
        console.log(`${person.role}: ${person.email} / ${person.password}`);
    }
} catch (error) {
    console.error("seeding failed:", error.message);
    if (error.response) console.error(JSON.stringify(error.response).slice(0, 1200));
    process.exit(1);
}

console.log("\n--- sign in ---");
console.log(`email:    ${email}`);
console.log(`password: ${password}`);
