/**
 * SMART_BUZ — raw-response probe for the cross-tenant `sales:getSale` read.
 *
 * Reproduces the one failing isolation assertion and prints the *unmodified*
 * HTTP payload so the error shape can be inspected.
 */
import { convex, signAccessToken, SITE_URL, CONVEX_URL } from "./lib/harness.mjs";

const stamp = Date.now().toString(36);
const emailA = `probe.a.${stamp}@smartbuz.test`;
const emailB = `probe.b.${stamp}@smartbuz.test`;

async function register(businessName, email) {
  const res = await convex("mutation", "businesses:register", {
    businessName,
    ownerFirstName: "Probe",
    ownerLastName: "Owner",
    ownerEmail: email,
    password: "Password123!",
  });
  if (res.status !== "success") throw new Error(`register failed: ${JSON.stringify(res)}`);
  return res.value;
}

async function sessionFor(email) {
  const res = await convex("mutation", "users:login", { email, password: "Password123!" });
  if (res.status !== "success") throw new Error(`login failed: ${JSON.stringify(res)}`);
  const user = res.value;
  return {
    user,
    token: signAccessToken({ userId: user._id, email: user.email, issuer: SITE_URL }),
  };
}

const a = await register(`Probe A ${stamp}`, emailA);
const b = await register(`Probe B ${stamp}`, emailB);
const sessionA = await sessionFor(emailA);
const sessionB = await sessionFor(emailB);
const tokenA = sessionA.token;
const tokenB = sessionB.token;

const catA = await convex(
  "mutation",
  "categories:add",
  { type: `Probe Cat ${stamp}`, userId: sessionA.user._id },
  tokenA
);
console.log("cat:", JSON.stringify(catA));
const stockA = await convex(
  "mutation",
  "stocks:add",
  {
    name: "Probe Product",
    productCode: `PROBE-${stamp}`,
    price: 1000,
    purchasePrice: 500,
    qty: 10,
    pv: 1,
    bv: 1,
    categoryId: catA.value,
  },
  tokenA
);
console.log("stock:", JSON.stringify(stockA));
const saleA = await convex(
  "mutation",
  "sales:create",
  {
    userId: sessionA.user._id,
    total: 1000,
    clientType: "Retail",
    paymentMode: "Cash",
    items: [
      {
        stockId: stockA.value,
        name: "Probe Product",
        productCode: `PROBE-${stamp}`,
        price: 1000,
        quantity: 1,
        pv: 1,
        bv: 1,
      },
    ],
  },
  tokenA
);
console.log("sale:", JSON.stringify(saleA));

const url = `${CONVEX_URL}/api/query`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
  body: JSON.stringify({
    path: "sales:getSale",
    args: { id: saleA.value.saleId },
    format: "json",
  }),
});
console.log("HTTP status:", res.status);
const text = await res.text();
console.log("RAW BODY:\n" + text.slice(0, 3000));

console.log("\n--- with businessId of A ---");
const res2 = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
  body: JSON.stringify({
    path: "sales:getSale",
    args: { id: saleA.value.saleId, businessId: a.businessId },
    format: "json",
  }),
});
console.log("HTTP status:", res2.status);
console.log("RAW BODY:\n" + (await res2.text()).slice(0, 3000));

console.log("\n--- owner of A reads own sale (control) ---");
const res3 = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
  body: JSON.stringify({
    path: "sales:getSale",
    args: { id: saleA.value.saleId },
    format: "json",
  }),
});
console.log("HTTP status:", res3.status);
console.log("RAW BODY:\n" + (await res3.text()).slice(0, 600));
