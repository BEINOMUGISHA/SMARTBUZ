import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePlatformPermission } from "./tenancy";
import { writeAudit } from "./audit";
import { hmacSha256Hex, randomKeyString } from "./crypto";
import { serverSecretValue } from "./serverSecret";
import { resolvePlan } from "./entitlements";

/**
 * SMARTBUZ — license keys.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The key is never stored
 * ────────────────────────────────────────────────────────────────────────
 *
 * A license key is shown to the customer **once** and never again. What is
 * written to the database is a keyed hash of it — HMAC-SHA256 with the
 * server's secret — plus the last few characters so that a person can
 * recognise their own key.
 *
 * That means a copy of the database is not a copy of the licences. The
 * attacker would need the server's secret as well as the database, and the
 * key has 125 bits of entropy, so guessing is not an option either.
 *
 * The hash is computed the same way wherever a key is checked, so it is
 * done in one place: `hashLicenseKey`.
 */

/** The visible part of every SMARTBUZ license key. */
export const LICENSE_KEY_PREFIX = "SBUZ";

/** How many characters in each group of a license key. */
const GROUP_LENGTH = 5;

/** How many groups in a license key. */
const GROUP_COUNT = 5;

/**
 * The hash of a license key.
 *
 * The key is upper-cased and trimmed first, so that a key typed in with
 * the wrong case still matches.
 */
export async function hashLicenseKey(key: string): Promise<string> {
  return await hmacSha256Hex(serverSecretValue(), key.trim().toUpperCase());
}

/**
 * Make a new license key.
 *
 * The format is `SBUZ-XXXXX-XXXXX-XXXXX-XXXXX`. The alphabet leaves out
 * `0`, `O`, `1` and `I`, because a key that is read off a screen and typed
 * in by a person must not be misread.
 */
export function generateLicenseKey(): string {
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(randomKeyString(GROUP_LENGTH));
  }
  return `${LICENSE_KEY_PREFIX}-${groups.join("-")}`;
}

/** The last few characters, so the owner can recognise their own key. */
export function keyHint(key: string): string {
  return key.slice(-5);
}

/**
 * Issue a license key.
 *
 * The key is returned **once**, in this response. It is not recoverable
 * afterwards — only its hash was kept.
 *
 * A key may be issued against a particular business, or unbound, for a
 * customer who has not registered yet. An unbound key binds itself to
 * whichever business redeems it first.
 */
export const issue = mutation({
  args: {
    planKey: v.string(),
    businessId: v.optional(v.id("businesses")),
    /** How long the key is valid for. Leave it out for no expiry. */
    expiresAt: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformPermission(ctx, "subscriptions.manage");

    const plan = await resolvePlan(ctx, args.planKey);
    if (!plan) {
      throw new ConvexError(`There is no plan called "${args.planKey}".`);
    }

    if (args.businessId) {
      const business = await ctx.db.get(args.businessId);
      if (!business) throw new ConvexError("That business does not exist.");
    }

    const key = generateLicenseKey();
    const hash = await hashLicenseKey(key);
    const now = new Date().toISOString();

    const licenseId = await ctx.db.insert("licenseKeys", {
      businessId: args.businessId,
      planKey: args.planKey,
      keyHash: hash,
      keyHint: keyHint(key),
      keyPrefix: LICENSE_KEY_PREFIX,
      status: "active",
      issuedAt: now,
      expiresAt: args.expiresAt,
      useCount: 0,
      createdAt: now,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.license.issue",
      targetType: "license_key",
      targetId: licenseId,
      metadata: {
        planKey: args.planKey,
        businessId: args.businessId,
        keyHint: keyHint(key),
        note: args.note,
      },
    });

    // The one and only time the key is readable.
    return { licenseId, key, keyHint: keyHint(key) };
  },
});

/**
 * Revoke a license key.
 *
 * A revoked key cannot be redeemed again. It is never deleted, so the
 * record of what was issued and when it was stopped stays readable.
 */
export const revoke = mutation({
  args: {
    licenseId: v.id("licenseKeys"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformPermission(ctx, "subscriptions.manage");

    const license = await ctx.db.get(args.licenseId);
    if (!license) throw new ConvexError("That license key does not exist.");
    if (license.status === "revoked") {
      return { licenseId: license._id, changed: false };
    }

    await ctx.db.patch(license._id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
      revokedBy: actor.user._id,
      revocationReason: args.reason,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.license.revoke",
      targetType: "license_key",
      targetId: license._id,
      metadata: { keyHint: license.keyHint, reason: args.reason },
    });

    return { licenseId: license._id, changed: true };
  },
});

/**
 * The license keys of a business, or of the whole platform.
 */
export const listKeys = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformPermission(ctx, "subscriptions.view");

    const keys = await ctx.db.query("licenseKeys").collect();

    let visible = keys;
    if (args.businessId) {
      visible = visible.filter((k) => k.businessId === args.businessId);
    }
    if (args.status) {
      visible = visible.filter((k) => k.status === args.status);
    }

    visible.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

    const rows: any[] = [];
    for (const k of visible) {
      const business = k.businessId ? await ctx.db.get(k.businessId) : null;
      rows.push({
        _id: k._id,
        businessId: k.businessId,
        businessName: business?.name,
        planKey: k.planKey,
        keyHint: k.keyHint,
        keyPrefix: k.keyPrefix,
        status: k.status,
        issuedAt: k.issuedAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
        revocationReason: k.revocationReason,
        lastUsedAt: k.lastUsedAt,
        useCount: k.useCount ?? 0,
      });
    }

    return rows;
  },
});

/**
 * Check a license key without redeeming it.
 *
 * For the support desk: "is this key real, and has it been used?"
 */
export const inspect = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await requirePlatformPermission(ctx, "subscriptions.view");

    const hash = await hashLicenseKey(args.key);
    const license = await ctx.db
      .query("licenseKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", hash))
      .unique();

    if (!license) return { found: false as const };

    const business = license.businessId
      ? await ctx.db.get(license.businessId)
      : null;

    return {
      found: true as const,
      licenseId: license._id,
      businessId: license.businessId,
      businessName: business?.name,
      planKey: license.planKey,
      keyHint: license.keyHint,
      status: license.status,
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
      lastUsedAt: license.lastUsedAt,
      useCount: license.useCount ?? 0,
    };
  },
});
