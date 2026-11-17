/**
 * SMART_BUZ — error-shape probe.
 *
 * Prints the raw HTTP responses for the calls the isolation suite makes, so
 * the exact error shape can be asserted on.
 */
import { convex, signAccessToken, SITE_URL } from "./lib/harness.mjs";

const stamp = Date.now().toString(36);
const email = `probe.owner.${stamp}@smartbuz.test`;

const reg = await convex("mutation", "businesses:register", {
  businessName: `Probe ${stamp}`,
  ownerFirstName: "Probe",
  ownerLastName: "Owner",
  ownerEmail: email,
  password: "Password123!",
});
console.log("register:", JSON.stringify(reg).slice(0, 200));

const login = await convex("mutation", "users:login", { email, password: "Password123!" });
const user = login.value;
const token = signAccessToken({ userId: user._id, email: user.email, issuer: SITE_URL });

const cases = [
  ["query", "stocks:listAll", {}, token],
  ["query", "stocks:listAll", {}, null],
  ["mutation", "businesses:switchBusiness", { businessId: reg.value.businessId }, null],
  ["query", "businesses:getActive", {}, token],
];

for (const [kind, path, args, tok] of cases) {
  const res = await convex(kind, path, args, tok);
  console.log(`\n${path} (${tok ? "authenticated" : "anonymous"}):`);
  console.log(JSON.stringify(res, null, 2).slice(0, 700));
}
