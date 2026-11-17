/**
 * SMART_BUZ — tenant isolation test suite.
 *
 *   node scripts/tenant-isolation-e2e.mjs
 *
 * Proves the multi-tenant acceptance criteria against a live deployment:
 *
 *   • Two businesses can register independently.
 *   • Each business can create its own employees.
 *   • Each business has independent products and sales.
 *   • Business A cannot access Business B's data — by list, by id, or by
 *     tampering with the business id the browser sends.
 *   • Users can switch between businesses only when authorised.
 *   • Anonymous callers get nothing.
 *
 * Every run uses throw-away accounts and leaves the deployment as it found
 * it, apart from the demo records it creates.
 */
import {
  convex,
  ok,
  errText,
  signAccessToken,
  createRunner,
  SITE_URL,
} from "./lib/harness.mjs";

const { check, summary } = createRunner("SMART_BUZ tenant isolation");

const stamp = Date.now().toString(36);
const A = {
  businessName: `Isolation Test A ${stamp}`,
  ownerFirstName: "Alpha",
  ownerLastName: "Owner",
  ownerEmail: `alpha.owner.${stamp}@smartbuz.test`,
  password: "Password123!",
  currency: "UGX",
  timezone: "Africa/Kampala",
  country: "Uganda",
};
const B = {
  businessName: `Isolation Test B ${stamp}`,
  ownerFirstName: "Beta",
  ownerLastName: "Owner",
  ownerEmail: `beta.owner.${stamp}@smartbuz.test`,
  password: "Password123!",
  currency: "USD",
  timezone: "Europe/London",
  country: "United Kingdom",
};

async function login(email, password) {
  const res = await convex("mutation", "users:login", { email, password });
  if (!ok(res)) throw new Error(`login failed for ${email}: ${errText(res)}`);
  return res.value;
}

function tokenFor(user) {
  return signAccessToken({ userId: user._id, email: user.email, issuer: SITE_URL });
}

(async () => {
  /* ────────────────────────────────────────────────────────────────
   * 1. Two businesses register independently
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nRegistration");
  const regA = await convex("mutation", "businesses:register", A);
  const regB = await convex("mutation", "businesses:register", B);
  check("business A registers", ok(regA), errText(regA));
  check("business B registers", ok(regB), errText(regB));
  if (!ok(regA) || !ok(regB)) {
    process.exit(summary() ? 0 : 1);
  }

  const businessA = regA.value.businessId;
  const businessB = regB.value.businessId;
  check("A and B are different businesses", businessA !== businessB);

  const ownerA = await login(A.ownerEmail, A.password);
  const ownerB = await login(B.ownerEmail, B.password);
  const tokenA = tokenFor(ownerA);
  const tokenB = tokenFor(ownerB);

  /* ────────────────────────────────────────────────────────────────
   * 2. Each business has independent products, customers and sales
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nOwn data");

  const catA = await convex(
    "mutation",
    "categories:add",
    { type: "Isolation Category A", userId: ownerA._id },
    tokenA
  );
  check("A creates a category", ok(catA), errText(catA));

  const catB = await convex(
    "mutation",
    "categories:add",
    { type: "Isolation Category B", userId: ownerB._id },
    tokenB
  );
  check("B creates its own category", ok(catB), errText(catB));

  const stockA = await convex(
    "mutation",
    "stocks:add",
    {
      name: "Alpha Product",
      productCode: `ALPHA-${stamp}`,
      price: 1000,
      purchasePrice: 500,
      qty: 25,
      pv: 1,
      bv: 1,
      categoryId: catA.value,
    },
    tokenA
  );
  check("A creates a product", ok(stockA), errText(stockA));

  const stockB = await convex(
    "mutation",
    "stocks:add",
    {
      name: "Beta Product",
      productCode: `BETA-${stamp}`,
      price: 2000,
      purchasePrice: 900,
      qty: 40,
      pv: 2,
      bv: 2,
      categoryId: catB.value,
    },
    tokenB
  );
  check("B creates a product", ok(stockB), errText(stockB));

  const customerA = await convex(
    "mutation",
    "customers:add",
    { name: "Alpha Customer", phone: `07000${stamp.slice(-4)}`, userId: ownerA._id },
    tokenA
  );
  check("A creates a customer", ok(customerA), errText(customerA));

  const saleA = await convex(
    "mutation",
    "sales:create",
    {
      userId: ownerA._id,
      total: 3000,
      clientType: "Retail",
      paymentMode: "Cash",
      customerId: customerA.value,
      items: [
        {
          stockId: stockA.value,
          name: "Alpha Product",
          productCode: `ALPHA-${stamp}`,
          price: 1000,
          quantity: 3,
          pv: 1,
          bv: 1,
        },
      ],
    },
    tokenA
  );
  check("A creates a sale", ok(saleA), errText(saleA));
  // `sales:create` answers with { saleId, invoiceNumber, redemptions }.
  const saleIdA = saleA.value.saleId;

  const employeeA = await convex(
    "mutation",
    "employees:create",
    { fullName: "Alpha Employee", jobTitle: "Cashier", role: "cashier" },
    tokenA
  );
  check("A creates an employee", ok(employeeA), errText(employeeA));

  /* ────────────────────────────────────────────────────────────────
   * 3. Isolation: lists
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nIsolation — lists");
  const bProducts = await convex("query", "stocks:listAll", {}, tokenB);
  const bProductsSeen = ok(bProducts)
    ? bProducts.value.map((s) => s._id)
    : [];
  check("B cannot see A's products", !bProductsSeen.includes(stockA.value));
  check("B sees its own product", bProductsSeen.includes(stockB.value));

  const aProducts = await convex("query", "stocks:listAll", {}, tokenA);
  const aProductsSeen = ok(aProducts)
    ? aProducts.value.map((s) => s._id)
    : [];
  check("A cannot see B's products", !aProductsSeen.includes(stockB.value));
  check("A sees its own product", aProductsSeen.includes(stockA.value));

  const bSales = await convex(
    "query",
    "sales:list",
    { paginationOpts: { numItems: 50, cursor: null } },
    tokenB
  );
  const bSalesSeen = ok(bSales) ? bSales.value.page.map((s) => s._id) : [];
  check("B cannot see A's sales", !bSalesSeen.includes(saleIdA));

  const bCustomers = await convex("query", "customers:listAll", {}, tokenB);
  const bCustomersSeen = ok(bCustomers) ? bCustomers.value.map((c) => c._id) : [];
  check("B cannot see A's customers", !bCustomersSeen.includes(customerA.value));

  const bEmployees = await convex("query", "employees:list", {}, tokenB);
  const bEmployeesSeen = ok(bEmployees) ? bEmployees.value.map((e) => e._id) : [];
  check("B cannot see A's employees", !bEmployeesSeen.includes(employeeA.value));

  const aEmployees = await convex("query", "employees:list", {}, tokenA);
  const aEmployeesSeen = ok(aEmployees) ? aEmployees.value.map((e) => e._id) : [];
  check("A sees its own employee", aEmployeesSeen.includes(employeeA.value));

  /* ────────────────────────────────────────────────────────────────
   * 4. Isolation: documents reached by id
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nIsolation — direct access");
  const bReadsSale = await convex("query", "sales:getSale", { id: saleIdA }, tokenB);
  check(
    "B cannot read A's sale by id",
    !ok(bReadsSale) && /forbidden/i.test(errText(bReadsSale)),
    errText(bReadsSale)
  );

  const bReadsStock = await convex("query", "stocks:getStock", { id: stockA.value }, tokenB);
  check(
    "B cannot read A's product by id",
    !ok(bReadsStock) && /forbidden/i.test(errText(bReadsStock)),
    errText(bReadsStock)
  );

  // Control: the very same call succeeds for the owning business, so the
  // denial above is a tenant decision and not a broken id or a dead query.
  const aReadsSale = await convex("query", "sales:getSale", { id: saleIdA }, tokenA);
  check(
    "A can read its own sale by id",
    ok(aReadsSale) && aReadsSale.value._id === saleIdA,
    ok(aReadsSale) ? "read ok" : errText(aReadsSale)
  );

  const bReadsCustomer = await convex(
    "query",
    "customers:listAll",
    {},
    tokenB
  );
  check(
    "A's customer is absent from B's customer book",
    ok(bReadsCustomer) && !bReadsCustomer.value.some((c) => c._id === customerA.value)
  );

  const bSellsAProduct = await convex(
    "mutation",
    "sales:create",
    {
      userId: ownerB._id,
      total: 1000,
      clientType: "Retail",
      paymentMode: "Cash",
      items: [
        {
          stockId: stockA.value,
          name: "Alpha Product",
          productCode: `ALPHA-${stamp}`,
          price: 1000,
          quantity: 1,
          pv: 1,
          bv: 1,
        },
      ],
    },
    tokenB
  );
  check(
    "B cannot sell A's product",
    !ok(bSellsAProduct) && /forbidden/i.test(errText(bSellsAProduct)),
    errText(bSellsAProduct)
  );

  /* ────────────────────────────────────────────────────────────────
   * 5. Tampering with the business id the browser sends
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nIsolation — tampered business id");
  const bAsksForA = await convex(
    "query",
    "stocks:listAll",
    { businessId: businessA },
    tokenB
  );
  check(
    "B cannot read A by passing A's business id",
    !ok(bAsksForA) && /forbidden/i.test(errText(bAsksForA)),
    errText(bAsksForA)
  );

  const bSwitchesIntoA = await convex(
    "mutation",
    "businesses:switchBusiness",
    { businessId: businessA },
    tokenB
  );
  check(
    "B cannot switch into A",
    !ok(bSwitchesIntoA) && /forbidden/i.test(errText(bSwitchesIntoA)),
    errText(bSwitchesIntoA)
  );

  /* ────────────────────────────────────────────────────────────────
   * 6. Anonymous callers get nothing
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nIsolation — anonymous");
  const anonProducts = await convex("query", "stocks:listAll", {});
  check(
    "an anonymous caller cannot list products",
    !ok(anonProducts) && /unauthorized/i.test(errText(anonProducts)),
    errText(anonProducts)
  );
  const anonSales = await convex(
    "query",
    "sales:list",
    { paginationOpts: { numItems: 10, cursor: null } },
  );
  check(
    "an anonymous caller cannot list sales",
    !ok(anonSales) && /unauthorized/i.test(errText(anonSales)),
    errText(anonSales)
  );

  /* ────────────────────────────────────────────────────────────────
   * 7. Switching between businesses you belong to
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nBusiness switching");
  const addMember = await convex(
    "mutation",
    "businesses:addMember",
    {
      businessId: businessB,
      email: A.ownerEmail,
      role: "manager",
      firstName: A.ownerFirstName,
      lastName: A.ownerLastName,
    },
    tokenB
  );
  check("B adds A's owner as a manager", ok(addMember), errText(addMember));

  const switchToB = await convex(
    "mutation",
    "businesses:switchBusiness",
    { businessId: businessB },
    tokenA
  );
  check("A can switch into a business it belongs to", ok(switchToB), errText(switchToB));

  const afterSwitch = await convex("query", "stocks:listAll", {}, tokenA);
  const afterSwitchSeen = ok(afterSwitch) ? afterSwitch.value.map((s) => s._id) : [];
  check(
    "after switching, A sees the new business's products",
    afterSwitchSeen.includes(stockB.value),
    `${afterSwitchSeen.length} product(s) visible`
  );
  check(
    "after switching, A no longer sees the old business's products",
    !afterSwitchSeen.includes(stockA.value)
  );

  const switchBack = await convex(
    "mutation",
    "businesses:switchBusiness",
    { businessId: businessA },
    tokenA
  );
  check("A can switch back", ok(switchBack), errText(switchBack));

  /* ────────────────────────────────────────────────────────────────
   * 8. A business the user does not belong to is unreachable
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nUnauthorised switching");
  const regC = await convex("mutation", "businesses:register", {
    businessName: `Isolation Test C ${stamp}`,
    ownerFirstName: "Gamma",
    ownerLastName: "Owner",
    ownerEmail: `gamma.owner.${stamp}@smartbuz.test`,
    password: "Password123!",
  });
  check("a third business registers", ok(regC), errText(regC));

  const switchToC = await convex(
    "mutation",
    "businesses:switchBusiness",
    { businessId: regC.value.businessId },
    tokenA
  );
  check(
    "A cannot switch into a business it does not belong to",
    !ok(switchToC) && /forbidden/i.test(errText(switchToC)),
    errText(switchToC)
  );

  /* ────────────────────────────────────────────────────────────────
   * 9. Business settings are per business
   * ──────────────────────────────────────────────────────────────── */
  console.log("\nBusiness settings");
  const activeA = await convex("query", "businesses:getActive", {}, tokenA);
  check(
    "A's active business is A",
    ok(activeA) && activeA.value._id === businessA,
    ok(activeA) ? activeA.value._id : errText(activeA)
  );
  check(
    "A's currency is its own",
    ok(activeA) && activeA.value.currency === "UGX",
    ok(activeA) ? activeA.value.currency : ""
  );

  const activeB = await convex("query", "businesses:getActive", {}, tokenB);
  check(
    "B's currency is its own",
    ok(activeB) && activeB.value.currency === "USD",
    ok(activeB) ? activeB.value.currency : ""
  );

  const bSettings = await convex(
    "mutation",
    "businesses:updateSettings",
    { businessId: businessA, currency: "EUR" },
    tokenB
  );
  check(
    "B cannot change A's settings",
    !ok(bSettings) && /forbidden/i.test(errText(bSettings)),
    errText(bSettings)
  );

  process.exit(summary() ? 0 : 1);
})().catch((err) => {
  console.error(`\nTest run failed: ${err.message}`);
  process.exit(1);
});
