/**
 * SMARTBUZ — tenancy & authorization.
 *
 * This module is the single place where "who is calling" and "what may they
 * touch" are decided. Everything else in the backend asks it.
 *
 * Why it exists
 * ─────────────
 * Before this, the Convex deployment was a public API (AUDIT.md §2.1) and
 * authorization trusted a client-supplied `adminUserId` (§2.2).
 * Anyone who knew the deployment URL could read every sale in every
 * business, and anyone who knew an admin's id could act as that admin.
 *
 * The rules enforced here
 * ───────────────────────
 *  1. The caller is derived from `ctx.auth.getUserIdentity()` — the signed
 *     access token the Next.js server issues — never from an argument.
 *  2. The tenant is derived from the caller's *membership*. A client may
 *     ask for a specific business, but only one the caller actually
 *     belongs to; anything else is a hard "Forbidden", never a silent
 *     fall-back to some other tenant's data.
 *  3. Every query, mutation and action filters by `businessId` and every
 *     document it reads or writes is checked against the resolved tenant.
 *  4. Access is decided by the role catalogue in `convex/rbac.ts` — the
 *     eleven Phase 2 roles and their permission grants — plus any
 *     business-specific custom grants.
 *  5. The token must belong to a live session. A session that has been
 *     signed out or revoked stops working immediately, even while the
 *     access token itself is still inside its 15-minute lifetime.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { safeEqual, sha256Hex } from "./crypto";
import {
  ALL_PERMISSIONS,
  BRANCH_SCOPED_ROLES,
  BUSINESS_ROLES as RBAC_BUSINESS_ROLES,
  LEGACY_ROLE_MAP,
  OWNER_ROLE,
  PLATFORM_ONLY_PERMISSIONS,
  PLATFORM_ROLES,
  type AnyPermission,
  type BusinessRole,
  type PlatformRole,
  type RoleId,
  effectivePermissions,
  isPlatformOnlyPermission,
  isWritePermission,
  normalizeBusinessRole,
  roleFromLegacyRoles,
  roleHasPermission as rbacRoleHasPermission,
  sanitizePermissionList,
} from "./rbac";
import { assertSubscriptionWritable } from "./subscriptionState";

export type Ctx = MutationCtx | QueryCtx;

export type BusinessId = Id<"businesses">;
export type UserId = Id<"users">;
export type BranchId = Id<"branches">;
export type WarehouseId = Id<"warehouses">;

/* ────────────────────────────────────────────────────────────────────────
 * Roles and permissions
 * ──────────────────────────────────────────────────────────────────────── */

/** The roles a member can hold inside a business. */
export const BUSINESS_ROLES = RBAC_BUSINESS_ROLES;

/**
 * The permissions a role may be asked for.
 *
 * Both the canonical Phase 2 permissions and the older, more granular
 * names are accepted, so existing handlers keep compiling while the model
 * behind them is the Phase 2 one. See `convex/rbac.ts`.
 */
export type Permission = AnyPermission;

export {
  ALL_PERMISSIONS,
  BRANCH_SCOPED_ROLES,
  LEGACY_ROLE_MAP,
  OWNER_ROLE,
  PLATFORM_ONLY_PERMISSIONS,
  PLATFORM_ROLES,
  roleFromLegacyRoles,
  normalizeBusinessRole,
};
export type {
  BusinessRole,
  PlatformRole,
  RoleId,
  Permission as CanonicalPermission,
} from "./rbac";

/**
 * The full permission set of every role.
 *
 * Exposed for the settings screen ("what can this role do?") and for the
 * permission tests.
 */
export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = (() => {
  const out = {} as Record<RoleId, Permission[]>;
  for (const role of [...PLATFORM_ROLES, ...BUSINESS_ROLES] as RoleId[]) {
    out[role] = effectivePermissions(role);
  }
  return out;
})();

/** True when the role grants the permission. */
export function roleHasPermission(role: string, permission: Permission): boolean {
  return rbacRoleHasPermission(role, permission);
}

/* ────────────────────────────────────────────────────────────────────────
 * Identity
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The authenticated caller.
 *
 * Throws when there is no verified identity — an anonymous request is never
 * allowed to reach tenant data.
 */
export async function requireIdentity(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError(
      "Unauthorized: you must be signed in to access business data."
    );
  }
  return identity;
}

/**
 * The session id carried by the access token, when there is one.
 *
 * The Next.js server mints the token from the HttpOnly session cookie and
 * stamps the session it belongs to into the `sid` claim. Tokens minted
 * without one are API tokens and are not session-bound.
 */
function sessionIdFromIdentity(identity: {
  [key: string]: unknown;
}): string | undefined {
  const sid = identity.sid ?? identity.sessionId;
  return typeof sid === "string" && sid.length > 0 ? sid : undefined;
}

/**
 * The session secret carried by the access token, when there is one.
 */
function sessionSecretFromIdentity(identity: {
  [key: string]: unknown;
}): string | undefined {
  const secret = identity.ses ?? identity.sessionSecret;
  return typeof secret === "string" && secret.length > 0 ? secret : undefined;
}

/**
 * The `users` document of the caller.
 *
 * The document id comes from the signed token's subject, never from an
 * argument, so a caller can only ever act as themselves.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);

  let user: Doc<"users"> | null = null;
  try {
    user = await ctx.db.get(identity.subject as UserId);
  } catch {
    user = null;
  }
  if (!user) {
    throw new ConvexError("Unauthorized: your account no longer exists.");
  }
  if (user.status === "suspended") {
    throw new ConvexError("Forbidden: your account has been suspended.");
  }
  if (user.status === "pending_verification") {
    throw new ConvexError(
      "Forbidden: verify your email address before using the application."
    );
  }

  // Session binding. A token minted for a session that has since been
  // signed out or revoked must stop working immediately — the 15-minute
  // token lifetime is the outer bound, not the revocation guarantee.
  const sessionId = sessionIdFromIdentity(identity);
  if (sessionId) {
    await assertSessionLive(ctx, sessionId, user._id, sessionSecretFromIdentity(identity));
  }

  return user;
}

/**
 * Assert that the session behind the token is still live.
 *
 * Three things are checked: the session exists, it has not been revoked,
 * and it has not expired. When the token also carries the session secret,
 * the secret is checked against the hash the server stored — so knowing a
 * session id is not enough to use it.
 */
async function assertSessionLive(
  ctx: Ctx,
  sessionId: string,
  userId: UserId,
  sessionSecret?: string
): Promise<void> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();

  if (!sessions || sessions.userId !== userId) {
    throw new ConvexError(
      "Unauthorized: this session is no longer valid. Please sign in again."
    );
  }
  if (sessions.revokedAt) {
    throw new ConvexError(
      "Unauthorized: this session was signed out. Please sign in again."
    );
  }
  if (sessions.expiresAt <= Date.now()) {
    throw new ConvexError(
      "Unauthorized: this session has expired. Please sign in again."
    );
  }

  if (sessionSecret && sessions.secretHash) {
    const hash = await sha256Hex(sessionSecret);
    if (!safeEqual(hash, sessions.secretHash)) {
      throw new ConvexError(
        "Unauthorized: this session could not be verified. Please sign in again."
      );
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Platform roles
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The caller's platform role, if they hold one.
 *
 * Platform roles live in `platformAdmins`, not on the user record, so a
 * business administrator can never grant themselves one.
 */
export async function findPlatformRole(
  ctx: Ctx,
  userId: UserId
): Promise<PlatformRole | null> {
  const admins = await ctx.db
    .query("platformAdmins")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  for (const admin of admins) {
    if ((admin.status ?? "active") !== "active") continue;
    if ((PLATFORM_ROLES as readonly string[]).includes(admin.role)) {
      return admin.role as PlatformRole;
    }
  }
  return null;
}

/**
 * Assert the caller holds one of the given platform roles.
 *
 * This is the only door into platform-wide operations. It deliberately
 * does **not** fall back to business membership: owning a business never
 * confers platform authority.
 */
export async function requirePlatformRole(
  ctx: Ctx,
  roles: PlatformRole[]
): Promise<{ user: Doc<"users">; role: PlatformRole }> {
  const user = await requireUser(ctx);
  const role = await findPlatformRole(ctx, user._id);
  if (!role) {
    throw new ConvexError(
      "Forbidden: this action requires platform administrator privileges."
    );
  }
  if (!roles.includes(role)) {
    throw new ConvexError(
      "Forbidden: your platform role (" +
        role +
        ") is not allowed to perform this action."
    );
  }
  return { user, role };
}

/**
 * Assert the caller holds a platform role that grants `permission`.
 *
 * `subscriptions.manage` is the platform's write permission. It is held
 * by `platform_super_admin` and by nobody else, so this is the single
 * gate behind every platform-wide mutation.
 */
export async function requirePlatformPermission(
  ctx: Ctx,
  permission: Permission
): Promise<{ user: Doc<"users">; role: PlatformRole }> {
  const actor = await requirePlatformRole(ctx, [
    "platform_super_admin",
    "platform_support",
  ]);
  if (!rbacRoleHasPermission(actor.role, permission)) {
    throw new ConvexError(
      `Forbidden: your platform role (${actor.role}) cannot ${permission.replace(
        /\./g,
        " "
      )}.`
    );
  }
  return actor;
}

/* ────────────────────────────────────────────────────────────────────────
 * Membership
 * ──────────────────────────────────────────────────────────────────────── */

/** The caller's membership in a business, or null. */
export async function findMembership(
  ctx: Ctx,
  userId: UserId,
  businessId: BusinessId
): Promise<Doc<"memberships"> | null> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_businessId_userId", (q) =>
      q.eq("businessId", businessId).eq("userId", userId)
    )
    .unique();
  if (!membership) return null;
  if ((membership.status ?? "active") !== "active") return null;
  return membership;
}

/** Every active membership of a user, across all businesses. */
export async function listUserMemberships(
  ctx: Ctx,
  userId: UserId
): Promise<Doc<"memberships">[]> {
  const all = await ctx.db
    .query("memberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  return all.filter((m) => (m.status ?? "active") === "active");
}

/**
 * Assert the caller is a member of `businessId`.
 *
 * Throws "Forbidden" when they are not — deliberately *not* a silent
 * fallback, because a silent fallback is how a tampered client ends up
 * writing into the wrong tenant.
 */
export async function requireMembership(
  ctx: Ctx,
  businessId: BusinessId,
  userId?: UserId
): Promise<Doc<"memberships">> {
  const callerId = userId ?? (await requireUser(ctx))._id;
  const membership = await findMembership(ctx, callerId, businessId);
  if (!membership) {
    throw new ConvexError(
      "Forbidden: you do not have access to this business."
    );
  }
  return membership;
}

/** Assert the caller holds one of `roles` in `businessId`. */
export async function requireRole(
  ctx: Ctx,
  businessId: BusinessId,
  roles: string[]
): Promise<Doc<"memberships">> {
  const membership = await requireMembership(ctx, businessId);
  const held = normalizeBusinessRole(membership.role);
  const accepted = roles.map((role) =>
    role === OWNER_ROLE ? OWNER_ROLE : normalizeBusinessRole(role)
  );
  if (!accepted.includes(held)) {
    throw new ConvexError(
      "Forbidden: this action requires one of the following roles: " +
        roles.join(", ") +
        "."
    );
  }
  return membership;
}

/* ────────────────────────────────────────────────────────────────────────
 * Effective permissions (role defaults + custom grants)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The permissions a member holds inside a business.
 *
 * Three layers, in order:
 *  1. the role's canonical + legacy defaults (`convex/rbac.ts`);
 *  2. custom grants and denials attached to the *role* in this business;
 *  3. custom grants and denials attached to the *member* in this business.
 *
 * Denials win over grants. A denial can never strip a platform-only
 * permission (those are not held in business scope anyway) and never
 * applies to the business owner.
 */
export async function resolveMemberPermissions(
  ctx: Ctx,
  businessId: BusinessId,
  membership: Doc<"memberships">
): Promise<Set<Permission>> {
  const role = normalizeBusinessRole(membership.role);
  const effective = new Set<Permission>(effectivePermissions(role));

  const roleOverrides = await ctx.db
    .query("customRolePermissions")
    .withIndex("by_businessId_role", (q) =>
      q.eq("businessId", businessId).eq("role", role)
    )
    .unique();

  if (roleOverrides) {
    for (const permission of sanitizePermissionList(roleOverrides.granted ?? [])) {
      if (!isPlatformOnlyPermission(permission)) effective.add(permission);
    }
    for (const permission of sanitizePermissionList(roleOverrides.denied ?? [])) {
      if (role !== OWNER_ROLE && !isPlatformOnlyPermission(permission)) {
        effective.delete(permission);
      }
    }
  }

  const memberOverrides = await ctx.db
    .query("memberPermissionOverrides")
    .withIndex("by_businessId_userId", (q) =>
      q.eq("businessId", businessId).eq("userId", membership.userId)
    )
    .unique();

  if (memberOverrides) {
    for (const permission of sanitizePermissionList(memberOverrides.granted ?? [])) {
      if (!isPlatformOnlyPermission(permission)) effective.add(permission);
    }
    for (const permission of sanitizePermissionList(memberOverrides.denied ?? [])) {
      if (role !== OWNER_ROLE && !isPlatformOnlyPermission(permission)) {
        effective.delete(permission);
      }
    }
  }

  return effective;
}

/**
 * Assert the caller's role grants `permission` in `businessId`.
 *
 * This is the enforcement point every handler should use. The decision is
 * made on the server from the caller's membership and the business's
 * custom grants — never from anything the browser sent.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The subscription gate
 * ────────────────────────────────────────────────────────────────────────
 *
 * When the permission **writes** something, the business's subscription is
 * checked as well. A suspended, expired or cancelled subscription may still
 * be *read* — the owner has to be able to see their data and their invoice
 * — but nothing new may be recorded.
 *
 * The check lives here because this is the one place every mutation passes
 * through. A handler that forgets to call a subscription guard therefore
 * cannot accidentally write while the subscription is closed.
 *
 * Nothing is ever deleted when a subscription ends. The data stays; the
 * writing stops.
 */
export async function requirePermission(
  ctx: Ctx,
  businessId: BusinessId,
  permission: Permission
): Promise<Doc<"memberships">> {
  const membership = await requireMembership(ctx, businessId);
  const effective = await resolveMemberPermissions(ctx, businessId, membership);

  if (!effective.has(permission)) {
    throw new ConvexError(
      `Forbidden: your role (${membership.role}) cannot ${permission.replace(
        /\./g,
        " "
      )}.`
    );
  }

  if (isWritePermission(permission)) {
    await assertSubscriptionWritable(ctx, businessId);
  }

  return membership;
}

/* ────────────────────────────────────────────────────────────────────────
 * Tenant resolution
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Work out which business the caller is operating in.
 *
 * Resolution order:
 *  1. `requestedBusinessId` — accepted only if the caller is an active
 *     member of it. A request for somebody else's business is a hard
 *     error, not a fallback.
 *  2. The caller's active business (`users.activeBusinessId`), when they
 *     are still a member of it.
 *  3. Their only active membership.
 *  4. Otherwise the caller has to pick a business (the UI shows a
 *     business switcher).
 */
export async function resolveBusinessId(
  ctx: Ctx,
  requestedBusinessId?: BusinessId
): Promise<BusinessId> {
  const user = await requireUser(ctx);

  if (requestedBusinessId) {
    await requireMembership(ctx, requestedBusinessId, user._id);
    return requestedBusinessId;
  }

  if (user.activeBusinessId) {
    const membership = await findMembership(ctx, user._id, user.activeBusinessId);
    if (membership) return user.activeBusinessId;
  }

  const memberships = await listUserMemberships(ctx, user._id);
  if (memberships.length === 1) return memberships[0].businessId;
  if (memberships.length > 1) {
    throw new ConvexError(
      "No business selected. Choose the business you want to work in."
    );
  }
  throw new ConvexError(
    "You do not belong to any business yet. Register a business or ask for an invitation."
  );
}

/** The full tenant context for a request. */
export interface TenantContext {
  user: Doc<"users">;
  membership: Doc<"memberships">;
  business: Doc<"businesses">;
  businessId: BusinessId;
  /** The permissions the caller holds in this business. */
  permissions: Set<Permission>;
}

/**
 * Resolve the tenant and load the business record.
 *
 * This is the function most handlers should call: it gives the caller,
 * their membership (role + status), their effective permissions and the
 * business settings (currency, timezone, tax configuration) in one step.
 */
export async function requireTenant(
  ctx: Ctx,
  requestedBusinessId?: BusinessId
): Promise<TenantContext> {
  const user = await requireUser(ctx);
  const businessId = await resolveBusinessId(ctx, requestedBusinessId);
  const membership = await requireMembership(ctx, businessId, user._id);
  const business = await ctx.db.get(businessId);
  if (!business) {
    throw new ConvexError("Forbidden: this business no longer exists.");
  }
  if (business.status === "suspended") {
    throw new ConvexError(
      "Forbidden: this business is suspended. Contact the account owner."
    );
  }
  const permissions = await resolveMemberPermissions(ctx, businessId, membership);
  return { user, membership, business, businessId, permissions };
}

/* ────────────────────────────────────────────────────────────────────────
 * Branch restrictions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The branches a member may work in, or `undefined` for "all branches".
 *
 * - A member with an explicit `branchIds` list is confined to it.
 * - A branch manager with no explicit list is confined to the branches
 *   they manage — so they can never reach somebody else's branch.
 * - Every other role reaches every branch of their business.
 */
export async function allowedBranchIds(
  ctx: Ctx,
  membership: Doc<"memberships">
): Promise<BranchId[] | undefined> {
  const explicit = membership.branchIds ?? [];
  if (explicit.length > 0) return explicit;

  const role = normalizeBusinessRole(membership.role);
  if (BRANCH_SCOPED_ROLES.includes(role)) {
    const managed = await ctx.db
      .query("branches")
      .withIndex("by_businessId", (q) =>
        q.eq("businessId", membership.businessId)
      )
      .collect();
    return managed.filter((b) => b.managerId === membership.userId).map((b) => b._id);
  }

  return undefined;
}

/**
 * Assert the caller may act on `branchId`.
 *
 * Branch managers are stopped here: they may only touch the branches they
 * are responsible for.
 */
export async function requireBranchAccess(
  ctx: Ctx,
  membership: Doc<"memberships">,
  branchId: BranchId | undefined | null
): Promise<void> {
  if (!branchId) return;

  const allowed = await allowedBranchIds(ctx, membership);
  if (!allowed) return; // unrestricted within the business

  if (!allowed.includes(branchId)) {
    throw new ConvexError(
      "Forbidden: you do not have access to this branch."
    );
  }
}

/**
 * Filter a list of branch ids down to the ones the caller may see.
 */
export async function filterBranchIds(
  ctx: Ctx,
  membership: Doc<"memberships">,
  branchIds: BranchId[]
): Promise<BranchId[]> {
  const allowed = await allowedBranchIds(ctx, membership);
  if (!allowed) return branchIds;
  return branchIds.filter((id) => allowed.includes(id));
}

/* ────────────────────────────────────────────────────────────────────────
 * Document-level guards
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Assert that a document belongs to the tenant.
 *
 * Used when a document is reached by id (e.g. `ctx.db.get(args.saleId)`).
 * Without this check a caller could pass somebody else's id and read or
 * write it.
 */
export function assertSameBusiness(
  businessId: BusinessId,
  document: { businessId?: BusinessId | null } | null,
  what = "record"
): void {
  if (!document) {
    throw new ConvexError("Forbidden: that " + what + " does not exist.");
  }
  if (document.businessId !== businessId) {
    throw new ConvexError("Forbidden: that " + what + " belongs to another business.");
  }
}

/**
 * Load a document by id and assert it belongs to the tenant.
 */
export async function loadTenantDocument<T extends { businessId?: BusinessId | null }>(
  ctx: Ctx,
  table: string,
  id: Id<any>,
  businessId: BusinessId,
  what = "record"
): Promise<T> {
  let document: T | null = null;
  try {
    document = (await (ctx.db as any).get(id)) as T | null;
  } catch {
    document = null;
  }
  assertSameBusiness(businessId, document, what);
  return document as T;
}

/* ────────────────────────────────────────────────────────────────────────
 * Small utilities used by the handlers
 * ──────────────────────────────────────────────────────────────────────── */

/** The caller's display name, for audit trails. */
export function actorName(user: Doc<"users">): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
}

/**
 * Write an audit trail entry. Tenant-scoped, so an audit log can never
 * leak across businesses.
 */
export async function logActivity(
  ctx: MutationCtx,
  businessId: BusinessId,
  userId: UserId,
  action: string,
  details: string
): Promise<void> {
  await ctx.db.insert("activityLogs", {
    businessId,
    userId,
    action,
    details,
    timestamp: new Date().toISOString(),
  });
}

/** Create a URL-safe slug from a business name. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
