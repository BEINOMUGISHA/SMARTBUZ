/**
 * SMART_BUZ — load the development demo data.
 *
 *   node scripts/dev-mock-data.mjs
 *
 * Fills a development tenant with a month of realistic trading: a catalogue
 * of real products for the tenant's trade, customers, suppliers,
 * promotions, expenses and a month of sales that the **real sale engine**
 * recorded — so the numbers in the demo are the numbers the product would
 * have written itself.
 *
 * With no arguments it creates a fresh business and fills that. Give it an
 * account and it fills the business that account is in:
 *
 *   node scripts/dev-mock-data.mjs --email owner@business.invalid --password 'Password123!'
 *
 * Running it twice changes nothing the second time: every row is written
 * against a key of its own (a product code, a phone number, a transaction
 * id), so the seeder can be re-run without ever doubling the history.
 *
 * It refuses to run against anything but a *dev* Convex deployment. The
 * server-side mutation refuses as well — this is a development tool, and a
 * real business must never see made-up data.
 */
import { convex, ok, errText, ENV, signAccessToken } from "./lib/harness.mjs";
import { loadMockData } from "./lib/mock-data.mjs";

const DEPLOYMENT = String(ENV.CONVEX_DEPLOYMENT ?? "");
if (!DEPLOYMENT.startsWith("dev:")) {
    console.error(
        `Refusing to load demo data: CONVEX_DEPLOYMENT is "${DEPLOYMENT}", not a dev deployment.`
    );
    process.exit(1);
}

/* ── the arguments ─────────────────────────────────────────────────────── */

function readArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}

const args = readArgs(process.argv.slice(2));

const VERTICALS = [
    "retail",
    "supermarket",
    "wholesale",
    "pharmacy",
    "clinic",
    "restaurant",
    "cafe",
    "barber",
    "salon",
    "hotel",
    "hardware",
    "agro",
    "fuel",
    "mobile",
    "electronics",
    "bookshop",
    "printing",
    "baker",
    "butchery",
    "dairy",
    "salon_spa",
    "cleaning",
    "event",
    "photography",
    "realestate",
    "sacco",
    "construction",
];

const vertical = String(args.vertical ?? "retail");
if (!VERTICALS.includes(vertical)) {
    console.error(`Unknown vertical "${vertical}".`);
    console.error(`Choose one of: ${VERTICALS.join(", ")}`);
    process.exit(1);
}

const secret = ENV.SMARTBUZ_SERVER_SECRET ?? ENV.RESEND_API_KEY ?? ENV.SESSION_SECRET;

/* ── who is signing ────────────────────────────────────────────────────── */

let businessId = args.business ?? null;
let userId = null;
let email = args.email ?? null;
let password = args.password ?? null;
let businessName = null;

if (email && password) {
    const login = await convex("mutation", "users:login", { email, password });
    if (!ok(login)) {
        console.error("Could not sign in:", errText(login));
        process.exit(1);
    }
    userId = login.value._id;
    email = login.value.email;
    businessId = businessId ?? login.value.activeBusinessId ?? null;
    if (!businessId) {
        console.error(
            "That account is not in a business. Pass --business with the business id."
        );
        process.exit(1);
    }
    console.log(`signed in as ${email}`);
} else {
    // No account was given, so a fresh business is created and filled. The
    // credentials are printed at the end.
    const stamp = Date.now().toString(36);
    email = `owner.${stamp}@smartbuz.invalid`;
    password = "Password123!";
    businessName = `Harbour ${vertical[0].toUpperCase()}${vertical.slice(1)} ${stamp}`;

    const registered = await convex("mutation", "businesses:register", {
        businessName,
        ownerFirstName: "Amina",
        ownerLastName: "Nakato",
        ownerEmail: email,
        password,
        categoryId: vertical,
        currency: "UGX",
        timezone: "Africa/Kampala",
        country: "Uganda",
        businessAddress: "12 Plot 5, Kampala",
        businessPhone: "+256700000123",
    });
    if (!ok(registered)) {
        console.error("Could not create the business:", errText(registered));
        process.exit(1);
    }
    businessId = registered.value.businessId;
    userId = registered.value.userId;
    console.log(`business ${businessId}`);
    console.log(`user     ${userId}`);
}

const token = signAccessToken({
    userId,
    email,
    name: "Amina Nakato",
    ttlSeconds: 3600,
});

/* ── the loading ───────────────────────────────────────────────────────── */

let first;
try {
    first = await loadMockData({
        businessId,
        token,
        serverSecret: secret,
        deployment: DEPLOYMENT,
        onBatch: (report, batch) => {
            process.stdout.write(
                `  batch ${batch}: ${report.salesWritten} sales written (${report.salesPlanned} planned)\n`
            );
        },
    });
} catch (error) {
    console.error(error.message);
    if (error.response) console.error(JSON.stringify(error.response).slice(0, 1200));
    process.exit(1);
}

console.log("");
console.log("--- the demo tenant ---");
console.log(`business:  ${businessId}`);
console.log(`vertical:  ${vertical}`);
console.log(`products:  ${first.products}`);
console.log(`customers: ${first.customers}`);
console.log(`sales:     ${first.salesPlanned}`);
console.log(`from:      ${first.anchor}`);

if (first.staff && first.staff.length > 0) {
    console.log("");
    console.log("--- the staff accounts (passwords are shown once) ---");
    for (const person of first.staff) {
        console.log(`${person.role}: ${person.email} / ${person.password}`);
    }
}

console.log("");
console.log("--- sign in ---");
console.log(`email:    ${email}`);
console.log(`password: ${password}`);
