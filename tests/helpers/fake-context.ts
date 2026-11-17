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
    this.filterConditions = conditions;
    return this;
  }

  private matches(): FakeRow[] {
    return this.rows.filter(
      (row) =>
        this.indexConditions.every((c) => conditionHolds(row, c)) &&
        this.filterConditions.every((c) => conditionHolds(row, c))
    );
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

/**
 * A context where the given user is signed in with a live session.
 */
export function signedInContext(options: FakeCtxOptions & { subject?: string } = {}) {
  const subject = options.subject ?? "users_1";
  const identity = {
    subject,
    issuer: "https://test.convex.cloud",
    tokenIdentifier: `${subject}|token`,
    ...(options.identity ?? {}),
  };
  return new FakeContext({ ...options, identity });
}
