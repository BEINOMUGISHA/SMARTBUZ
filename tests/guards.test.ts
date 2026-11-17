/**
 * SMARTBUZ — backend enforcement tests.
 *
 * These exercise the *real* guard functions from `convex/tenancy.ts`
 * against an in-memory Convex context. Nothing here re-implements the
 * rules: if a guard stops throwing, these fail.
 *
 * The point of these tests is the requirement that frontend-only checks
 * are never trusted — so they exercise the server-side path only.
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
  requireUser,
  resolveMemberPermissions,
} from "../convex/tenancy";

import {
  FakeContext,
  makeBranch,
  makeBusiness,
  makeMembership,
  makePlatformAdmin,
  makeSession,
  makeUser,
  signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const USER = "users_1";

/**
 * A context where the caller is a member of the business with `role`.
 */
function contextFor(role: string, extra: Record<string, unknown> = {}) {
  return signedInContext({
    users: [makeUser({ _id: USER })],
    businesses: [makeBusiness({ _id: BUSINESS })],
    memberships: [
      makeMembership({ _id: "memberships_1", userId: USER, businessId: BUSINESS, role }),
    ],
    ...extra,
  });
}

describe("requirePermission — the enforcement point", () => {
  it("allows a permission the role holds", async () => {
    const ctx = contextFor("cashier");
    const membership = await requirePermission(ctx as never, BUSINESS as never, "sales.create");
    assert.equal(membership.role, "cashier");
  });

  it("refuses a permission the role does not hold", async () => {
    const ctx = contextFor("cashier");
    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "finance.expenses.create"),
      /Forbidden/
    );
  });

  it("refuses every accounting permission for a cashier", async () => {
    const ctx = contextFor("cashier");
    const forbidden = [
      "finance.view",
      "finance.expenses.create",
      "finance.reports.view",
      "reports.view",
      "reports.financial",
      "loans.view",
      "loans.manage",
      "settings.manage",
    ];
    for (const permission of forbidden) {
      await assert.rejects(
        () => requirePermission(ctx as never, BUSINESS as never, permission as never),
        new RegExp("Forbidden"),
        `cashier must not be able to ${permission}`
      );
    }
  });

  it("allows an accountant to record expenses", async () => {
    const ctx = contextFor("accountant");
    await requirePermission(ctx as never, BUSINESS as never, "finance.expenses.create");
    await requirePermission(ctx as never, BUSINESS as never, "finance.view");
  });

  it("refuses a caller who is not a member of the business", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      businesses: [makeBusiness({ _id: BUSINESS })],
      memberships: [],
    });
    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "sales.view"),
      /Forbidden/
    );
  });

  it("ignores a membership that has been suspended", async () => {
    const ctx = contextFor("cashier", {
      memberships: [
        makeMembership({
          userId: USER,
          businessId: BUSINESS,
          role: "cashier",
          status: "suspended",
        }),
      ],
    });
    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "sales.view"),
      /Forbidden/
    );
  });
});

describe("custom permissions", () => {
  it("grants a permission the role does not have by default", async () => {
    const ctx = contextFor("cashier", {
      customRolePermissions: [
        {
          _id: "crp_1",
          businessId: BUSINESS,
          role: "cashier",
          granted: ["sales.refund"],
          denied: [],
        },
      ],
    });

    await requirePermission(ctx as never, BUSINESS as never, "sales.refund");
  });

  it("denies a permission the role has by default", async () => {
    const ctx = contextFor("cashier", {
      customRolePermissions: [
        {
          _id: "crp_1",
          businessId: BUSINESS,
          role: "cashier",
          granted: [],
          denied: ["sales.create"],
        },
      ],
    });

    await assert.rejects(
      () => requirePermission(ctx as never, BUSINESS as never, "sales.create"),
      /Forbidden/
    );
  });

  it("lets a member-level grant override the role default", async () => {
    const ctx = contextFor("cashier", {
      memberPermissionOverrides: [
        {
          _id: "mpo_1",
          businessId: BUSINESS,
          userId: USER,
          granted: ["inventory.adjust"],
          denied: [],
        },
      ],
    });

    await requirePermission(ctx as never, BUSINESS as never, "inventory.adjust");
  });

  it("never grants a platform-only permission inside a business", async () => {
    const ctx = contextFor("business_owner", {
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

  it("cannot strip the business owner's own permissions", async () => {
    const ctx = contextFor("business_owner", {
      memberPermissionOverrides: [
        {
          _id: "mpo_1",
          businessId: BUSINESS,
          userId: USER,
          granted: [],
          denied: ["sales.create", "finance.view"],
        },
      ],
    });

    await requirePermission(ctx as never, BUSINESS as never, "sales.create");
    await requirePermission(ctx as never, BUSINESS as never, "finance.view");
  });

  it("ignores a permission name that does not exist", async () => {
    const ctx = contextFor("cashier", {
      memberPermissionOverrides: [
        {
          _id: "mpo_1",
          businessId: BUSINESS,
          userId: USER,
          granted: ["launch.missiles"],
          denied: [],
        },
      ],
    });

    const permissions = await resolveMemberPermissions(
      ctx as never,
      BUSINESS as never,
      makeMembership({ role: "cashier" }) as never
    );
    assert.ok(!permissions.has("launch.missiles" as never));
  });
});

describe("branch restrictions", () => {
  it("lets a branch manager reach the branches they manage", async () => {
    const ctx = contextFor("branch_manager", {
      branches: [
        makeBranch({ _id: "branches_1", managerId: USER }),
        makeBranch({ _id: "branches_2", managerId: "users_other" }),
      ],
    });

    const membership = await requireMembership(ctx as never, BUSINESS as never);
    await requireBranchAccess(ctx as never, membership, "branches_1" as never);
  });

  it("stops a branch manager reaching somebody else's branch", async () => {
    const ctx = contextFor("branch_manager", {
      branches: [
        makeBranch({ _id: "branches_1", managerId: USER }),
        makeBranch({ _id: "branches_2", managerId: "users_other" }),
      ],
    });

    const membership = await requireMembership(ctx as never, BUSINESS as never);
    await assert.rejects(
      () => requireBranchAccess(ctx as never, membership, "branches_2" as never),
      /Forbidden/
    );
  });

  it("honours an explicit branch list over the managed branches", async () => {
    const ctx = contextFor("branch_manager", {
      branches: [
        makeBranch({ _id: "branches_1", managerId: USER }),
        makeBranch({ _id: "branches_2", managerId: USER }),
      ],
      memberships: [
        makeMembership({
          userId: USER,
          businessId: BUSINESS,
          role: "branch_manager",
          branchIds: ["branches_2"],
        }),
      ],
    });

    const membership = await requireMembership(ctx as never, BUSINESS as never);
    const allowed = await allowedBranchIds(ctx as never, membership);
    assert.deepEqual(allowed, ["branches_2"]);

    await assert.rejects(
      () => requireBranchAccess(ctx as never, membership, "branches_1" as never),
      /Forbidden/
    );
  });

  it("does not restrict a role that is not branch-scoped", async () => {
    const ctx = contextFor("salesperson", {
      branches: [makeBranch({ _id: "branches_1" })],
    });
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    const allowed = await allowedBranchIds(ctx as never, membership);
    assert.equal(allowed, undefined);
    await requireBranchAccess(ctx as never, membership, "branches_1" as never);
  });

  it("confines a branch manager with no branches at all to nothing", async () => {
    const ctx = contextFor("branch_manager", { branches: [] });
    const membership = await requireMembership(ctx as never, BUSINESS as never);
    const allowed = await allowedBranchIds(ctx as never, membership);
    assert.deepEqual(allowed, []);
  });
});

describe("sessions", () => {
  it("accepts a token whose session is live", async () => {
    const ctx = signedInContext({
      identity: { subject: USER, sid: "session-abc" },
      users: [makeUser({ _id: USER })],
      sessions: [makeSession({ userId: USER, sessionId: "session-abc" })],
    });

    const user = await requireUser(ctx as never);
    assert.equal(user._id, USER);
  });

  it("refuses a token whose session was revoked", async () => {
    const ctx = signedInContext({
      identity: { subject: USER, sid: "session-abc" },
      users: [makeUser({ _id: USER })],
      sessions: [
        makeSession({
          userId: USER,
          sessionId: "session-abc",
          revokedAt: Date.now(),
          revokedReason: "signed_out",
        }),
      ],
    });

    await assert.rejects(() => requireUser(ctx as never), /Unauthorized/);
  });

  it("refuses a token whose session has expired", async () => {
    const ctx = signedInContext({
      identity: { subject: USER, sid: "session-abc" },
      users: [makeUser({ _id: USER })],
      sessions: [
        makeSession({ userId: USER, sessionId: "session-abc", expiresAt: Date.now() - 1000 }),
      ],
    });

    await assert.rejects(() => requireUser(ctx as never), /Unauthorized/);
  });

  it("refuses a token whose session does not exist", async () => {
    const ctx = signedInContext({
      identity: { subject: USER, sid: "session-unknown" },
      users: [makeUser({ _id: USER })],
      sessions: [],
    });

    await assert.rejects(() => requireUser(ctx as never), /Unauthorized/);
  });

  it("refuses a token that belongs to a different user's session", async () => {
    const ctx = signedInContext({
      identity: { subject: USER, sid: "session-abc" },
      users: [makeUser({ _id: USER })],
      sessions: [makeSession({ userId: "users_other", sessionId: "session-abc" })],
    });

    await assert.rejects(() => requireUser(ctx as never), /Unauthorized/);
  });

  it("refuses an account that has not verified its email", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER, status: "pending_verification" })],
    });

    await assert.rejects(() => requireUser(ctx as never), /verify/i);
  });

  it("refuses a suspended account", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER, status: "suspended" })],
    });

    await assert.rejects(() => requireUser(ctx as never), /suspended/i);
  });

  it("refuses an anonymous caller", async () => {
    const ctx = new FakeContext({ users: [makeUser({ _id: USER })] });
    await assert.rejects(() => requireUser(ctx as never), /Unauthorized/);
  });
});

describe("platform administration", () => {
  it("refuses a business owner", async () => {
    const ctx = contextFor("business_owner");
    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin", "platform_support"]),
      /platform administrator/i
    );
  });

  it("refuses a platform administrator who is not signed in", async () => {
    const ctx = new FakeContext({});
    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin"]),
      /Unauthorized/
    );
  });

  it("lets a platform super administrator in", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_super_admin" })],
    });

    const actor = await requirePlatformRole(ctx as never, ["platform_super_admin"]);
    assert.equal(actor.role, "platform_super_admin");
  });

  it("keeps platform support out of the super-admin role", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_support" })],
    });

    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin"]),
      /Forbidden/
    );
  });

  it("keeps platform support out of platform-wide writes", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_support" })],
    });

    await assert.rejects(
      () => requirePlatformPermission(ctx as never, "subscriptions.manage"),
      /Forbidden/
    );
  });

  it("lets a platform super administrator make platform-wide changes", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [makePlatformAdmin({ userId: USER, role: "platform_super_admin" })],
    });

    const actor = await requirePlatformPermission(ctx as never, "subscriptions.manage");
    assert.equal(actor.role, "platform_super_admin");
  });

  it("ignores a revoked platform role", async () => {
    const ctx = signedInContext({
      users: [makeUser({ _id: USER })],
      platformAdmins: [
        makePlatformAdmin({ userId: USER, role: "platform_super_admin", status: "revoked" }),
      ],
    });

    await assert.rejects(
      () => requirePlatformRole(ctx as never, ["platform_super_admin"]),
      /Forbidden/
    );
  });
});
