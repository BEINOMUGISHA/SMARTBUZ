/**
 * SMARTBUZ — test harness.
 *
 * A small in-memory stand-in for the Convex context, so the permission
 * guards can be tested against the *real* functions in `convex/tenancy.ts`
 * rather than a re-implementation of them.
 *
 * It implements only what the guards actually use:
 *
 *   ctx.auth.getUserIdentity()
 *   ctx.db.get(id)
 *   ctx.db.query(table).withIndex(name, builder).unique() / .first() / .collect()
 *   ctx.db.query(table).filter(builder).collect()
 *   ctx.db.insert(table, doc)
 *   ctx.db.patch(id, fields)
 *   ctx.db.delete(id)
 *
 * The index builder is recorded as a list of equality conditions and
 * applied to the rows, which is exactly what Convex's `by_businessId_userId`
 * style indexes do. The same is true of `.filter()`, which supports the
 * comparison operators the business modules use.
 */

export interface FakeRow {
  _id: string;
  _creationTime?: number;
  [key: string]: unknown;
}

export interface FakeCtxOptions {
  /** The signed-in caller. `null` means anonymous. */
  identity?: Record<string, unknown> | null;
  users?: FakeRow[];
  businesses?: FakeRow[];
  memberships?: FakeRow[];
  branches?: FakeRow[];
  sessions?: FakeRow[];
  platformAdmins?: FakeRow[];
  customRolePermissions?: FakeRow[];
  memberPermissionOverrides?: FakeRow[];
  emailVerifications?: FakeRow[];
  passwordResets?: FakeRow[];
  auditLogs?: FakeRow[];
  activityLogs?: FakeRow[];
  employees?: FakeRow[];
  stocks?: FakeRow[];
  categories?: FakeRow[];
  shopIssueRecords?: FakeRow[];
  sales?: FakeRow[];
  shops?: FakeRow[];
  /* ── Phase 4: customers, suppliers, purchasing ────────────────────── */
  customers?: FakeRow[];
  loans?: FakeRow[];
  payments?: FakeRow[];
  loyaltyTransactions?: FakeRow[];
  suppliers?: FakeRow[];
  supplierLedger?: FakeRow[];
  supplierInvoices?: FakeRow[];
  purchasePayments?: FakeRow[];
  purchaseReturns?: FakeRow[];
  stockCostHistory?: FakeRow[];
  purchaseOrders?: FakeRow[];
  goodsReceipts?: FakeRow[];
  stockLedger?: FakeRow[];
  stockEntries?: FakeRow[];
  counters?: FakeRow[];
  warehouses?: FakeRow[];
  /* ── Phase 5: finance ─────────────────────────────────────────────── */
  cashShifts?: FakeRow[];
  cashMovements?: FakeRow[];
  incomeRecords?: FakeRow[];
  reconciliations?: FakeRow[];
  /* ── Phase 6: licensing and subscriptions ─────────────────────────── */
  plans?: FakeRow[];
  subscriptions?: FakeRow[];
  subscriptionEvents?: FakeRow[];
  subscriptionPayments?: FakeRow[];
  licenseKeys?: FakeRow[];
  devices?: FakeRow[];
}

const TABLES = [
  "users",
  "businesses",
  "memberships",
  "branches",
  "sessions",
  "platformAdmins",
  "customRolePermissions",
  "memberPermissionOverrides",
  "emailVerifications",
  "passwordResets",
  "auditLogs",
  "activityLogs",
  "employees",
  "stocks",
  "sales",
  "shops",
  /** The catalogue's categories — read by the sale and by the inventory. */
  "categories",
  /** The counter's own issue history. */
  "shopIssueRecords",
  /** Promotions — read by the sale, so a sale cannot be made without them. */
  "promotions",
  "promotionProducts",
  "promotionRedemptions",
  "expenses",
  // Phase 4
  "customers",
  "loans",
  "payments",
  "loyaltyTransactions",
  "suppliers",
  "supplierLedger",
  "supplierInvoices",
  "purchasePayments",
  "purchaseReturns",
  "stockCostHistory",
  "purchaseOrders",
  "goodsReceipts",
  "stockLedger",
  "stockEntries",
  "counters",
  "warehouses",
  // Phase 5
  "cashShifts",
  "cashMovements",
  "incomeRecords",
  "reconciliations",
  // Phase 6
  "plans",
  "subscriptions",
  "subscriptionEvents",
  "subscriptionPayments",
  "licenseKeys",
  "devices",
  // Phase 7
  "syncLogs",
  "stockConflicts",
  // The payment lifecycle. A collection that has been started but not yet
  // confirmed by the provider is an intent, and the automatic repair looks
  // at the intents that are still waiting.
  "paymentIntents",
  "integrationEvents",
  // The throttle tables. The sign-in throttle and the email throttle keep
  // their state in the database so that every instance of the server
  // shares the limit and a deploy does not reset it.
  "loginAttempts",
  "emailThrottle",
] as const;

type TableName = (typeof TABLES)[number];

/* ────────────────────────────────────────────────────────────────────────
 * Condition builders
 * ──────────────────────────────────────────────────────────────────────── */

/** A reference to a document field, as `q.field("name")` produces. */
interface FieldRef {
  __fieldName: string;
}

type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

interface Condition {
  op: Operator;
  field: string;
  value: unknown;
}

/**
 * The builder Convex hands to `withIndex()` and `filter()`.
 *
 * It records conditions instead of touching a database, which is all the
 * fake context needs to reproduce Convex's filtering semantics.
 */
class ConditionBuilder {
  constructor(private readonly conditions: Condition[]) {}

  field(name: string): FieldRef {
    return { __fieldName: name };
  }

  private resolve(field: string | FieldRef): string {
    return typeof field === "string" ? field : field.__fieldName;
  }

  eq(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "eq", field: this.resolve(field), value });
    return this;
  }

  neq(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "neq", field: this.resolve(field), value });
    return this;
  }

  gt(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "gt", field: this.resolve(field), value });
    return this;
  }

  gte(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "gte", field: this.resolve(field), value });
    return this;
  }

  lt(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "lt", field: this.resolve(field), value });
    return this;
  }

  lte(field: string | FieldRef, value: unknown): this {
    this.conditions.push({ op: "lte", field: this.resolve(field), value });
    return this;
  }
}

function conditionHolds(row: FakeRow, condition: Condition): boolean {
  const actual = row[condition.field];
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
      return (actual as number) > (condition.value as number);
    case "gte":
      return (actual as number) >= (condition.value as number);
    case "lt":
      return (actual as number) < (condition.value as number);
    case "lte":
      return (actual as number) <= (condition.value as number);
  }
}

/** A Convex-shaped context backed by plain arrays. */
export class FakeContext {
  readonly db: {
    get: (id: string) => Promise<FakeRow | null>;
    query: (table: TableName) => FakeQuery;
    insert: (table: TableName, doc: Record<string, unknown>) => Promise<string>;
    patch: (id: string, fields: Record<string, unknown>) => Promise<void>;
    replace: (
        tableOrId: string,
        idOrDoc: string | Record<string, unknown>,
        maybeDoc?: Record<string, unknown>
    ) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };

  readonly auth: {
    getUserIdentity: () => Promise<Record<string, unknown> | null>;
  };

  readonly tables: Record<TableName, FakeRow[]>;
  private counter = 0;

  constructor(options: FakeCtxOptions = {}) {
    const tables = {} as Record<TableName, FakeRow[]>;
    for (const table of TABLES) {
      tables[table] = [...((options as Record<string, FakeRow[]>)[table] ?? [])];
    }
    this.tables = tables;

    this.db = {
      get: async (id: string) => {
        for (const table of TABLES) {
          const row = tables[table].find((r) => r._id === id);
          if (row) return row;
        }
        return null;
      },

      query: (table: TableName) => new FakeQuery(tables[table]),

      insert: async (table: TableName, doc: Record<string, unknown>) => {
        this.counter += 1;
        // A distinct prefix so an inserted row can never collide with a
        // hand-seeded id such as "users_1".
        const id = `${table}_new_${this.counter}`;
        tables[table].push({ ...doc, _id: id, _creationTime: Date.now() });
        return id;
      },

      patch: async (id: string, fields: Record<string, unknown>) => {
        for (const table of TABLES) {
          const row = tables[table].find((r) => r._id === id);
          if (row) {
            Object.assign(row, fields);
            return;
          }
        }
      },

      /**
       * Replace a document outright: every field but the system fields is
       * replaced by what is given, and a field that is not given is gone.
       *
       * The real Convex `replace` does exactly this, and the difference
       * matters when a row's *references* are being rewritten: a patch
       * would leave a stale reference behind if the new document did not
       * mention it.
       *
       * Both of Convex's shapes are accepted: `replace(table, id, doc)`
       * and the older `replace(id, doc)`.
       */
      replace: async (
        tableOrId: string,
        idOrDoc: string | Record<string, unknown>,
        maybeDoc?: Record<string, unknown>
      ) => {
        const id = typeof idOrDoc === "string" ? idOrDoc : tableOrId;
        const doc = typeof idOrDoc === "string" ? maybeDoc : idOrDoc;
        if (!doc) return;

        for (const table of TABLES) {
          const index = tables[table].findIndex((r) => r._id === id);
          if (index >= 0) {
            const { _id, _creationTime, ...rest } = doc;
            void _id;
            void _creationTime;
            tables[table][index] = {
              ...rest,
              _id: id,
              _creationTime: tables[table][index]._creationTime,
            };
            return;
          }
        }
      },

      delete: async (id: string) => {
        for (const table of TABLES) {
          const index = tables[table].findIndex((r) => r._id === id);
          if (index >= 0) {
            tables[table].splice(index, 1);
            return;
          }
        }
      },
    };

    this.auth = {
      getUserIdentity: async () => options.identity ?? null,
    };
  }
}

class FakeQuery {
  private indexConditions: Condition[] = [];
  private filterConditions: Condition[] = [];
  private sortDirection: "asc" | "desc" = "asc";
  private sortField?: string;
  private limitCount?: number;
  private searchTerm?: string;

  constructor(private readonly rows: FakeRow[]) {}

  withIndex(_name: string, builder: (q: ConditionBuilder) => unknown): FakeQuery {
    const conditions: Condition[] = [];
    builder(new ConditionBuilder(conditions));
    this.indexConditions = conditions;
    return this;
  }

  filter(builder: (q: ConditionBuilder) => unknown): FakeQuery {
    const conditions: Condition[] = [];
    builder(new ConditionBuilder(conditions));
    // Filters accumulate, the way the server's do: two filters are a
    // narrower query, not a replacement of the first one.
    this.filterConditions = [...this.filterConditions, ...conditions];
    return this;
  }

  /**
   * Order the rows.
   *
   * `order("desc")` on an index that is already in date order reverses it,
   * which is what the server does. `order("asc")` leaves it alone.
   */
  order(direction: "asc" | "desc"): FakeQuery {
    this.sortDirection = direction;
    return this;
  }

  /**
   * Take at most `count` rows.
   *
   * The server's `take` resolves to the rows themselves, so this does too.
   */
  async take(count: number): Promise<FakeRow[]> {
    this.limitCount = count;
    return this.matches();
  }

  private matches(): FakeRow[] {
    let matched = this.rows.filter(
      (row) =>
        this.indexConditions.every((c) => conditionHolds(row, c)) &&
        this.filterConditions.every((c) => conditionHolds(row, c))
    );

    // A search index covers the name and the product code.
    if (this.searchTerm) {
      const term = this.searchTerm;
      matched = matched.filter(
        (row) =>
          String(row.name ?? "").toLowerCase().includes(term) ||
          String(row.productCode ?? "").toLowerCase().includes(term)
      );
    }

    // An index is in ascending order, so "desc" reverses it.
    if (this.sortDirection === "desc") {
      matched = [...matched].reverse();
    }

    if (this.limitCount !== undefined) {
      matched = matched.slice(0, this.limitCount);
    }

    return matched;
  }

  async unique(): Promise<FakeRow | null> {
    const matches = this.matches();
    return matches.length > 0 ? matches[0] : null;
  }

  async first(): Promise<FakeRow | null> {
    const matches = this.matches();
    return matches.length > 0 ? matches[0] : null;
  }

  async collect(): Promise<FakeRow[]> {
    return this.matches();
  }

  /**
   * A page of rows.
   *
   * The server paginates the rows that match, and the cursor says where the
   * next page starts. The fake does the same, so a test that checks what a
   * page contains checks the real thing.
   */
  async paginate(opts: { numItems: number; cursor?: string | null }): Promise<{
    page: FakeRow[];
    isDone: boolean;
    continueCursor: string;
  }> {
    const all = this.matches();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const size = opts.numItems > 0 ? opts.numItems : all.length;
    const page = all.slice(start, start + size);
    const next = start + size;
    return {
      page,
      isDone: next >= all.length,
      continueCursor: next < all.length ? String(next) : "",
    };
  }

  /**
   * The search index.
   *
   * The fake searches the name and the product code, which is what the
   * catalogue's search index covers.
   */
  withSearchIndex(
    _name: string,
    builder: (q: { search: (field: string, term: string) => unknown }) => unknown
  ): FakeQuery {
    const captured: { term?: string } = {};
    builder({
      search: (field: string, term: string) => {
        captured.term = term;
        return field;
      },
    });
    const term = (captured.term ?? "").toLowerCase();
    this.searchTerm = term;
    return this;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Builders
 * ──────────────────────────────────────────────────────────────────────── */

/** A `users` row. */
export function makeUser(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "users_1",
    _creationTime: 1,
    first_name: "Test",
    middle_name: undefined,
    last_name: "Person",
    email: "test@example.com",
    password: "hashed",
    roles: [],
    status: "active",
    emailVerified: true,
    ...overrides,
  };
}

/** A `businesses` row. */
export function makeBusiness(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "businesses_1",
    _creationTime: 1,
    name: "Test Business",
    slug: "test-business",
    ownerId: "users_1",
    status: "active",
    plan: "standard",
    currency: "UGX",
    timezone: "Africa/Kampala",
    ...overrides,
  };
}

/** A `memberships` row — the role lives here, not on the user. */
export function makeMembership(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "memberships_1",
    _creationTime: 1,
    userId: "users_1",
    businessId: "businesses_1",
    role: "cashier",
    status: "active",
    ...overrides,
  };
}

/** A `branches` row. */
export function makeBranch(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "branches_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Main Branch",
    code: "MAIN",
    isActive: true,
    ...overrides,
  };
}

/** A `warehouses` row. */
export function makeWarehouse(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "warehouses_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Main Store",
    code: "STORE",
    isActive: true,
    ...overrides,
  };
}

/** A `sessions` row. */
export function makeSession(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "sessions_1",
    _creationTime: 1,
    userId: "users_1",
    sessionId: "session-abc",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

/** A `platformAdmins` row. */
export function makePlatformAdmin(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "platformAdmins_1",
    _creationTime: 1,
    userId: "users_1",
    role: "platform_super_admin",
    status: "active",
    ...overrides,
  };
}

/* ── Phase 4 builders ─────────────────────────────────────────────────── */

/** A `customers` row. */
export function makeCustomer(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "customers_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Amina Nakato",
    phone: "0772123456",
    email: "amina@example.com",
    distributorId: undefined,
    address: "Kampala",
    creditLimit: 0,
    loyaltyPoints: 0,
    totalSpent: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A `loans` row — one credit sale owed by a customer. */
export function makeLoan(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "loans_1",
    _creationTime: 1,
    businessId: "businesses_1",
    customerId: "customers_1",
    salesId: "sales_1",
    amount: 100_000,
    balance: 100_000,
    date: "2026-01-01T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

/** A `payments` row — money received from a customer. */
export function makePayment(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "payments_1",
    _creationTime: 1,
    businessId: "businesses_1",
    customerId: "customers_1",
    loanId: "loans_1",
    amount: 50_000,
    balance: 50_000,
    date: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

/** A `suppliers` row. */
export function makeSupplier(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "suppliers_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Nile Foods Ltd",
    contact: "Jane Wanjiku",
    phone: "0773000000",
    email: "orders@nilefoods.example",
    balance: 0,
    isActive: true,
    ...overrides,
  };
}

/** A `supplierLedger` row — the authoritative supplier account. */
export function makeSupplierLedger(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "supplierLedger_1",
    _creationTime: 1,
    businessId: "businesses_1",
    supplierId: "suppliers_1",
    type: "invoice",
    amount: 100_000,
    balanceAfter: 100_000,
    date: "2026-01-01T00:00:00.000Z",
    description: "Invoice INV-1",
    ...overrides,
  };
}

/** A `stocks` row. */
export function makeStock(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "stocks_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Blue Band 250g",
    productCode: "BB250",
    qty: 10,
    price: 12_000,
    purchasePrice: 10_000,
    pv: 7_000,
    bv: 7_000,
    ...overrides,
  };
}

/**
 * A `shops` row — the counter.
 *
 * The counter's row says how much of each product it holds; the product
 * itself is read from the master catalogue.
 */
export function makeShop(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "shops_1",
    _creationTime: 1,
    businessId: "businesses_1",
    name: "Kampala Road counter",
    serialNumber: "KP-01",
    location: "Kampala Road",
    contact: "",
    userId: "users_1",
    issuedStocks: [],
    ...overrides,
  };
}

/** A `categories` row — the catalogue's category. */
export function makeCategory(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "categories_1",
    _creationTime: 1,
    businessId: "businesses_1",
    type: "Grocery",
    ...overrides,
  };
}

/** A `purchaseOrders` row. */
export function makePurchaseOrder(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "purchaseOrders_1",
    _creationTime: 1,
    businessId: "businesses_1",
    poNumber: "PO-0001",
    supplierId: "suppliers_1",
    supplierName: "Nile Foods Ltd",
    status: "draft",
    date: "2026-01-01T00:00:00.000Z",
    total: 100_000,
    amountPaid: 0,
    userId: "users_1",
    items: [
      {
        stockId: "stocks_1",
        name: "Blue Band 250g",
        productCode: "BB250",
        quantity: 10,
        unitCost: 10_000,
        receivedQty: 0,
        returnedQty: 0,
      },
    ],
    ...overrides,
  };
}

/* ── Phase 5 builders ────────────────────────────────────────────────── */

/** A `sales` row. */
export function makeSale(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "sales_1",
    _creationTime: 1,
    businessId: "businesses_1",
    shopId: undefined,
    branchId: undefined,
    customerId: undefined,
    userId: "users_1",
    invoiceNumber: "INV-1",
    total: 0,
    itemCount: 0,
    paymentMode: "Cash",
    date: "2026-01-15T10:00:00.000Z",
    items: [],
    ...overrides,
  };
}

/** An `expenses` row. */
export function makeExpense(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "expenses_1",
    _creationTime: 1,
    businessId: "businesses_1",
    branchId: undefined,
    date: "2026-01-15T10:00:00.000Z",
    amount: 0,
    expense: "An expense",
    receivedBy: "Cashier",
    type: "General",
    userId: "users_1",
    ...overrides,
  };
}

/** A `stockCostHistory` row — what the goods actually cost when bought. */
export function makeStockCostHistory(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "stockCostHistory_1",
    _creationTime: 1,
    businessId: "businesses_1",
    stockId: "stocks_1",
    supplierId: "suppliers_1",
    supplierName: "Nile Foods Ltd",
    purchaseOrderId: undefined,
    date: "2026-01-01T00:00:00.000Z",
    quantity: 10,
    unitCost: 1_200,
    totalCost: 12_000,
    ...overrides,
  };
}

/** A `cashShifts` row. */
export function makeCashShift(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "cashShifts_1",
    _creationTime: 1,
    businessId: "businesses_1",
    branchId: undefined,
    shopId: undefined,
    userId: "users_1",
    userName: "Test Person",
    status: "open",
    openedAt: "2026-01-15T08:00:00.000Z",
    closedAt: undefined,
    openingFloat: 10_000,
    countedCash: undefined,
    expectedCash: undefined,
    variance: undefined,
    createdAt: "2026-01-15T08:00:00.000Z",
    ...overrides,
  };
}

/** A `cashMovements` row. */
export function makeCashMovement(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "cashMovements_1",
    _creationTime: 1,
    businessId: "businesses_1",
    branchId: undefined,
    shiftId: undefined,
    type: "in",
    amount: 0,
    category: "float",
    reason: "Float top-up",
    reference: undefined,
    date: "2026-01-15T09:00:00.000Z",
    userId: "users_1",
    userName: "Test Person",
    createdAt: "2026-01-15T09:00:00.000Z",
    ...overrides,
  };
}

/** An `incomeRecords` row. */
export function makeIncomeRecord(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "incomeRecords_1",
    _creationTime: 1,
    businessId: "businesses_1",
    branchId: undefined,
    date: "2026-01-15T10:00:00.000Z",
    amount: 0,
    source: "Rent",
    description: undefined,
    reference: undefined,
    userId: "users_1",
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

/* ── Phase 6 builders ───────────────────────────────────────────────── */

/** A `plans` row. */
export function makePlan(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "plans_1",
    _creationTime: 1,
    key: "starter",
    name: "Starter",
    description: "For a single till finding its feet.",
    priceMonthly: 50_000,
    priceAnnual: 500_000,
    currency: "UGX",
    trialDays: 14,
    gracePeriodDays: 7,
    deviceLimit: 1,
    maxUsers: 3,
    maxBranches: 1,
    maxWarehouses: 1,
    maxProducts: 100,
    features: ["core.sales", "core.stock", "core.customers"],
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A `subscriptions` row. */
export function makeSubscription(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "subscriptions_1",
    _creationTime: 1,
    businessId: "businesses_1",
    planKey: "starter",
    status: "trial",
    billingCycle: "monthly",
    trialEndsAt: "2026-02-01T00:00:00.000Z",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    graceEndsAt: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A subscription that is running, on a plan that grants every feature.
 *
 * A business with no subscription row is **not licensed** — the entitlement
 * gate fails closed — so any test that exercises a gated feature needs one
 * of these. The dates are far in the future so that the subscription is
 * still running whenever the test happens to run.
 */
export function makeActiveSubscription(overrides: Partial<FakeRow> = {}): FakeRow {
  return makeSubscription({
    planKey: "professional",
    status: "active",
    trialEndsAt: "2099-01-01T00:00:00.000Z",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    ...overrides,
  });
}

/** A `subscriptionPayments` row. */
export function makeSubscriptionPayment(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "subscriptionPayments_1",
    _creationTime: 1,
    businessId: "businesses_1",
    subscriptionId: "subscriptions_1",
    planKey: "starter",
    amount: 50_000,
    currency: "UGX",
    billingCycle: "monthly",
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-02-01T00:00:00.000Z",
    status: "pending",
    provider: "bank",
    providerReference: "REF-1",
    notes: undefined,
    verifiedAt: undefined,
    verifiedBy: undefined,
    failureReason: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A `devices` row. */
export function makeDevice(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "devices_1",
    _creationTime: 1,
    businessId: "businesses_1",
    deviceId: "device-abc",
    deviceName: "Till 1",
    platform: "web",
    appVersion: undefined,
    status: "active",
    registeredAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    revokedAt: undefined,
    revokedReason: undefined,
    ...overrides,
  };
}

/** A `licenseKeys` row. */
export function makeLicenseKey(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: "licenseKeys_1",
    _creationTime: 1,
    businessId: undefined,
    planKey: "starter",
    keyHash: "hash",
    keyHint: "X7K2M",
    keyPrefix: "SBUZ",
    status: "active",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: undefined,
    revokedAt: undefined,
    revokedBy: undefined,
    revocationReason: undefined,
    lastUsedAt: undefined,
    useCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A context where the given user is signed in with a live session.
 *
 * Unless the caller says otherwise, the business is on a running
 * subscription. A business with no subscription is not licensed — the
 * entitlement gate fails closed — so a test that exercises anything
 * ordinary needs one. A test that is specifically about an unlicensed
 * business passes `subscriptions: []`, or sets `unlicensed: true`.
 */
export function signedInContext(
  options: FakeCtxOptions & { subject?: string; unlicensed?: boolean } = {}
) {
  const subject = options.subject ?? "users_1";
  const identity = {
    subject,
    issuer: "https://test.convex.cloud",
    tokenIdentifier: `${subject}|token`,
    ...(options.identity ?? {}),
  };

  const tables: FakeCtxOptions = { ...options };
  if (options.subscriptions === undefined && !options.unlicensed) {
    tables.subscriptions = [makeActiveSubscription()];
  }

  return new FakeContext({ ...tables, identity });
}
