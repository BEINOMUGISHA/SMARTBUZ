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

    let rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_businessId_timestamp", (q) =>
        q.eq("businessId", businessId)
      )
      .collect();

    if (args.action) rows = rows.filter((r) => r.action === args.action);
    if (args.actorUserId) {
      rows = rows.filter((r) => r.actorUserId === args.actorUserId);
    }
    if (args.since) {
      rows = rows.filter((r) => r.timestamp >= args.since!);
    }

    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const cursor = Number(args.paginationOpts.cursor) || 0;
    const start = cursor * args.paginationOpts.numItems;
    const page = rows.slice(start, start + args.paginationOpts.numItems);

    return {
      page,
      isDone: start + args.paginationOpts.numItems >= rows.length,
      continueCursor: String(cursor + 1),
      totalCount: rows.length,
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

    let rows = await ctx.db.query("auditLogs").collect();
    rows = rows.filter((r) => r.businessId === undefined);

    if (args.action) rows = rows.filter((r) => r.action === args.action);
    if (args.actorUserId) {
      rows = rows.filter((r) => r.actorUserId === args.actorUserId);
    }
    if (args.since) rows = rows.filter((r) => r.timestamp >= args.since!);

    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const cursor = Number(args.paginationOpts.cursor) || 0;
    const start = cursor * args.paginationOpts.numItems;
    const page = rows.slice(start, start + args.paginationOpts.numItems);

    return {
      page,
      isDone: start + args.paginationOpts.numItems >= rows.length,
      continueCursor: String(cursor + 1),
      totalCount: rows.length,
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
