/**
 * SMART_BUZ — Live end-to-end verification of the vertical platform.
 * Exercises a restaurant profile across members, menu, floor, suppliers,
 * purchasing, till and service tickets against the deployed backend.
 */
const BASE = process.env.CONVEX_URL || "https://affable-panda-681.convex.cloud";

async function call(kind, path, args) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args, format: "json" }),
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { status: "unparsed", raw: text.slice(0, 400) };
      }
      if (body.status === "error") {
        const msg =
          body.errorMessage ||
          (Array.isArray(body.errorData) ? body.errorData.join("; ") : "") ||
          JSON.stringify(body).slice(0, 300);
        throw new Error(`${path}: ${msg}`);
      }
      return body.value;
    } catch (err) {
      // Retry only on transport failures, never on a validation error.
      if (/ValidationError|Server Error|errorMessage|is missing|extra field/.test(String(err.message))) {
        throw err;
      }
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const q = (path, args = {}) => call("query", path, args);
const m = (path, args = {}) => call("mutation", path, args);

const results = [];
function step(name, fn) {
  results.push({ name, status: "pending" });
}
function ok(name, detail = "") {
  const r = results.find((x) => x.name === name);
  if (r) {
    r.status = "PASS";
    r.detail = detail;
  }
  console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, err) {
  const r = results.find((x) => x.name === name);
  if (r) {
    r.status = "FAIL";
    r.detail = String(err.message ?? err);
  }
  console.log(`  FAIL  ${name} — ${err.message ?? err}`);
}

async function run(name, fn) {
  step(name);
  try {
    const detail = await fn();
    ok(name, detail ?? "");
    return true;
  } catch (err) {
    fail(name, err);
    return false;
  }
}

(async () => {
  const stamp = Date.now();
  const email = `e2e.${stamp}@example.com`;
  let userId, businessId;

  console.log(`\nSMART_BUZ vertical E2E — ${BASE}\n`);

  await run("register user", async () => {
    const reg = await m("users:register", {
      first_name: "E2E",
      last_name: "Owner",
      email,
      password: "e2e-password-123",
      phone_number: "0772000000",
      roles: ["admin"],
    });
    userId = reg?.userId ?? reg?._id ?? reg;
    if (typeof userId !== "string") throw new Error(`unexpected register response: ${JSON.stringify(reg)}`);
    return `id=${userId}`;
  });
  if (!userId) return finish();

  await run("create business profile (restaurant vertical)", async () => {
    businessId = await m("businessProfiles:create", {
      businessName: `E2E Bistro ${stamp}`,
      businessType: "restaurant",
      categoryId: "restaurant",
      industry: "Food & Beverage",
      modules: ["tables", "menu", "members", "suppliers", "purchase-orders", "till", "service-tickets"],
      currency: "UGX",
      country: "Uganda",
      taxEnabled: true,
      taxRate: 18,
      taxInclusive: true,
      taxNote: "VAT inclusive at 18%",
      businessPhone: "0772000000",
      createdBy: userId,
    });
    return `id=${businessId}`;
  });
  if (!businessId) return finish();

  await run("getActive profile resolves the vertical", async () => {
    const p = await q("businessProfiles:getActive", {});
    if (!p) throw new Error("no active profile");
    if (p.categoryId !== "restaurant") throw new Error(`wrong category: ${p.categoryId}`);
    if (p.taxRate !== 18) throw new Error(`wrong tax rate: ${p.taxRate}`);
    return `${p.businessName} / ${p.categoryId} / VAT ${p.taxRate}% inclusive=${p.taxInclusive}`;
  });

  let memberId;
  await run("create member (SACCO-style member number)", async () => {
    memberId = await m("verticals/members:createMember", {
      name: "Grace Nakato",
      phone: "0773111111",
      memberType: "savings",
      openingBalance: 50000,
      userId,
    });
    return `id=${memberId}`;
  });

  await run("member number auto-generated", async () => {
    const list = await q("verticals/members:listMembers", {});
    const g = list.find((x) => x._id === memberId);
    if (!g) throw new Error("member not returned by listMembers");
    if (!/^M-\d+$/.test(g.memberNumber)) throw new Error(`bad member number: ${g.memberNumber}`);
    return g.memberNumber;
  });

  await run("member transaction with over-draw protection", async () => {
    const tx = await m("verticals/members:recordMemberTransaction", {
      memberId,
      type: "deposit",
      amount: 25000,
      notes: "E2E deposit",
      userId,
    });
    if (!tx) throw new Error("no transaction returned");
    // Now try to over-draw beyond the balance; the server must refuse.
    let refused = false;
    try {
      await m("verticals/members:recordMemberTransaction", {
        memberId,
        type: "withdrawal",
        amount: 999999999,
        notes: "should be refused",
        userId,
      });
    } catch (e) {
      refused = true;
    }
    if (!refused) throw new Error("over-draw was NOT rejected");
    return "deposit accepted, overdraft refused";
  });

  let menuItemId;
  await run("create menu item", async () => {
    menuItemId = await m("verticals/scheduling:upsertMenuItem", {
      name: "Luwombo",
      category: "Mains",
      price: 12000,
      description: "E2E speciality",
      preparationMinutes: 25,
      dietary: ["Traditional"],
      userId,
    });
    return `id=${menuItemId}`;
  });

  await run("menu item is scoped to the active business", async () => {
    const menu = await q("verticals/scheduling:listMenu", {});
    const mine = menu.filter((m) => m._id === menuItemId);
    if (mine.length !== 1) throw new Error(`expected 1 menu item, got ${mine.length}`);
    if (mine[0].businessProfileId !== businessId)
      throw new Error("menu item not scoped to active business");
    return `${menu.length} item(s) on menu`;
  });

  await run("toggle menu availability", async () => {
    await m("verticals/scheduling:toggleMenuAvailability", { id: menuItemId, available: false });
    const menu = await q("verticals/scheduling:listMenu", {});
    const item = menu.find((x) => x._id === menuItemId);
    if (item.available !== false) throw new Error("availability was not toggled");
    await m("verticals/scheduling:toggleMenuAvailability", { id: menuItemId, available: true });
    return "sold out -> back on";
  });

  let outletId, orderId;
  await run("create table, open order, add items, close", async () => {
    outletId = await m("verticals/scheduling:createOutlet", {
      businessType: "table",
      name: "Table 5",
      capacity: 4,
      rate: 5000,
      userId,
    });
    orderId = await m("verticals/scheduling:openTableOrder", {
      outletId,
      customerName: "Walk-in Guest",
      userId,
    });
    const res = await m("verticals/scheduling:addTableOrderItems", {
      tableOrderId: orderId,
      items: [
        { name: "Luwombo", price: 12000, quantity: 2 },
        { name: "Mango Juice", price: 5000, quantity: 1 },
      ],
      userId,
    });
    if (res.total !== 29000) throw new Error(`wrong tab total: ${res.total}`);
    const closed = await m("verticals/scheduling:closeTableOrder", { tableOrderId: orderId, userId });
    if (closed !== 29000) throw new Error(`close returned ${closed}`);
    return "tab closed at UGX 29,000";
  });

  await run("double-booking guard on an occupied table", async () => {
    // Open a second order while the first is still open.
    const outlet2 = await m("verticals/scheduling:createOutlet", {
      businessType: "table",
      name: "Table 6",
      capacity: 2,
      userId,
    });
    await m("verticals/scheduling:openTableOrder", { outletId: outlet2, userId });
    let refused = false;
    try {
      await m("verticals/scheduling:openTableOrder", { outletId: outlet2, userId });
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("second open order on an occupied table was NOT rejected");
    return "second open rejected";
  });

  let supplierId;
  await run("create supplier", async () => {
    supplierId = await m("verticals/operations:upsertSupplier", {
      name: "Kampala Foods Ltd",
      contact: "Mr. Okello",
      phone: "0774555555",
      email: "orders@kampalafoods.test",
      paymentTerms: "Net 30",
      userId,
    });
    return `id=${supplierId}`;
  });

  let poId;
  await run("create purchase order", async () => {
    const res = await m("verticals/operations:createPurchaseOrder", {
      supplierId,
      supplierName: "Kampala Foods Ltd",
      items: [{ name: "Tomatoes", quantity: 20, unitCost: 3000 }],
      notes: "E2E PO",
      userId,
    });
    poId = res?.id ?? res;
    const po = await q("verticals/operations:listPurchaseOrders", {});
    const mine = po.find((x) => x._id === poId);
    if (!mine) throw new Error("PO not returned by listPurchaseOrders");
    if (mine.total !== 60000) throw new Error(`wrong PO total: ${mine.total}`);
    return `${mine.poNumber} total=UGX ${mine.total.toLocaleString()}`;
  });

  let stockId;
  await run("goods receipt raises stock and writes the stock ledger", async () => {
    const catId = await m("categories:add", { type: "E2E Vegetables", userId });
    const st = await m("stocks:add", {
      name: "Tomatoes (E2E)",
      productCode: `E2E-TOM-${stamp}`,
      price: 5000,
      purchasePrice: 3000,
      qty: 10,
      pv: 5000,
      bv: 3000,
      categoryId: catId,
      supplier: "Kampala Foods Ltd",
    });
    stockId = st?._id ?? st?.id ?? st;
    if (!stockId) throw new Error("no stock id returned");
    const before = await q("stocks:getStock", { id: stockId });
    if (!before) throw new Error("stock not found");
    const qtyBefore = before.qty;

    const res = await m("verticals/operations:receiveGoods", {
      poId,
      items: [{ stockId, name: "Tomatoes (E2E)", quantity: 20, unitCost: 3000 }],
      userId,
    });
    if (!res?.receiptNumber) throw new Error(`no receipt number: ${JSON.stringify(res)}`);

    const after = await q("stocks:getStock", { id: stockId });
    if (after.qty !== qtyBefore + 20)
      throw new Error(`stock not raised: ${qtyBefore} -> ${after.qty}`);

    // The audit called out missing stockLedger entries — assert one was written.
    const entries = await q("stocks:getStockEntries", {});
    const ledger = entries.filter((e) => e.stockId === stockId && e.type === "restock");
    if (ledger.length === 0) throw new Error("no restock entry written to the stock ledger");

    const receipts = await q("verticals/operations:listGoodsReceipts", {});
    if (!receipts.find((r) => r.receiptNumber === res.receiptNumber))
      throw new Error("goods receipt not listed");

    const po2 = await q("verticals/operations:listPurchaseOrders", {});
    const closed = po2.find((p) => p._id === poId);
    if (closed.status !== "received") throw new Error(`PO status is ${closed.status}`);

    return `${res.receiptNumber}: stock ${qtyBefore} -> ${after.qty}, ledger entry written`;
  });

  let tillId;
  await run("open till session", async () => {
    const res = await m("verticals/operations:openTillSession", {
      userId,
      userName: "E2E Owner",
      openingFloat: 100000,
      notes: "E2E till",
    });
    tillId = res?.id ?? res;
    const sessions = await q("verticals/operations:listTillSessions", {});
    const s = sessions.find((x) => x._id === tillId);
    if (!s) throw new Error("till session not returned");
    if (!s.sessionNumber.startsWith("TILL-")) throw new Error(`bad session number: ${s.sessionNumber}`);
    return s.sessionNumber;
  });

  await run("duplicate open till session is rejected", async () => {
    // Must run while the first session is still open.
    let refused = false;
    try {
      await m("verticals/operations:openTillSession", {
        userId,
        userName: "E2E Owner",
        openingFloat: 50000,
      });
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("second till session was NOT rejected");
    return "second session refused";
  });

  await run("till close computes the cash variance", async () => {
    const res = await m("verticals/operations:closeTillSession", {
      id: tillId,
      expectedCash: 100000,
      countedCash: 95000,
      notes: "short by 5k",
    });
    if (!res || typeof res.variance !== "number") throw new Error(`no variance returned: ${JSON.stringify(res)}`);
    if (res.variance !== -5000) throw new Error(`wrong variance: ${res.variance}`);
    return "variance = UGX -5,000";
  });

  let ticketId;
  await run("create service ticket", async () => {
    const res = await m("verticals/operations:createServiceTicket", {
      customerName: "Amos Byaruhanga",
      customerPhone: "0774666666",
      serviceType: "repair",
      description: "Printer not printing",
      priority: "normal",
      userId,
    });
    ticketId = res?.id ?? res;
    const tickets = await q("verticals/operations:listServiceTickets", {});
    if (!tickets.find((t) => t._id === ticketId)) throw new Error("ticket not returned");
    return `${res.ticketNumber} for ${res.id ? "customer" : "customer"}`;
  });

  await run("service ticket status advances", async () => {
    await m("verticals/operations:updateServiceTicket", {
      id: ticketId,
      status: "in_progress",
      notes: "Technician assigned",
    });
    const tickets = await q("verticals/operations:listServiceTickets", {});
    const t = tickets.find((x) => x._id === ticketId);
    if (t.status !== "in_progress") throw new Error(`status is ${t.status}`);
    return "received -> in_progress";
  });

  await run("donation recorded to the member ledger", async () => {
    const d = await m("verticals/members:recordDonation", {
      memberId,
      donorName: "Grace Nakato",
      type: "cash",
      amount: 10000,
      purpose: "E2E giving",
      userId,
    });
    if (!d) throw new Error("no donation returned");
    return "donation recorded";
  });

  await run("batch expiry summary is readable", async () => {
    const s = await q("verticals/batches:getExpirySummary", {});
    if (!s) throw new Error("no expiry summary");
    return JSON.stringify(s).slice(0, 120);
  });

  await run("schedule summary is readable", async () => {
    const s = await q("verticals/scheduling:getScheduleSummary", {});
    if (!s) throw new Error("no schedule summary");
    return JSON.stringify(s).slice(0, 120);
  });

  await run("client cannot set 0% VAT on a restaurant (server is authoritative)", async () => {
    await m("businessProfiles:setCategory", {
      id: businessId,
      categoryId: "restaurant",
      modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "systemconfig"],
      taxEnabled: false,
      taxRate: 0,
      taxInclusive: false,
      taxNote: "client tried to dodge VAT",
      updatedBy: userId,
    });
    const p = await q("businessProfiles:getActive", {});
    if (p.taxRate !== 18) throw new Error(`server accepted client taxRate 0 (stored ${p.taxRate})`);
    if (p.taxEnabled !== true) throw new Error("server accepted taxEnabled=false on a restaurant");
    if (p.taxInclusive !== true) throw new Error("server accepted taxInclusive=false on a restaurant");
    return "forced back to 18% inclusive";
  });

  await run("switching to an exempt vertical forces 0% VAT", async () => {
    await m("businessProfiles:setCategory", {
      id: businessId,
      categoryId: "clinic",
      modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "appointments", "prescriptions", "services", "systemconfig"],
      taxEnabled: true,
      taxRate: 18,
      taxInclusive: true,
      taxNote: "client tried to charge VAT on a clinic",
      updatedBy: userId,
    });
    const p = await q("businessProfiles:getActive", {});
    if (p.categoryId !== "clinic") throw new Error(`category did not switch: ${p.categoryId}`);
    if (p.taxRate !== 0) throw new Error(`clinic taxRate should be 0, got ${p.taxRate}`);
    if (!/exempt/i.test(p.taxNote ?? "")) throw new Error(`wrong exempt note: ${p.taxNote}`);
    if (!p.modules.includes("prescriptions"))
      throw new Error("clinic modules missing prescriptions");
    return `clinic: tax=${p.taxRate}% (${p.taxNote})`;
  });

  await run("switching back to restaurant restores 18% VAT", async () => {
    await m("businessProfiles:setCategory", {
      id: businessId,
      categoryId: "restaurant",
      modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "systemconfig"],
      taxEnabled: true,
      taxRate: 0,
      taxInclusive: true,
      updatedBy: userId,
    });
    const p = await q("businessProfiles:getActive", {});
    if (p.taxRate !== 18) throw new Error(`restaurant taxRate should be 18, got ${p.taxRate}`);
    return "restaurant back to 18%";
  });

  finish();

  function finish() {
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    console.log(`\n────────────────────────────────────────────`);
    console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`);
    console.log(`────────────────────────────────────────────\n`);
    if (failed) {
      for (const r of results.filter((x) => x.status === "FAIL")) {
        console.log(`  ! ${r.name}: ${r.detail}`);
      }
    }
    process.exit(failed ? 1 : 0);
  }
})();
