/**
 * SMART_BUZ — the multi-tenant migration.
 *
 * Runs once against a deployment that still holds single-tenant data and
 * turns it into multi-tenant data **without losing anything**:
 *
 *  1. Every legacy `businessProfiles` row becomes a `businesses` row, field
 *     for field (name, vertical, currency, tax settings, address, plan …).
 *  2. The owner of each profile gets an `owner` membership; every other
 *     user gets a membership in the primary business, with the role their
 *     legacy `users.roles` array implied.
 *  3. Every tenant-owned row — sales, stock, customers, promotions, loans,
 *     payments, expenses, shops, stock entries, ledger entries, audit logs,
 *     invoice counters and the vertical tables — is stamped with the
 *     business it belonged to.
 *  4. Legacy rows that referenced `businessProfileId` (the vertical
 *     tables) are re-pointed at the new `businesses` id.
 *
 * Safety rules
 * ─────────────
 *  • **Nothing is deleted.** The legacy `businessProfiles` rows are left in
 *    place (the table is deprecated but still in the schema) so the migration
 *    can be inspected, and re-running the script is safe.
 *  • **Nothing is overwritten.** A row that already carries a `businessId`
 *    keeps it. Only rows that have no tenant pointer at all — the legacy
 *    global rows — are stamped. Running the migration on a deployment that
 *    already holds multi-tenant data therefore cannot collapse two tenants
 *    into one.
 *  • **Only the server may run it.** The caller must present the
 *    server-to-backend secret (`SMARTBUZ_SERVER_SECRET`) in addition to
 *    holding an owner or admin role in a business. A browser cannot obtain
 *    the secret, so a tenant administrator can no longer rewrite the
 *    deployment — the migration is a deployment-time operation, run from
 *    `scripts/migrate-to-multitenancy.mjs`, and it must stay that way.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { roleFromLegacyRoles } from "./tenancy";
import { serverSecretMatches } from "./serverSecret";

type Ctx = MutationCtx | QueryCtx;

/** Legacy tenant tables whose rows carry no tenant pointer at all. */
const GLOBAL_TABLES = [
  "categories",
  "stocks",
  "customers",
  "promotions",
  "promotionProducts",
  "promotionRedemptions",
  "sales",
  "loans",
  "payments",
  "expenses",
  "shops",
  "stockEntries",
  "shopIssueRecords",
  "stockLedger",
  "banking",
  "activityLogs",
  "counters",
] as const;

/** Vertical tables that carry the deprecated `businessProfileId` pointer. */
const VERTICAL_TABLES = [
  "productBatches",
  "appointments",
  "serviceOutlets",
  "menuItems",
  "members",
  "memberTransactions",
  "customerWallets",
  "walletTransactions",
  "serviceTickets",
  "staffCommissions",
  "assets",
  "suppliers",
  "purchaseOrders",
  "goodsReceipts",
  "deliveries",
  "fuelDispenses",
  "vehicles",
  "classEnrolments",
  "attendance",
  "tillSessions",
  "donations",
  "tableOrders",
  "recurringCharges",
  "productSerials",
  "customerMeasurements",
  "productionBatches",
  "rentals",
  "routeFares",
  "categorySettings",
] as const;

/**
 * The operator running the migration.
 *
 * Two things must be true, and the server decides both:
 *
 *  1. The caller holds the server-to-backend secret. A browser never has it,
 *     so this is what keeps the migration a deployment-time operation.
 *  2. The caller is an owner or an administrator of a business, or holds the
 *     legacy `admin`/`settings` role on their user document.
 *
 * The second check on its own is not enough: a *tenant* owner satisfies it,
 * and a tenant owner must never be able to rewrite another tenant's data.
 */
async function requireMigrationOperator(
  ctx: Ctx,
  serverSecret: string | undefined
): Promise<Doc<"users">> {
  if (!serverSecretMatches(serverSecret)) {
    throw new ConvexError(
      "Forbidden: the migration can only be run by the SMARTBUZ server. " +
        "Run scripts/migrate-to-multitenancy.mjs instead of calling this from a browser."
    );
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError(
      "Unauthorized: the migration must be run by a signed-in administrator."
    );
  }

  let user: Doc<"users"> | null = null;
  try {
    user = await ctx.db.get(identity.subject as Id<"users">);
  } catch {
    user = null;
  }
  if (!user) {
    throw new ConvexError("Unauthorized: your account no longer exists.");
  }

  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_userId", (q) => q.eq("userId", user!._id))
    .collect();
  const isBusinessAdmin = memberships.some(
    (m) =>
      (m.status ?? "active") === "active" &&
      (m.role === "business_owner" ||
        m.role === "business_admin" ||
        m.role === "owner" ||
        m.role === "admin")
  );
  const isLegacyAdmin = (user.roles ?? []).some(
    (r) => r === "admin" || r === "settings"
  );

  if (!isBusinessAdmin && !isLegacyAdmin) {
    throw new ConvexError(
      "Forbidden: only an owner or administrator of a business can run the migration."
    );
  }
  return user;
}

/**
 * Work out which business the legacy data belongs to.
 *
 *  1. An explicitly requested business.
 *  2. The business that the operator's own legacy profile became — this is
 *     the common case: the person running the migration is the person who
 *     created the business profile.
 *  3. A business the operator owns.
 *
 * There is deliberately **no** "first business that has an owner" fallback.
 * That fallback let the migration pick a business that had nothing to do
 * with the operator, which is how a deployment-wide write could land inside
 * somebody else's tenant. When nothing matches, the migration stops and says
 * so; the operator names the business explicitly.
 */
async function resolveTargetBusiness(
  ctx: Ctx,
  requestedBusinessId: Id<"businesses"> | undefined,
  legacyToBusiness: Map<string, Id<"businesses">>,
  operatorId: Id<"users">
): Promise<Doc<"businesses">> {
  const businesses = await ctx.db.query("businesses").collect();
  if (businesses.length === 0) {
    throw new ConvexError(
      "No businesses found. Run migrateBusinessProfiles first."
    );
  }

  if (requestedBusinessId) {
    const requested = businesses.find((b) => b._id === requestedBusinessId);
    if (!requested) {
      throw new ConvexError("Forbidden: that business does not exist.");
    }
    return requested;
  }

  const profiles = await ctx.db.query("businessProfiles").collect();
  for (const profile of profiles) {
    if (profile.createdBy !== operatorId) continue;
    const businessId = legacyToBusiness.get(profile._id);
    const business = businesses.find((b) => b._id === businessId);
    if (business) return business;
  }

  const owned = businesses.find((b) => b.ownerId === operatorId);
  if (owned) return owned;

  throw new ConvexError(
    "No target business could be determined for this operator. " +
      "Pass businessId explicitly so the migration cannot land in a business " +
      "that has nothing to do with you."
  );
}

/** Legacy profile id → business id, from the mapping the caller passed in. */
async function buildLegacyMapping(
  ctx: Ctx,
  mapping: Record<string, string> | undefined
): Promise<Map<string, Id<"businesses">>> {
  const legacyToBusiness = new Map<string, Id<"businesses">>();
  if (mapping) {
    for (const [legacyId, businessId] of Object.entries(mapping)) {
      legacyToBusiness.set(legacyId, businessId as Id<"businesses">);
    }
    return legacyToBusiness;
  }

  // Fall back to matching by name.
  const profiles = await ctx.db.query("businessProfiles").collect();
  const businesses = await ctx.db.query("businesses").collect();
  for (const profile of profiles) {
    const business = businesses.find((b) => b.name === profile.businessName);
    if (business) legacyToBusiness.set(profile._id, business._id);
  }
  return legacyToBusiness;
}

/**
 * Copy the legacy business profiles into the new `businesses` table.
 *
 * Returns the mapping from legacy profile id to business id so the rest of
 * the migration can re-point the data.
 */
export const migrateBusinessProfiles = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireMigrationOperator(ctx, args.serverSecret);

    const profiles = await ctx.db.query("businessProfiles").collect();
    const existingBusinesses = await ctx.db.query("businesses").collect();

    // Match legacy profiles to existing businesses by name so a re-run does
    // not create duplicates.
    const byName = new Map(existingBusinesses.map((b) => [b.name, b]));
    const mapping: Record<string, Id<"businesses">> = {};
    let operatorBusinessId: Id<"businesses"> | undefined;

    for (const profile of profiles) {
      const existing = byName.get(profile.businessName);
      if (existing) {
        mapping[profile._id] = existing._id;
      } else {
        const owner = profile.createdBy;
        const businessId = await ctx.db.insert("businesses", {
          name: profile.businessName,
          slug: profile.businessName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48),
          categoryId: profile.categoryId,
          businessType: profile.businessType,
          industry: profile.industry,
          modules: profile.modules ?? [],
          currency: profile.currency ?? "UGX",
          currencySymbol: profile.currency,
          country: profile.country ?? "Uganda",
          timezone: "Africa/Kampala",
          taxEnabled: profile.taxEnabled,
          taxRate: profile.taxRate,
          taxInclusive: profile.taxInclusive,
          taxNote: profile.taxNote,
          tin: profile.tin,
          allowPriceOverrides: profile.allowPriceOverrides,
          openingFloat: profile.openingFloat,
          status: profile.isActive ? "active" : "suspended",
          ownerId: owner,
          createdBy: owner,
          createdAt: new Date().toISOString(),
          businessAddress: profile.businessAddress,
          businessPhone: profile.businessPhone,
          onboardingComplete: true,
          plan: profile.plan,
          subscriptionStatus: profile.subscriptionStatus,
          subscriptionExpiresAt: profile.subscriptionExpiresAt,
        });
        mapping[profile._id] = businessId;
      }

      // The business that the operator's own profile became — this is the
      // one the legacy data belongs to.
      if (!operatorBusinessId && profile.createdBy === operator._id) {
        operatorBusinessId = mapping[profile._id];
      }
    }

    return {
      profiles: profiles.length,
      businesses: Object.keys(mapping).length,
      mapping,
      operatorBusinessId: operatorBusinessId ?? null,
    };
  },
});

/**
 * Create the memberships that make the migrated data reachable.
 *
 * The profile owner becomes the owner; everybody else gets a membership in
 * the primary business with the role their legacy role array implied, so no
 * existing user loses access to the data they used to see.
 */
export const migrateMemberships = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    /** Legacy profile id → business id, as returned by migrateBusinessProfiles. */
    mapping: v.optional(v.record(v.string(), v.string())),
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireMigrationOperator(ctx, args.serverSecret);

    const legacyToBusiness = await buildLegacyMapping(ctx, args.mapping);
    const primary = await resolveTargetBusiness(
      ctx,
      args.businessId,
      legacyToBusiness,
      operator._id
    );

    const profiles = await ctx.db.query("businessProfiles").collect();
    const users = await ctx.db.query("users").collect();
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;

    for (const user of users) {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      // Already a member of the business we are migrating into.
      if (memberships.some((m) => m.businessId === primary._id)) continue;

      // Which business did this person belong to?
      let targetBusinessId: Id<"businesses"> | undefined;

      // 1. The owner of a legacy profile — they own it, so they get a
      //    membership in it even if they also run another business.
      for (const profile of profiles) {
        if (profile.createdBy === user._id && legacyToBusiness.has(profile._id)) {
          targetBusinessId = legacyToBusiness.get(profile._id);
          break;
        }
      }

      // 2. The person who ran a shop.
      if (!targetBusinessId) {
        const shop = await ctx.db
          .query("shops")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();
        if (shop?.businessId) {
          targetBusinessId = shop.businessId;
        }
      }

      // 3. Somebody who already belongs to a business keeps it — the
      //    migration must not drag an existing tenant's people into the
      //    legacy business. Everybody else was part of the old single
      //    business and goes to the primary one.
      if (!targetBusinessId) {
        if (memberships.length > 0) continue;
        targetBusinessId = primary._id;
      }

      const isOwner = primary.ownerId === user._id;
      const role = isOwner ? "owner" : roleFromLegacyRoles(user.roles);

      await ctx.db.insert("memberships", {
        userId: user._id,
        businessId: targetBusinessId,
        role,
        status: "active",
        createdAt: now,
        joinedAt: now,
      });
      created += 1;

      // Make the business the user's active one so the app opens in the
      // right tenant straight away.
      if (!user.activeBusinessId) {
        await ctx.db.patch(user._id, { activeBusinessId: targetBusinessId });
        updated += 1;
      }
    }

    // The primary business needs an owner, even if the legacy profile did
    // not record one.
    if (!primary.ownerId) {
      const anyMember = await ctx.db
        .query("memberships")
        .withIndex("by_businessId", (q) => q.eq("businessId", primary._id))
        .first();
      if (anyMember) {
        await ctx.db.patch(primary._id, { ownerId: anyMember.userId });
        await ctx.db.patch(anyMember._id, { role: "owner" });
      }
    }

    return {
      membershipsCreated: created,
      activeBusinessSet: updated,
      businessId: primary._id,
    };
  },
});

/**
 * Stamp every legacy tenant row with the business it belonged to.
 *
 * The legacy data was global — it was never partitioned — so it all belongs
 * to the primary business. Vertical rows that carried a
 * `businessProfileId` are re-pointed at the business that profile became;
 * vertical rows with no pointer at all are legacy global rows too, and are
 * assigned to the primary business.
 *
 * Rows that already carry a `businessId` are left untouched.
 */
export const migrateTenantRows = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    mapping: v.optional(v.record(v.string(), v.string())),
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireMigrationOperator(ctx, args.serverSecret);

    const legacyToBusiness = await buildLegacyMapping(ctx, args.mapping);
    const primary = await resolveTargetBusiness(
      ctx,
      args.businessId,
      legacyToBusiness,
      operator._id
    );

    const report: Record<string, number> = {};
    const byProfile: Record<string, number> = {};
    const byDefault: Record<string, number> = {};

    // ── global tables: legacy rows have no tenant pointer at all ──
    for (const table of GLOBAL_TABLES) {
      const rows = await (ctx.db as any).query(table).collect();
      let updated = 0;
      for (const row of rows) {
        if (row.businessId) continue; // already a tenant row — never overwrite
        await (ctx.db as any).patch(row._id, { businessId: primary._id });
        updated += 1;
      }
      report[table] = updated;
    }

    // ── vertical tables: re-point the legacy profile pointer ──
    for (const table of VERTICAL_TABLES) {
      const rows = await (ctx.db as any).query(table).collect();
      let updated = 0;
      let defaulted = 0;
      for (const row of rows) {
        if (row.businessId) continue; // already a tenant row — never overwrite
        const legacyId = row.businessProfileId;
        const businessId = legacyId ? legacyToBusiness.get(legacyId) : undefined;
        if (businessId) {
          await (ctx.db as any).patch(row._id, { businessId });
          updated += 1;
        } else {
          // Legacy global row with no pointer: it belonged to the one
          // business the deployment had.
          await (ctx.db as any).patch(row._id, { businessId: primary._id });
          defaulted += 1;
        }
      }
      report[table] = updated;
      if (defaulted > 0) byDefault[table] = defaulted;
    }

    return {
      businessId: primary._id,
      report,
      byLegacyProfile: byProfile,
      assignedByDefault: byDefault,
    };
  },
});

/**
 * The state of the migration — what still needs doing.
 */
export const migrationStatus = query({
  args: {
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deployment-wide figures — only the server may read them.
    await requireMigrationOperator(ctx, args.serverSecret);

    const profiles = await ctx.db.query("businessProfiles").collect();
    const businesses = await ctx.db.query("businesses").collect();
    const memberships = await ctx.db.query("memberships").collect();
    const users = await ctx.db.query("users").collect();

    const unassigned: Record<string, number> = {};
    for (const table of [...GLOBAL_TABLES, ...VERTICAL_TABLES]) {
      const rows = await (ctx.db as any).query(table).collect();
      const count = rows.filter((r: any) => !r.businessId).length;
      if (count > 0) unassigned[table] = count;
    }

    const usersWithoutMembership = users.filter(
      (u) => !memberships.some((m) => m.userId === u._id)
    ).length;

    // The legacy rows are deliberately kept, so their presence is *not* a
    // sign of an incomplete migration — they are the input the migration
    // already consumed.
    return {
      legacyProfiles: profiles.length,
      businesses: businesses.length,
      memberships: memberships.length,
      users: users.length,
      usersWithoutMembership,
      rowsWithoutBusiness: unassigned,
      migrationComplete:
        businesses.length > 0 &&
        usersWithoutMembership === 0 &&
        Object.keys(unassigned).length === 0,
    };
  },
});

/**
 * Remove the legacy copies of the products a counter holds.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * A counter used to keep a copy of each product it held: the name, the
 * code, the selling price, the profit value and the book value, frozen at
 * the moment the goods were issued. The counter now keeps only a quantity,
 * and reads the product from the master catalogue.
 *
 * The old copies are ignored when they are read, so nothing is wrong with
 * them while they sit there. But they are still there: they are dead
 * weight on every row, and they are a trap for the next person who reads
 * them and believes them. This removes them.
 *
 * It is safe to run more than once — a counter whose rows are already
 * clean is left exactly as it is.
 * ────────────────────────────────────────────────────────────────────────
 */
export const stripCounterStockCopies = mutation({
  args: {
    /** The business to clean. Every business is cleaned when it is absent. */
    businessId: v.optional(v.id("businesses")),
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // The server secret is the whole gate here.
    //
    // The legacy migration below also asks for a signed-in administrator,
    // because it rewrites who owns what. This one only removes redundant
    // copies of data that already exists elsewhere, so the secret — which
    // a browser never holds — is enough, and the cleanup can be run by the
    // server without anybody's password.
    if (!serverSecretMatches(args.serverSecret)) {
      throw new ConvexError(
        "Forbidden: this can only be run by the SMARTBUZ server. " +
          "Run scripts/strip-counter-copies.mjs instead of calling this from a browser."
      );
    }

    const businesses = args.businessId
      ? [{ _id: args.businessId }]
      : await ctx.db.query("businesses").collect();

    let countersTouched = 0;
    let rowsCleaned = 0;
    let countersChecked = 0;
    const businessesTouched: string[] = [];

    for (const business of businesses) {
      const shops = await ctx.db
        .query("shops")
        .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
        .collect();

      countersChecked += shops.length;
      let touchedHere = 0;

      for (const shop of shops) {
        const issued = shop.issuedStocks ?? [];
        const dirty = issued.filter(
          (item) =>
            item.name !== undefined ||
            item.price !== undefined ||
            item.productCode !== undefined ||
            item.pv !== undefined ||
            item.bv !== undefined ||
            item.halfPrice !== undefined
        );
        if (dirty.length === 0) continue;

        await ctx.db.patch(shop._id, {
          issuedStocks: issued.map((item) => ({
            stockId: item.stockId,
            qty: item.qty,
          })),
        });

        countersTouched += 1;
        rowsCleaned += dirty.length;
        touchedHere += dirty.length;
      }

      if (touchedHere > 0) businessesTouched.push(business._id);
    }

    return {
      countersTouched,
      rowsCleaned,
      countersChecked,
      businessesChecked: businesses.length,
      businessesTouched,
    };
  },
});
