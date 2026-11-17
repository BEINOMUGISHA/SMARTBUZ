/**
 * SMARTBUZ — privilege escalation tests.
 *
 * These call the *real* mutation handlers from `convex/users.ts` against
 * the in-memory context, so they exercise the whole path: identity →
 * membership → permission → write.
 *
 * The property under test throughout: **nobody can grant themselves
 * anything.** A cashier cannot promote themselves, an administrator
 * cannot create a second owner, and changing somebody else's role needs
 * the administrative permission.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { create, setRoles, update } from "../convex/users";

import {
  FakeContext,
  makeBusiness,
  makeMembership,
  makeUser,
  signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";
const TARGET = "users_2";

/**
 * Invoke a Convex mutation's handler directly.
 *
 * The `mutation()` wrapper stores the handler as `_handler`; calling it
 * with our fake context runs the real code.
 */
async function callMutation(
  registered: unknown,
  ctx: unknown,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = (registered as { _handler: Function })._handler;
  return handler(ctx, args);
}

/**
 * A context where the caller is a member of the business with `role`.
 */
function contextFor(role: string, extra: Record<string, unknown> = {}) {
  return signedInContext({
    users: [
      makeUser({ _id: CALLER }),
      makeUser({ _id: TARGET, email: "target@example.com" }),
    ],
    businesses: [makeBusiness({ _id: BUSINESS })],
    memberships: [
      makeMembership({
        _id: "memberships_1",
        userId: CALLER,
        businessId: BUSINESS,
        role,
      }),
      makeMembership({
        _id: "memberships_2",
        userId: TARGET,
        businessId: BUSINESS,
        role: "cashier",
      }),
    ],
    ...extra,
  });
}

/** The role the target member currently holds. */
function roleOfTarget(ctx: FakeContext): string | undefined {
  const membership = ctx.tables.memberships.find(
    (m) => m.userId === TARGET
  );
  return membership?.role as string | undefined;
}

describe("a member cannot change their own role", () => {
  it("is refused when they try to promote themselves", async () => {
    const ctx = contextFor("cashier");

    await assert.rejects(
      () =>
        callMutation(update, ctx, {
          id: CALLER,
          first_name: "Still",
          last_name: "Cashier",
          roles: ["business_admin"],
        }),
      /Forbidden/
    );

    assert.equal(roleOfTarget(ctx as never), "cashier");
  });

  it("leaves the membership untouched", async () => {
    const ctx = contextFor("cashier");

    await assert.rejects(
      () =>
        callMutation(update, ctx, {
          id: CALLER,
          roles: ["business_owner"],
        }),
      /Forbidden/
    );

    const membership = ctx.tables.memberships.find((m) => m.userId === CALLER);
    assert.equal(membership?.role, "cashier");
  });

  it("is refused even for a supervisor", async () => {
    const ctx = contextFor("supervisor");

    await assert.rejects(
      () =>
        callMutation(update, ctx, {
          id: CALLER,
          roles: ["business_admin"],
        }),
      /Forbidden/
    );
  });
});

describe("an administrator can change somebody else's role", () => {
  it("succeeds for a business admin", async () => {
    const ctx = contextFor("business_admin");

    await callMutation(update, ctx, {
      id: TARGET,
      roles: ["salesperson"],
    });

    assert.equal(roleOfTarget(ctx as never), "salesperson");
  });

  it("succeeds for the business owner", async () => {
    const ctx = contextFor("business_owner");

    await callMutation(update, ctx, {
      id: TARGET,
      roles: ["supervisor"],
    });

    assert.equal(roleOfTarget(ctx as never), "supervisor");
  });

  it("is refused for somebody who is not an administrator", async () => {
    const ctx = contextFor("accountant");

    await assert.rejects(
      () =>
        callMutation(update, ctx, {
          id: TARGET,
          roles: ["business_admin"],
        }),
      /Forbidden/
    );
  });
});

describe("the owner's role is protected", () => {
  it("cannot be changed through setRoles", async () => {
    const ctx = contextFor("business_admin", {
      memberships: [
        makeMembership({
          _id: "memberships_1",
          userId: CALLER,
          businessId: BUSINESS,
          role: "business_admin",
        }),
        makeMembership({
          _id: "memberships_2",
          userId: TARGET,
          businessId: BUSINESS,
          role: "business_owner",
        }),
      ],
    });

    await assert.rejects(
      () =>
        callMutation(setRoles, ctx, {
          userId: TARGET,
          roles: ["cashier"],
        }),
      /owner/i
    );
  });

  it("cannot be granted to a second person at creation", async () => {
    const ctx = contextFor("business_admin");

    await assert.rejects(
      () =>
        callMutation(create, ctx, {
          first_name: "Second",
          last_name: "Owner",
          email: "second-owner@example.com",
          roles: ["business_owner"],
        }),
      /owner/i
    );
  });
});

describe("creating a member needs the administrative permission", () => {
  it("is refused for a cashier", async () => {
    const ctx = contextFor("cashier");

    await assert.rejects(
      () =>
        callMutation(create, ctx, {
          first_name: "New",
          last_name: "Person",
          email: "new@example.com",
          roles: ["salesperson"],
        }),
      /Forbidden/
    );
  });

  it("is allowed for a business admin", async () => {
    const ctx = contextFor("business_admin");

    const userId = await callMutation(create, ctx, {
      first_name: "New",
      last_name: "Person",
      email: "new@example.com",
      roles: ["salesperson"],
    });

    assert.ok(userId);
    const created = ctx.tables.memberships.find((m) => m.userId === userId);
    assert.equal(created?.role, "salesperson");
    assert.equal(created?.businessId, BUSINESS);
  });
});
