/**
 * SMARTBUZ — permission catalogue tests.
 *
 * The role × permission matrix is the contract of the whole product, so
 * it is asserted explicitly rather than derived. If somebody adds a
 * permission and forgets to decide what each role gets, these tests fail
 * and force the decision.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_PERMISSIONS,
  BUSINESS_ROLES,
  LEGACY_PERMISSION_ALIASES,
  PERMISSION_DEFINITIONS,
  PLATFORM_ONLY_PERMISSIONS,
  PLATFORM_ROLES,
  ROLE_CANONICAL_PERMISSIONS,
  ROLE_LEGACY_EXTRAS,
  ROLES,
  canonicalPermissions,
  effectivePermissions,
  isBusinessRole,
  isPlatformRole,
  isPlatformOnlyPermission,
  normalizeBusinessRole,
  roleFromLegacyRoles,
  roleHasPermission,
  sanitizePermissionList,
} from "../convex/rbac";

/** The exact permission set each role is expected to hold. */
const EXPECTED: Record<string, string[]> = {
  /* ── Platform ─────────────────────────────────────────────────────── */

  platform_super_admin: [
    "sales.view",
    "sales.create",
    "sales.cancel",
    "sales.refund",
    "products.view",
    "products.create",
    "products.update",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "suppliers.view",
    "suppliers.manage",
    "purchasing.view",
    "purchasing.manage",
    "purchasing.pay",
    "purchasing.return",
    "finance.view",
    "finance.expenses.create",
    "finance.reports.view",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "finance.income.create",
    "finance.reconcile.manage",
    "finance.reports.export",
    "employees.manage",
    "branches.manage",
    "subscriptions.manage",
    "subscriptions.view",
    "subscriptions.plan.manage",
    "subscriptions.payment.verify",
    "subscriptions.self.view",
    "subscriptions.self.manage",
    "integrations.view",
    "integrations.manage",
    "integrations.test",
    "payments.verify",
    "messages.view",
    "messages.send",
    "hardware.manage",
    "industry.manage",
  ],

  platform_support: [
    "sales.view",
    "products.view",
    "inventory.view",
    "customers.view",
    "suppliers.view",
    "purchasing.view",
    "finance.view",
    "finance.reports.view",
    "finance.dashboard.view",
    "subscriptions.view",
    "integrations.view",
    "messages.view",
  ],

  /* ── Business ─────────────────────────────────────────────────────── */

  business_owner: [
    "sales.view",
    "sales.create",
    "sales.cancel",
    "sales.refund",
    "products.view",
    "products.create",
    "products.update",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "suppliers.view",
    "suppliers.manage",
    "purchasing.view",
    "purchasing.manage",
    "purchasing.pay",
    "purchasing.return",
    "finance.view",
    "finance.expenses.create",
    "finance.reports.view",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "finance.income.create",
    "finance.reconcile.manage",
    "finance.reports.export",
    "employees.manage",
    "branches.manage",
    "subscriptions.self.view",
    "subscriptions.self.manage",
    "integrations.view",
    "integrations.manage",
    "integrations.test",
    "payments.verify",
    "messages.view",
    "messages.send",
    "hardware.manage",
    "industry.manage",
  ],

  business_admin: [
    "sales.view",
    "sales.create",
    "sales.cancel",
    "sales.refund",
    "products.view",
    "products.create",
    "products.update",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "customers.view",
    "customers.manage",
    "customers.credit.manage",
    "suppliers.view",
    "suppliers.manage",
    "purchasing.view",
    "purchasing.manage",
    "purchasing.pay",
    "purchasing.return",
    "finance.view",
    "finance.expenses.create",
    "finance.reports.view",
    "finance.dashboard.view",
    "finance.cash.shift.manage",
    "finance.cash.manage",
    "finance.income.create",
    "finance.reconcile.manage",
    "finance.reports.export",
    "employees.manage",
    "branches.manage",
    "subscriptions.self.view",
    "subscriptions.self.manage",
    "integrations.view",
    "integrations.manage",
    "integrations.test",
    "payments.verify",
    "messages.view",
    "messages.send",
    "hardware.manage",
    "industry.manage",
  ],

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

describe("the permission catalogue", () => {
  it("defines the eighteen Phase 2 permissions plus the seven Phase 4, eleven later and eight Phase 9 ones", () => {
    assert.equal(ALL_PERMISSIONS.length, 44);

    // The Phase 2 contract.
    const phase2 = [
      "sales.view",
      "sales.create",
      "sales.cancel",
      "sales.refund",
      "products.view",
      "products.create",
      "products.update",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "customers.manage",
      "suppliers.manage",
      "finance.view",
      "finance.expenses.create",
      "finance.reports.view",
      "employees.manage",
      "branches.manage",
      "subscriptions.manage",
    ];
    for (const permission of phase2) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission as never),
        `the Phase 2 permission ${permission} must still exist`
      );
    }

    // The Phase 4 additions.
    const phase4 = [
      "customers.view",
      "customers.credit.manage",
      "suppliers.view",
      "purchasing.view",
      "purchasing.manage",
      "purchasing.pay",
      "purchasing.return",
    ];
    for (const permission of phase4) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission as never),
        `the Phase 4 permission ${permission} must exist`
      );
    }

    // The Phase 5 additions.
    const phase5 = [
      "finance.dashboard.view",
      "finance.cash.shift.manage",
      "finance.cash.manage",
      "finance.income.create",
      "finance.reconcile.manage",
      "finance.reports.export",
    ];
    for (const permission of phase5) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission as never),
        `the Phase 5 permission ${permission} must exist`
      );
    }

    // The Phase 6 additions — licensing and subscriptions.
    const phase6 = [
      "subscriptions.view",
      "subscriptions.plan.manage",
      "subscriptions.payment.verify",
      "subscriptions.self.view",
      "subscriptions.self.manage",
    ];
    for (const permission of phase6) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission as never),
        `the Phase 6 permission ${permission} must exist`
      );
    }

    // The Phase 9 additions — integrations and industry packages.
    const phase9 = [
      "integrations.view",
      "integrations.manage",
      "integrations.test",
      "payments.verify",
      "messages.view",
      "messages.send",
      "hardware.manage",
      "industry.manage",
    ];
    for (const permission of phase9) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission as never),
        `the Phase 9 permission ${permission} must exist`
      );
    }

    assert.deepEqual(
      [...ALL_PERMISSIONS].sort(),
      [...phase2, ...phase4, ...phase5, ...phase6, ...phase9].sort()
    );
  });

  it("defines all eleven roles, in two scopes", () => {
    assert.equal(PLATFORM_ROLES.length, 2);
    assert.equal(BUSINESS_ROLES.length, 9);
    assert.equal(Object.keys(ROLES).length, 11);
  });

  it("gives every role exactly the permissions it is supposed to have", () => {
    for (const [role, expected] of Object.entries(EXPECTED)) {
      assert.deepEqual(
        canonicalPermissions(role).slice().sort(),
        expected.slice().sort(),
        `canonical permissions differ for role "${role}"`
      );
    }
  });

  it("covers every role — no role is missing from the matrix", () => {
    for (const role of Object.keys(ROLES)) {
      assert.ok(
        role in EXPECTED,
        `role "${role}" has no entry in the expected permission matrix`
      );
    }
  });

  it("gives the platform super admin every permission", () => {
    assert.deepEqual(
      canonicalPermissions("platform_super_admin").slice().sort(),
      ALL_PERMISSIONS.slice().sort()
    );
  });

  it("keeps platform-only permissions out of every business role", () => {
    for (const role of BUSINESS_ROLES) {
      for (const permission of PLATFORM_ONLY_PERMISSIONS) {
        assert.ok(
          !canonicalPermissions(role).includes(permission),
          `${role} must not hold the platform-only permission ${permission}`
        );
      }
    }
  });

  it("gives the platform support role read-only access", () => {
    const held = canonicalPermissions("platform_support");
    for (const permission of held) {
      assert.ok(
        permission.endsWith(".view"),
        `platform_support must not hold the write permission ${permission}`
      );
    }
  });

  it("never lets an auditor change anything", () => {
    // The invariant is "read only", not "ends in .view": an auditor may be
    // allowed to export a report — that produces a file on their own
    // machine and changes nothing in the business — but must never hold a
    // permission that writes, edits or moves anything.
    const mutatingVerbs = [
      ".manage",
      ".create",
      ".cancel",
      ".refund",
      ".adjust",
      ".transfer",
      ".pay",
      ".return",
      ".record",
      ".set",
      ".update",
      ".delete",
    ];

    const held = canonicalPermissions("auditor");
    for (const permission of held) {
      for (const verb of mutatingVerbs) {
        assert.ok(
          !permission.endsWith(verb),
          `auditor must not hold the write permission ${permission}`
        );
      }
    }
  });

  it("keeps subscriptions a platform concern", () => {
    assert.ok(isPlatformOnlyPermission("subscriptions.manage"));
    assert.ok(roleHasPermission("platform_super_admin", "subscriptions.manage"));
    assert.ok(!roleHasPermission("platform_support", "subscriptions.manage"));
    assert.ok(!roleHasPermission("business_owner", "subscriptions.manage"));
    assert.ok(!roleHasPermission("business_admin", "subscriptions.manage"));
  });
});

describe("legacy permission aliases", () => {
  it("derives a legacy permission only from the canonical ones it stands for", () => {
    // `stock.manage` is `inventory.adjust`: a cashier holds neither.
    assert.ok(roleHasPermission("inventory_manager", "stock.manage"));
    assert.ok(!roleHasPermission("cashier", "stock.manage"));

    // `sales.void` is `sales.cancel`.
    assert.ok(roleHasPermission("supervisor", "sales.void"));
    assert.ok(!roleHasPermission("cashier", "sales.void"));

    // `products.manage` needs both create and update.
    assert.ok(roleHasPermission("inventory_manager", "products.manage"));
    assert.ok(!roleHasPermission("supervisor", "products.manage"));
    assert.ok(!roleHasPermission("cashier", "products.manage"));

    // `reports.financial` is `finance.view`.
    assert.ok(roleHasPermission("accountant", "reports.financial"));
    assert.ok(!roleHasPermission("cashier", "reports.financial"));

    // `members.manage` is `employees.manage`.
    assert.ok(roleHasPermission("branch_manager", "members.manage"));
    assert.ok(!roleHasPermission("cashier", "members.manage"));
  });

  it("gives every legacy permission a defined alias", () => {
    for (const legacy of Object.keys(LEGACY_PERMISSION_ALIASES)) {
      assert.ok(
        legacy in LEGACY_PERMISSION_ALIASES,
        `legacy permission ${legacy} has no alias entry`
      );
    }
  });

  it("never derives a legacy permission from a permission that does not exist", () => {
    for (const [legacy, required] of Object.entries(
      LEGACY_PERMISSION_ALIASES
    )) {
      for (const permission of required) {
        assert.ok(
          ALL_PERMISSIONS.includes(permission as never),
          `${legacy} refers to unknown permission ${permission}`
        );
      }
    }
  });
});

describe("role normalisation", () => {
  it("maps the legacy six-role vocabulary onto the Phase 2 roles", () => {
    assert.equal(roleFromLegacyRoles(["owner"]), "business_owner");
    assert.equal(roleFromLegacyRoles(["admin"]), "business_admin");
    assert.equal(roleFromLegacyRoles(["manager"]), "branch_manager");
    assert.equal(roleFromLegacyRoles(["cashier"]), "cashier");
    assert.equal(roleFromLegacyRoles(["stock"]), "inventory_manager");
    assert.equal(roleFromLegacyRoles(["viewer"]), "auditor");
  });

  it("passes a Phase 2 role name straight through", () => {
    assert.equal(roleFromLegacyRoles(["accountant"]), "accountant");
    assert.equal(roleFromLegacyRoles(["salesperson"]), "salesperson");
  });

  it("falls back to the read-only role for anything unknown", () => {
    assert.equal(normalizeBusinessRole("wizard"), "auditor");
    assert.equal(normalizeBusinessRole(undefined), "auditor");
    assert.equal(normalizeBusinessRole(""), "auditor");
    assert.equal(roleFromLegacyRoles(["wizard"]), "auditor");
    assert.equal(roleFromLegacyRoles([]), "auditor");
  });

  it("tells platform roles from business roles", () => {
    assert.ok(isPlatformRole("platform_super_admin"));
    assert.ok(isPlatformRole("platform_support"));
    assert.ok(!isPlatformRole("business_owner"));

    assert.ok(isBusinessRole("business_owner"));
    assert.ok(isBusinessRole("cashier"));
    assert.ok(!isBusinessRole("platform_support"));
  });
});

describe("permission sanitising", () => {
  it("drops anything that is not a canonical permission", () => {
    assert.deepEqual(
      sanitizePermissionList(["sales.view", "not.a.permission", "subscriptions.manage"]),
      ["sales.view", "subscriptions.manage"]
    );
  });

  it("keeps the order it was given", () => {
    assert.deepEqual(sanitizePermissionList(["finance.view", "sales.view"]), [
      "finance.view",
      "sales.view",
    ]);
  });
});

describe("effective permissions", () => {
  it("includes both the canonical and the derived legacy names", () => {
    const held = effectivePermissions("cashier");
    assert.ok(held.includes("sales.view"));
    assert.ok(held.includes("sales.create"));
    assert.ok(held.includes("customers.manage"));
    // Derived from `inventory.view`.
    assert.ok(held.includes("warehouses.view"));
    // Explicitly granted.
    assert.ok(held.includes("business.view"));
  });

  it("is empty for an unknown role", () => {
    assert.deepEqual(effectivePermissions("wizard"), []);
    assert.ok(!roleHasPermission("wizard", "sales.view"));
  });

  it("gives every role its explicit legacy extras", () => {
    for (const [role, extras] of Object.entries(ROLE_LEGACY_EXTRAS)) {
      for (const extra of extras) {
        assert.ok(
          roleHasPermission(role, extra),
          `${role} should hold its explicit legacy permission ${extra}`
        );
      }
    }
  });

  it("defines a label for every role", () => {
    for (const role of Object.keys(ROLES)) {
      const definition = ROLES[role as keyof typeof ROLES];
      assert.ok(definition.label.length > 0);
    }
  });
});
