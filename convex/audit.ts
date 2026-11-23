/**
 * SMARTBUZ — security audit trail.
 *
 * `activityLogs` is the business-scoped feed of ordinary events ("added
 * 40 units of Blue Band"). This module is the *security* trail: the
 * privileged actions that decide who can do what, and who was on the other
 * end of a sign-in.
 *
 * Rules
 * ─────
 *  1. **Append-only.** There is no mutation in this file that edits or
 *     deletes an audit row. The trail is written in one place and read in
 *     another.
 *  2. **Tenant-scoped.** A business audit trail never contains another
 *     business's rows. Platform-scope events carry no `businessId` at all
 *     and are readable only by platform administrators.
 *  3. **Redacted.** Secrets — passwords, codes, tokens, hashes — are
 *     stripped from metadata before anything is written.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  type BusinessId,
  type Permission,
  type UserId,
  findPlatformRole,
  requireTenant,
  resolveMemberPermissions,
} from "./tenancy";

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/** Metadata keys whose values must never be written to the trail. */
const REDACTED_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "passwordhash",
  "code",
  "codehash",
  "secret",
  "token",
  "accesstoken",
  "sessionsecret",
  "privatekey",
  "apikey",
]);

/**
 * Remove secrets from a metadata payload.
 *
 * The audit trail is read by auditors, exported to CSV and kept for a long
 * time. A leaked reset code or password hash in there would be a second
 * vulnerability.
 */
export function redactMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 2000) {
      out[key] = value.slice(0, 2000) + "…";
      continue;
    }
    out[key] = value;
  }
  return out;
}

export interface AuditEntry {
  /** Absent for platform-scope events. */
  businessId?: BusinessId;
  actorUserId?: UserId;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  outcome?: "success" | "denied";
  ip?: string;
  userAgent?: string;
}

/**
 * Append an entry to the security trail.
 *
 * Never throws: an audit failure must not roll back the business action
 * that was being recorded, but it is surfaced in the server log so the
 * gap is visible.
 */
export async function writeAudit(
  ctx: MutationCtx,
  entry: AuditEntry
): Promise<void> {
  try {
    await ctx.db.insert("auditLogs", {
      businessId: entry.businessId,
      // Which trail this entry belongs to. It is written on every row so
      // that the platform trail can be read from an index — Convex leaves a
      // document out of an index when the indexed field is missing, and a
      // platform row has no business.
      scope: entry.businessId ? "tenant" : "platform",
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: redactMetadata(entry.metadata),
      outcome: entry.outcome ?? "success",
      ip: entry.ip,
      userAgent: entry.userAgent,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("SMARTBUZ: failed to write an audit entry:", err);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Who may read the audit trail of a business.
 *
 * Owners and administrators see everything. Auditors and accountants see
 * it too — reading the trail is their job. Everyone else does not.
 */
const AUDIT_VIEWER_ROLES = [
  "business_owner",
  "business_admin",
  "auditor",
  "accountant",
];

async function requireAuditAccess(
  ctx: QueryCtx | MutationCtx,
  businessId?: BusinessId
): Promise<{ businessId: BusinessId; viewer: Doc<"users"> }> {
  const tenant = await requireTenant(ctx, businessId);
  const permissions: Set<Permission> = await resolveMemberPermissions(
    ctx,
    tenant.businessId,
    tenant.membership
  );

  const isViewerRole = AUDIT_VIEWER_ROLES.includes(tenant.membership.role);
  const hasSettings = permissions.has("settings.manage");

  if (!isViewerRole && !hasSettings) {
    throw new ConvexError(
      "Forbidden: only the owner, an administrator, an accountant or an auditor may read the audit trail."
    );
  }

  return { businessId: tenant.businessId, viewer: tenant.user };
}

/**
 * The audit trail of the caller's business, newest first.
 *
 * The trail is read a page at a time, and the page is narrowed *before* it
 * is read: the action, the actor and the date are all index ranges, not
 * filters applied to everything that has ever happened. Reading the whole
 * trail and throwing away all but one page meant that the cost of a page
 * of twenty rows grew with the tenant's entire history.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    businessId: v.optional(v.id("businesses")),
    action: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    since: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { businessId } = await requireAuditAccess(ctx, args.businessId);

    // The narrowest index that carries every filter that was given wins.
    // The others are applied as filters, which the server applies before
    // it takes the page.
    let query;
    if (args.action) {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_businessId_action_timestamp", (q) =>
          q.eq("businessId", businessId).eq("action", args.action!)
        );
    } else if (args.actorUserId) {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_businessId_actorUserId_timestamp", (q) =>
          q.eq("businessId", businessId).eq("actorUserId", args.actorUserId!)
        );
    } else {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_businessId_timestamp", (q) =>
          q.eq("businessId", businessId)
        );
    }

    if (args.action && args.actorUserId) {
      query = query.filter((q) => q.eq(q.field("actorUserId"), args.actorUserId!));
    }
    if (args.since) {
      query = query.filter((q) => q.gte(q.field("timestamp"), args.since!));
    }

    const result = await query.order("desc").paginate(args.paginationOpts);

    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * The platform-scope audit trail.
 *
 * Only platform administrators may read it. Platform Support included —
 * diagnosing an incident is exactly what they are for — but it is a
 * platform trail, so it carries no business data beyond what the action
 * itself recorded.
 */
export const listPlatform = query({
  args: {
    paginationOpts: paginationOptsValidator,
    action: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    since: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireTenantUser(ctx);
    const role = await findPlatformRole(ctx, user._id);
    if (!role) {
      throw new ConvexError(
        "Forbidden: only platform administrators may read the platform audit trail."
      );
    }

    // The platform trail is read from the scope index, so a page of it
    // costs a page — not the whole table. It used to read every audit row
    // in the deployment and then throw away every row that belonged to a
    // business.
    let query;
    if (args.action) {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_scope_action_timestamp", (q) =>
          q.eq("scope", "platform").eq("action", args.action!)
        );
    } else if (args.actorUserId) {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_scope_actorUserId_timestamp", (q) =>
          q.eq("scope", "platform").eq("actorUserId", args.actorUserId!)
        );
    } else {
      query = ctx.db
        .query("auditLogs")
        .withIndex("by_scope_timestamp", (q) => q.eq("scope", "platform"));
    }

    if (args.action && args.actorUserId) {
      query = query.filter((q) => q.eq(q.field("actorUserId"), args.actorUserId!));
    }
    if (args.since) {
      query = query.filter((q) => q.gte(q.field("timestamp"), args.since!));
    }

    const result = await query.order("desc").paginate(args.paginationOpts);

    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Small helper so the platform query can identify the caller without
 * resolving a tenant (a platform administrator may belong to no business
 * at all).
 */
async function requireTenantUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthorized: you must be signed in.");
  }
  let user: Doc<"users"> | null = null;
  try {
    user = await ctx.db.get(identity.subject as UserId);
  } catch {
    user = null;
  }
  if (!user) throw new ConvexError("Unauthorized: your account no longer exists.");
  return user;
}
