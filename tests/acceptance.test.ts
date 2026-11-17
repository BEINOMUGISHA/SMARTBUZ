/**
 * SMARTBUZ — acceptance criteria.
 *
 * The three statements the phase is judged by, asserted against the real
 * backend guards:
 *
 *   1. A cashier cannot access accounting administration.
 *   2. A branch manager cannot access unauthorised branches.
 *   3. Only authorised platform administrators can manage platform-wide
 *      operations.
 *
 * These are deliberately written as behaviour ("this call is refused")
 * rather than as matrix assertions, so they keep meaning the same thing
 * even if the catalogue is rearranged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  allowedBranchIds,
  requireBranchAccess,
  requireMembership,
  requirePermission,
  requirePlatformPermission,
  requirePlatformRole,
} from "../convex/tenancy";

import {
  makeBranch,
  makeBusiness,
  makeMembership,
  makePlatformAdmin,
  makeUser,
  signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const USER = "users_1";

function memberContext(role: string, extra: Record<string, unknown> = {}) {
  return signedInContext({
    users: [makeUser({ _id: USER })],
    businesses: [makeBusiness({ _id: BUSINESS })],
    memberships: [
      makeMembership({ userId: USER, businessId: BUSINESS, role }),
    ],
    ...extra,
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * 1. A cashier cannot access accounting administration
 * ──────────────────────────────────────────────────────────────────────── */

describe("acceptance: a cashier cannot access accounting administration", () => {
  /**
   * Everything that constitutes "accounting administration" — recording
   * money, reading the finance suite, administering the books, and the
   * legacy names that stand for them.
   */
  const ACCOUNTING_PERMISSIONS = [
    "finance.view",
    "finance.expenses.create",
    "finance.reports.view",
    "reports.view",
    "reports.financial",
    "loans.view",
    "loans.manage",
    "settings.manage",
    "banking.manage",
  ];

  it("is refused every accounting permission", async () => {
    const ctx = memberContext("cashier");

    for (const permission of ACCOUNTING_PERMISSIONS) {
      await assert.rejects(
        () => requirePermission(ctx as never, BUSINESS as never, permission as never),
        /Forbidden/,
        `a cashier must not be able to ${permission}`
      );
    }
  });

  it("is refused even when the client asks nicely", async () => {
    // The permission comes from the caller's membership, never from an
    // argument — so a forged argument changes nothing.
    const ctx = memberContext("cashier");
    await assert.rejects(
      () =>
        requirePermission(ctx as never, BUSINESS as never, "finance.expenses.create" as never),
      /Forbidden/
    );
  });

  it("still works at the till", async () => {
    const ctx = memberContext("cashier");
    await requirePermission(ctx as never, BUSINESS as never, "sales.create");
    await requirePermission(ctx as never, BUSINESS as never, "sales.view");
    await requirePermission(ctx as never, BUSINESS as never, "customers.manage");
  });

  it("cannot be given accounting access by a custom grant", async () => {
    // Platform-only permissions can never be granted inside a business.
    const ctx = memberContext("cashier", {
      memberPermissionOverrides: [
        {
          _id: "mpo_1",
          businessId: BUSINESS,
          userId: USER,
          granted: ["subscriptions.manage"],
          denied: [],
        },
      ],
    });

    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("is not the same as an accountant", async () => {
    const accountant = memberContext("accountant");
    await requirePermission(accountant as never, BUSINESS as never, "finance.expenses.create");
    await requirePermission(accountant as never, BUSINESS as never, "finance.reports.view");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. A branch manager cannot access unauthorised branches
 * ──────────────────────────────────────────────────────────────────────── */

describe("acceptance: a branch manager cannot access unauthorised branches", () => {
  const OWN_BRANCH = "branches_1";
  const OTHER_BRANCH = "branches_2";

  function branchManagerContext(branchIds?: string[]) {
    return memberContext("branch_manager", {
      branches: [
        makeBranch({ _id: OWN_BRANCH, name: "Own Branch", managerId: USER }),
        makeBranch({ _id: OTHER_BRANCH, name: "Other Branch", managerId: "users_other" }),
      ],
      memberships: [
        makeMembership({
          userId: USER,
          businessId: BUSINESS,
          role: "branch_manager",
          branchIds,
        }),
      ],
    });
  }

  it("can reach the branch they manage", async () => {
    const ctx = branchManagerContext();
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    await requireBranchAccess(ctx as never, membership, OWN_BRANCH as never);
  });

  it("is stopped at another branch", async () => {
    const ctx = branchManagerContext();
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    await assert.rejects(
      () => requireBranchAccess(ctx as never, membership, OTHER_BRANCH as never),
      /Forbidden/
    );
  });

  it("sees only its own branches", async () => {
    const ctx = branchManagerContext();
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    const allowed = await allowedBranchIds(ctx as never, membership);
    assert.deepEqual(allowed, [OWN_BRANCH]);
  });

  it("is restricted to the branch list it was given", async () => {
    const ctx = branchManagerContext([OTHER_BRANCH]);
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    const allowed = await allowedBranchIds(ctx as never, membership);
    assert.deepEqual(allowed, [OTHER_BRANCH]);
    await assert.rejects(
      () => requireBranchAccess(ctx as never, membership, OWN_BRANCH as never),
      /Forbidden/
    );
  });

  it("cannot borrow another business's branch", async () => {
    const ctx = branchManagerContext();
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    await assert.rejects(
      () => requireBranchAccess(ctx as never, membership, "branches_foreign" as never),
      /Forbidden/
    );
  });

  it("is still able to run its own branch", async () => {
    const ctx = branchManagerContext();
    await requirePermission(ctx as never, BUSINESS as never, "sales.create");
    await requirePermission(ctx as never, BUSINESS as never, "inventory.adjust");
    await requirePermission(ctx as never, BUSINESS as never, "employees.manage");
  });

  it("is not able to run accounting", async () => {
    const ctx = branchManagerContext();
    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "finance.expenses.create"),
      /Forbidden/
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Only authorised platform administrators manage platform-wide operations
 * ──────────────────────────────────────────────────────────────────────── */

describe("acceptance: only authorised platform administrators manage platform-wide operations", () => {
  it("refuses a business owner, however big their business", async () => {
    const ctx = memberContext("business_owner");
    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin", "platform_support"]),
      /platform administrator/i
    );
    await assert.rejects(
      () => requirePlatformPermission(ctx as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("refuses a business administrator", async () => {
    const ctx = memberContext("business_admin");
    await assert.rejects(
      () => requirePlatformPermission(ctx as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("refuses a platform support agent from making platform-wide changes", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_support" })],
    });

    await assert.rejects(
      () => requirePlatformPermission(ctx as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("lets a platform support agent look, but not touch", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_support" })],
    });

    const actor = await requirePlatformRole(ctx as never, [
      "platform_super_admin",
      "platform_support",
    ]);
    assert.equal(actor.role, "platform_support");
  });

  it("lets a platform super administrator manage platform-wide operations", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_super_admin" })],
    });

    const actor = await requirePlatformPermission(ctx as never, "subscriptions.manage");
    assert.equal(actor.role, "platform_super_admin");
  });

  it("refuses somebody whose platform role was revoked", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [
        makePlatformAdmin({ userId: USER, role: "platform_super_admin", status: "revoked" }),
      ],
    });

    await assert.rejects(
      () => requirePlatformPermission(ctx as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("refuses an ordinary member of a business", async () => {
    const ctx = memberContext("salesperson");
    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin"]),
      /Forbidden/
    );
  });
});
