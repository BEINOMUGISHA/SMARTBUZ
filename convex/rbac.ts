/**
 * SMARTBUZ — role-based access control catalogue.
 *
 * This module is the single source of truth for *who may do what*. It is a
 * pure module: it imports nothing from the Convex runtime and touches no
 * database, so it can be unit-tested offline and reused by the UI (which
 * only ever uses it to hide buttons — never to decide access).
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two scopes
 * ────────────────────────────────────────────────────────────────────────
 *
 * **Platform roles** are global. They are not members of a business; they
 * administer the SaaS itself — subscriptions, suspending a tenant, granting
 * another administrator their role. They live in the `platformAdmins` table.
 *
 * **Business roles** are per-membership. The same person can be a
 * `business_owner` in one business and a `cashier` in another; the role
 * lives on the `memberships` row, never on the global `users` row.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Canonical permissions vs. legacy permissions
 * ────────────────────────────────────────────────────────────────────────
 *
 * `PERMISSION_DEFINITIONS` is the Phase 2 contract — the eighteen
 * permissions the product is specified around. Every one of them is
 * enforced on the backend; the UI merely mirrors them.
 *
 * `LEGACY_PERMISSION_DEFINITIONS` are the older, more granular names that
 * existing handlers still use (`stock.manage`, `reports.financial`,
 * `settings.manage`, …). They are not a second source of truth: each one
 * declares which canonical permission(s) it is equivalent to, and a role
 * holds the legacy permission exactly when it holds those canonical ones.
 * That keeps ~100 existing enforcement sites correct without duplicating
 * the model.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Canonical permissions
 * ──────────────────────────────────────────────────────────────────────── */

export const PERMISSION_DEFINITIONS = {
  /* Sales */
  "sales.view": {
    label: "View sales",
    group: "Sales",
    description: "Read sales, invoices and receipts.",
  },
  "sales.create": {
    label: "Create sales",
    group: "Sales",
    description: "Ring up a sale at the till.",
  },
  "sales.cancel": {
    label: "Cancel sales",
    group: "Sales",
    description: "Void a completed sale and return the stock.",
  },
  "sales.refund": {
    label: "Refund sales",
    group: "Sales",
    description: "Issue a refund against a completed sale.",
  },

  /* Products */
  "products.view": {
    label: "View products",
    group: "Products",
    description: "Read the product catalogue and prices.",
  },
  "products.create": {
    label: "Create products",
    group: "Products",
    description: "Add new products to the catalogue.",
  },
  "products.update": {
    label: "Update products",
    group: "Products",
    description: "Edit product details and prices.",
  },

  /* Inventory */
  "inventory.view": {
    label: "View inventory",
    group: "Inventory",
    description: "Read stock levels and warehouses.",
  },
  "inventory.adjust": {
    label: "Adjust inventory",
    group: "Inventory",
    description: "Correct stock levels and record adjustments.",
  },
  "inventory.transfer": {
    label: "Transfer inventory",
    group: "Inventory",
    description: "Move stock between branches and warehouses.",
  },

  /* Trading partners */
  "customers.view": {
    label: "View customers",
    group: "Customers",
    description: "Read the customer book, balances and statements.",
  },
  "customers.manage": {
    label: "Manage customers",
    group: "Customers",
    description: "Create and edit customer records.",
  },
  "customers.credit.manage": {
    label: "Manage customer credit",
    group: "Customers",
    description: "Set credit limits, take payments and adjust a customer account.",
  },
  "suppliers.view": {
    label: "View suppliers",
    group: "Suppliers",
    description: "Read the supplier book, balances and statements.",
  },
  "suppliers.manage": {
    label: "Manage suppliers",
    group: "Suppliers",
    description: "Create and edit supplier records and purchase orders.",
  },

  /* Purchasing */
  "purchasing.view": {
    label: "View purchasing",
    group: "Purchasing",
    description: "Read purchase orders, goods receipts and supplier invoices.",
  },
  "purchasing.manage": {
    label: "Manage purchasing",
    group: "Purchasing",
    description: "Raise purchase orders, receive goods and record invoices.",
  },
  "purchasing.pay": {
    label: "Pay suppliers",
    group: "Purchasing",
    description: "Record payments to suppliers against invoices.",
  },
  "purchasing.return": {
    label: "Return purchases",
    group: "Purchasing",
    description: "Return goods to a supplier and take the credit.",
  },

  /* Finance */
  "finance.view": {
    label: "View finance",
    group: "Finance",
    description: "Read financial figures — margins, ledgers, profitability.",
  },
  "finance.expenses.create": {
    label: "Record expenses",
    group: "Finance",
    description: "Record and amend expenses.",
  },
  "finance.reports.view": {
    label: "View financial reports",
    group: "Finance",
    description: "Run and export the reporting suite.",
  },
  "finance.dashboard.view": {
    label: "View the business dashboard",
    group: "Finance",
    description: "Read the daily position: sales, profit, balances and alerts.",
  },
  "finance.cash.shift.manage": {
    label: "Manage cash shifts",
    group: "Finance",
    description: "Open and close a till shift and count the drawer.",
  },
  "finance.cash.manage": {
    label: "Manage the cash drawer",
    group: "Finance",
    description: "Record money into and out of the till.",
  },
  "finance.income.create": {
    label: "Record other income",
    group: "Finance",
    description: "Record income that is not a sale.",
  },
  "finance.reconcile.manage": {
    label: "Reconcile payments",
    group: "Finance",
    description: "Reconcile provider statements against the books.",
  },
  "finance.reports.export": {
    label: "Export financial reports",
    group: "Finance",
    description: "Export reports to CSV, Excel and PDF.",
  },

  /* People & structure */
  "employees.manage": {
    label: "Manage employees",
    group: "People",
    description: "Add, edit and remove staff records and assignments.",
  },
  "branches.manage": {
    label: "Manage branches",
    group: "Structure",
    description: "Create, edit and retire branches.",
  },
  "subscriptions.manage": {
    label: "Manage subscriptions",
    group: "Platform",
    description: "Change a business's plan, status and billing dates.",
  },
  "subscriptions.view": {
    label: "View subscriptions",
    group: "Platform",
    description: "Read any business's subscription, payments and devices.",
  },
  "subscriptions.plan.manage": {
    label: "Manage plans and pricing",
    group: "Platform",
    description: "Create plans, edit the pricing and retire a plan.",
  },
  "subscriptions.payment.verify": {
    label: "Verify payments",
    group: "Platform",
    description: "Confirm a payment against the provider's own record.",
  },
  "subscriptions.self.view": {
    label: "View own subscription",
    group: "Subscription",
    description: "See your own plan, renewal date, devices and payments.",
  },
  "subscriptions.self.manage": {
    label: "Manage own subscription",
    group: "Subscription",
    description: "Choose a plan, redeem a license key and manage your devices.",
  },

  /* Integrations */
  "integrations.view": {
    label: "View integrations",
    group: "Integrations",
    description: "See which payment, messaging and hardware integrations are configured, and how far each has been tested.",
  },
  "integrations.manage": {
    label: "Configure integrations",
    group: "Integrations",
    description: "Set up a provider's credentials and settings, and switch integrations on or off.",
  },
  "integrations.test": {
    label: "Test integrations",
    group: "Integrations",
    description: "Run a live test against a provider. This makes a real call, and may cost money.",
  },
  "payments.verify": {
    label: "Verify payments",
    group: "Integrations",
    description: "Confirm a payment the provider has reported, and record it against the sale.",
  },
  "messages.view": {
    label: "View messages",
    group: "Integrations",
    description: "Read the log of messages the business has sent, and their delivery status.",
  },
  "messages.send": {
    label: "Send messages",
    group: "Integrations",
    description: "Send receipts, reminders and other messages to customers.",
  },
  "hardware.manage": {
    label: "Manage till hardware",
    group: "Integrations",
    description: "Configure the till's barcode scanner, receipt printer, cash drawer and weighing scale.",
  },
  "industry.manage": {
    label: "Manage industry packages",
    group: "Integrations",
    description: "Switch industry packages on or off, and change their settings.",
  },
} as const;

/** The Phase 2 permission contract. */
export type Permission = keyof typeof PERMISSION_DEFINITIONS;

/** Every canonical permission, in declaration order. */
export const ALL_PERMISSIONS = Object.keys(
  PERMISSION_DEFINITIONS
) as Permission[];

/**
 * Permission verbs that **change** something.
 *
 * A permission whose verb is not in this list only reads. The distinction
 * matters because the subscription gate uses it: a business whose
 * subscription has closed may still *read* its own data, but must not
 * change anything.
 */
const WRITE_VERBS = [
  "manage",
  "create",
  "cancel",
  "refund",
  "adjust",
  "transfer",
  "pay",
  "return",
  "record",
  "set",
  "update",
  "delete",
  // Exporting takes data out of the business, so it is closed with the
  // writing rather than left open.
  "export",
  // Sending a message spends the business's money with a provider, and
  // testing an integration makes a real call — both are writes.
  "send",
  "test",
  // Confirming a payment changes the books, so it is a write.
  "verify",
];

/**
 * Does this permission write?
 *
 * The verb after the last dot decides. `sales.view` reads;
 * `customers.manage` writes; `finance.reports.export` takes data out of
 * the business and is treated as a write.
 */
export function isWritePermission(permission: string): boolean {
  const verb = permission.split(".").pop() ?? "";
  return WRITE_VERBS.includes(verb);
}

/**
 * Permissions that may only ever be exercised by a platform administrator.
 *
 * They are deliberately *not* grantable inside a business: no business
 * administrator — not even the owner — may hand these out, so a tenant can
 * never escalate itself into controlling the platform.
 */
export const PLATFORM_ONLY_PERMISSIONS: Permission[] = [
  "subscriptions.manage",
  "subscriptions.view",
  "subscriptions.plan.manage",
  "subscriptions.payment.verify",
];

/* ────────────────────────────────────────────────────────────────────────
 * Legacy permissions
 * ──────────────────────────────────────────────────────────────────────── */

export const LEGACY_PERMISSION_DEFINITIONS = {
  "business.view": { label: "View business", group: "Business" },
  "business.update": { label: "Update business", group: "Business" },
  "business.settings": { label: "Manage business settings", group: "Business" },
  "business.transferOwnership": {
    label: "Transfer ownership",
    group: "Business",
  },
  "members.view": { label: "View members", group: "People" },
  "members.manage": { label: "Manage members", group: "People" },
  "branches.view": { label: "View branches", group: "Structure" },
  "branches.manage": { label: "Manage branches", group: "Structure" },
  "warehouses.view": { label: "View warehouses", group: "Structure" },
  "warehouses.manage": { label: "Manage warehouses", group: "Structure" },
  "employees.view": { label: "View employees", group: "People" },
  "employees.manage": { label: "Manage employees", group: "People" },
  "products.view": { label: "View products", group: "Products" },
  "products.manage": { label: "Manage products", group: "Products" },
  "sales.view": { label: "View sales", group: "Sales" },
  "sales.create": { label: "Create sales", group: "Sales" },
  "sales.void": { label: "Void sales", group: "Sales" },
  "sales.discount": { label: "Apply discounts", group: "Sales" },
  "stock.manage": { label: "Manage stock", group: "Inventory" },
  "customers.manage": { label: "Manage customers", group: "Customers" },
  "loans.view": { label: "View loans", group: "Finance" },
  "loans.manage": { label: "Manage loans", group: "Finance" },
  "reports.view": { label: "View reports", group: "Finance" },
  "reports.financial": { label: "View financial reports", group: "Finance" },
  "settings.manage": { label: "Manage settings", group: "Business" },
} as const;

export type LegacyPermission = keyof typeof LEGACY_PERMISSION_DEFINITIONS;

/** Anything `requirePermission` accepts. */
export type AnyPermission = Permission | LegacyPermission;

/**
 * Which canonical permission(s) a legacy permission is equivalent to.
 *
 * A role holds a legacy permission when it holds **every** canonical
 * permission listed here (an empty list means "legacy-only — granted
 * explicitly per role, see `ROLE_LEGACY_EXTRAS`").
 */
export const LEGACY_PERMISSION_ALIASES: Record<
  LegacyPermission,
  Permission[]
> = {
  "business.view": [],
  "business.update": [],
  "business.settings": [],
  "business.transferOwnership": [],
  "members.view": [],
  "members.manage": ["employees.manage"],
  "branches.view": [],
  "branches.manage": ["branches.manage"],
  "warehouses.view": ["inventory.view"],
  "warehouses.manage": ["inventory.transfer"],
  "employees.view": [],
  "employees.manage": ["employees.manage"],
  "products.view": ["products.view"],
  "products.manage": ["products.create", "products.update"],
  "sales.view": ["sales.view"],
  "sales.create": ["sales.create"],
  "sales.void": ["sales.cancel"],
  "sales.discount": [],
  "stock.manage": ["inventory.adjust"],
  "customers.manage": ["customers.manage"],
  "loans.view": [],
  "loans.manage": [],
  "reports.view": ["finance.reports.view"],
  "reports.financial": ["finance.view"],
  "settings.manage": [],
};

/* ────────────────────────────────────────────────────────────────────────
 * Roles
 * ──────────────────────────────────────────────────────────────────────── */

export const PLATFORM_ROLES = [
  "platform_super_admin",
  "platform_support",
] as const;

export const BUSINESS_ROLES = [
  "business_owner",
  "business_admin",
  "branch_manager",
  "supervisor",
  "cashier",
  "inventory_manager",
  "accountant",
  "salesperson",
  "auditor",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type BusinessRole = (typeof BUSINESS_ROLES)[number];
export type RoleId = PlatformRole | BusinessRole;

export const ALL_ROLES: RoleId[] = [...PLATFORM_ROLES, ...BUSINESS_ROLES];

export interface RoleDefinition {
  id: RoleId;
  label: string;
  scope: "platform" | "business";
  description: string;
  /**
   * Authority rank inside its scope. Used to stop a member granting or
   * changing a role that outranks them.
   */
  rank: number;
}

export const ROLES: Record<RoleId, RoleDefinition> = {
  platform_super_admin: {
    id: "platform_super_admin",
    label: "Platform Super Admin",
    scope: "platform",
    description:
      "Full control of the platform: tenants, plans, subscriptions and other administrators.",
    rank: 100,
  },
  platform_support: {
    id: "platform_support",
    label: "Platform Support",
    scope: "platform",
    description:
      "Read-only access across every tenant for diagnosing customer issues. Cannot change data.",
    rank: 90,
  },
  business_owner: {
    id: "business_owner",
    label: "Business Owner",
    scope: "business",
    description:
      "The person who owns the business. Exactly one per business.",
    rank: 80,
  },
  business_admin: {
    id: "business_admin",
    label: "Business Administrator",
    scope: "business",
    description:
      "Runs the business day to day: staff, branches, catalogue and finance.",
    rank: 70,
  },
  branch_manager: {
    id: "branch_manager",
    label: "Branch Manager",
    scope: "business",
    description:
      "Runs one or more branches. Confined to the branches they are assigned to.",
    rank: 60,
  },
  supervisor: {
    id: "supervisor",
    label: "Supervisor",
    scope: "business",
    description:
      "Oversees counters and staff. Can cancel and refund sales raised by others.",
    rank: 50,
  },
  cashier: {
    id: "cashier",
    label: "Cashier",
    scope: "business",
    description:
      "Works the till: creates sales and serves customers. No accounting access.",
    rank: 30,
  },
  inventory_manager: {
    id: "inventory_manager",
    label: "Inventory Manager",
    scope: "business",
    description:
      "Owns the catalogue and stock: products, adjustments, transfers and suppliers.",
    rank: 40,
  },
  accountant: {
    id: "accountant",
    label: "Accountant",
    scope: "business",
    description:
      "Owns the books: finance visibility, expense capture and financial reporting.",
    rank: 40,
  },
  salesperson: {
    id: "salesperson",
    label: "Salesperson",
    scope: "business",
    description:
      "Sells on the road. Creates sales and manages their own customers.",
    rank: 20,
  },
  auditor: {
    id: "auditor",
    label: "Auditor",
    scope: "business",
    description:
      "Read-only oversight. Sees everything, changes nothing.",
    rank: 10,
  },
};

/** The business role that cannot be assigned, changed or revoked by others. */
export const OWNER_ROLE: BusinessRole = "business_owner";

/**
 * Roles whose access is confined to specific branches.
 *
 * A branch manager without an explicit branch list falls back to the
 * branches they manage (`branches.managerId`), so they can never reach a
 * branch that is not theirs.
 */
export const BRANCH_SCOPED_ROLES: BusinessRole[] = ["branch_manager"];

/* ────────────────────────────────────────────────────────────────────────
 * Canonical grants per role
 * ──────────────────────────────────────────────────────────────────────── */

/** Every canonical permission — used by the two unrestricted roles. */
const EVERY_PERMISSION: Permission[] = [...ALL_PERMISSIONS];

/**
 * What each role may do, in canonical terms.
 *
 * This table is the contract. It is deliberately explicit rather than
 * computed from "rank", so that adding a permission forces a decision for
 * every role instead of silently widening everyone's access.
 */
export const ROLE_CANONICAL_PERMISSIONS: Record<RoleId, Permission[]> = {
  /* ── Platform ─────────────────────────────────────────────────────── */

  platform_super_admin: EVERY_PERMISSION,

  platform_support: [
    "sales.view",
    "products.view",
    "inventory.view",
    "finance.view",
    "finance.reports.view",
    "finance.dashboard.view",
    "customers.view",
    "suppliers.view",
    "purchasing.view",
    "subscriptions.view",
    "integrations.view",
    "messages.view",
  ],

  /* ── Business ─────────────────────────────────────────────────────── */

  business_owner: EVERY_PERMISSION.filter(
    (p) => !PLATFORM_ONLY_PERMISSIONS.includes(p)
  ),

  business_admin: EVERY_PERMISSION.filter(
    (p) => !PLATFORM_ONLY_PERMISSIONS.includes(p)
  ),

  branch_manager: [
    "sales.view",
    "sales.create",
    "sales.cancel",
    "products.view",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "suppliers.view",
    "purchasing.view",
    "purchasing.manage",
    "purchasing.return",
    "employees.manage",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "subscriptions.self.view",
    "integrations.view",
    "hardware.manage",
    "messages.send",
    "payments.verify",
  ],

  supervisor: [
    "sales.view",
    "sales.cancel",
    "sales.refund",
    "products.view",
    "products.update",
    "inventory.view",
    "inventory.adjust",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "subscriptions.self.view",
    "integrations.view",
    "messages.view",
    "messages.send",
    "payments.verify",
  ],

  cashier: [
    "sales.view",
    "sales.create",
    "products.view",
    "inventory.view",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "subscriptions.self.view",
    "messages.send",
  ],

  inventory_manager: [
    "sales.view",
    "products.view",
    "products.create",
    "products.update",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "suppliers.view",
    "suppliers.manage",
    "purchasing.view",
    "purchasing.manage",
    "purchasing.return",
    "subscriptions.self.view",
    "integrations.view",
    "hardware.manage",
  ],

  accountant: [
    "sales.view",
    "products.view",
    "inventory.view",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "suppliers.view",
    "purchasing.view",
    "purchasing.pay",
    "finance.view",
    "finance.expenses.create",
    "finance.reports.view",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "finance.income.create",
    "finance.reconcile.manage",
    "finance.reports.export",
    "subscriptions.self.view",
    "integrations.view",
    "messages.view",
    "messages.send",
    "payments.verify",
  ],

  salesperson: [
    "sales.view",
    "sales.create",
    "products.view",
    "inventory.view",
    "customers.view",
    "customers.manage",
    "subscriptions.self.view",
    "messages.send",
    "payments.verify",
  ],

  auditor: [
    "sales.view",
    "products.view",
    "inventory.view",
    "finance.view",
    "finance.reports.view",
    "finance.dashboard.view",
    "finance.reports.export",
    "customers.view",
    "suppliers.view",
    "purchasing.view",
    "subscriptions.self.view",
    "integrations.view",
    "messages.view",
  ],
};

/**
 * Legacy permissions granted explicitly, because they have no canonical
 * equivalent (or the equivalent is too coarse to inherit).
 */
export const ROLE_LEGACY_EXTRAS: Record<RoleId, LegacyPermission[]> = {
  /* Platform roles see the whole platform read-only except the super admin. */
  platform_super_admin: Object.keys(
    LEGACY_PERMISSION_DEFINITIONS
  ) as LegacyPermission[],
  platform_support: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "loans.view",
  ],

  business_owner: [
    "business.view",
    "business.update",
    "business.settings",
    "business.transferOwnership",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "loans.view",
    "loans.manage",
    "sales.discount",
    "settings.manage",
  ],

  business_admin: [
    "business.view",
    "business.update",
    "business.settings",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "loans.view",
    "loans.manage",
    "sales.discount",
    "settings.manage",
  ],

  branch_manager: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "sales.discount",
  ],

  supervisor: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "sales.discount",
  ],

  cashier: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
  ],

  inventory_manager: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
  ],

  accountant: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "loans.view",
    "loans.manage",
  ],

  salesperson: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
  ],

  auditor: [
    "business.view",
    "members.view",
    "branches.view",
    "warehouses.view",
    "employees.view",
    "loans.view",
  ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Effective permissions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Expand the canonical grants into the full permission set a role holds,
 * including the legacy names derived from them.
 */
function buildEffectivePermissions(
  role: RoleId
): ReadonlySet<AnyPermission> {
  const canonical = new Set<Permission>(ROLE_CANONICAL_PERMISSIONS[role] ?? []);
  const effective = new Set<AnyPermission>();

  for (const permission of canonical) effective.add(permission);

  for (const legacy of ROLE_LEGACY_EXTRAS[role] ?? []) {
    effective.add(legacy);
  }

  for (const [legacy, required] of Object.entries(
    LEGACY_PERMISSION_ALIASES
  ) as [LegacyPermission, Permission[]][]) {
    // An empty alias list means "legacy-only" — the permission is granted
    // explicitly per role in `ROLE_LEGACY_EXTRAS`, and to nobody else.
    //
    // The length check matters: `[].every(...)` is `true`, so without it
    // every legacy-only permission would leak to every role.
    if (required.length === 0) continue;

    // Every canonical permission the legacy name stands for must be held.
    if (required.every((permission) => canonical.has(permission))) {
      effective.add(legacy);
    }
  }

  return effective;
}

const EFFECTIVE_PERMISSIONS: Record<RoleId, ReadonlySet<AnyPermission>> =
  Object.fromEntries(
    ALL_ROLES.map((role) => [role, buildEffectivePermissions(role)])
  ) as Record<RoleId, ReadonlySet<AnyPermission>>;

/** Every permission a role holds, canonical and legacy. */
export function effectivePermissions(role: string): AnyPermission[] {
  const set = EFFECTIVE_PERMISSIONS[role as RoleId];
  return set ? [...set] : [];
}

/** The canonical permissions a role holds. */
export function canonicalPermissions(role: string): Permission[] {
  return ROLE_CANONICAL_PERMISSIONS[role as RoleId] ?? [];
}

/**
 * True when the role grants the permission.
 *
 * Accepts both canonical and legacy permission names, so existing handlers
 * keep working unchanged while the model behind them is the Phase 2 one.
 */
export function roleHasPermission(
  role: string,
  permission: AnyPermission
): boolean {
  const set = EFFECTIVE_PERMISSIONS[role as RoleId];
  return set ? set.has(permission) : false;
}

/** True when the role is a platform role. */
export function isPlatformRole(role: string): role is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

/** True when the role is a business role. */
export function isBusinessRole(role: string): role is BusinessRole {
  return (BUSINESS_ROLES as readonly string[]).includes(role);
}

/** True when the role is known to the catalogue at all. */
export function isKnownRole(role: string): role is RoleId {
  return (ALL_ROLES as string[]).includes(role);
}

/**
 * The role's label, for messages and UI.
 */
export function roleLabel(role: string): string {
  return ROLES[role as RoleId]?.label ?? role;
}

/**
 * True when `permission` may only be exercised at platform level.
 */
export function isPlatformOnlyPermission(
  permission: string
): permission is Permission {
  return (PLATFORM_ONLY_PERMISSIONS as string[]).includes(permission);
}

/* ────────────────────────────────────────────────────────────────────────
 * Legacy role vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The pre-Phase-2 role names, mapped onto the Phase 2 roles.
 *
 * The old six-role vocabulary is replaced, but the rows already in the
 * database still carry the old strings, so anything that reads them has to
 * keep working.
 */
export const LEGACY_ROLE_MAP: Record<string, BusinessRole> = {
  /* The pre-Phase-2 six-role vocabulary. */
  owner: "business_owner",
  admin: "business_admin",
  manager: "branch_manager",
  stock: "inventory_manager",
  viewer: "auditor",

  /* Phase 2 names map to themselves so the function is idempotent. */
  business_owner: "business_owner",
  business_admin: "business_admin",
  branch_manager: "branch_manager",
  supervisor: "supervisor",
  cashier: "cashier",
  inventory_manager: "inventory_manager",
  accountant: "accountant",
  salesperson: "salesperson",
  auditor: "auditor",
};

/**
 * Map a legacy global role array onto a single business role.
 *
 * A Phase 2 role name in the array wins outright, so the admin screen can
 * post the new vocabulary without translation.
 */
export function roleFromLegacyRoles(roles: string[] | undefined): BusinessRole {
  if (!roles || roles.length === 0) return "auditor";

  for (const role of roles) {
    const mapped = LEGACY_ROLE_MAP[role];
    if (mapped) return mapped;
  }

  return "auditor";
}

/**
 * Normalise a role string to a known business role.
 *
 * Anything unknown becomes `auditor` — the read-only role — so an
 * unrecognised value can never widen access.
 */
export function normalizeBusinessRole(role: string | undefined): BusinessRole {
  if (!role) return "auditor";
  const mapped = LEGACY_ROLE_MAP[role];
  if (mapped && isBusinessRole(mapped)) return mapped;
  if (isBusinessRole(role)) return role;
  return "auditor";
}

/**
 * The canonical permissions of a role, but only those that exist in the
 * catalogue. Used when validating custom grants coming from the client.
 */
export function sanitizePermissionList(
  permissions: readonly string[]
): Permission[] {
  const known = new Set<string>(ALL_PERMISSIONS);
  return permissions.filter((p): p is Permission => known.has(p));
}
