import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import bcrypt from "bcryptjs";
import { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";
import { serverSecretMatches } from "./serverSecret";
import { PASSWORD_HASH_COST } from "./crypto";

/**
 * SMART_BUZ — demo data seeding.
 *
 * The seed writes into the caller's own business: categories, products,
 * counters, promoters, customers and sales all carry that business id, so
 * seeded demo data behaves exactly like real data and cannot leak into
 * another tenant.
 *
 * Seeding used to be a public mutation that wrote global rows. It now
 * requires an authenticated administrator of the active business.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The demo accounts
 * ────────────────────────────────────────────────────────────────────────
 *
 * Seeding used to create three accounts with the address `admin@pos.com`
 * and the password `password123`. The `users` table is global — a user is
 * not owned by a business — so those three addresses were **one account
 * for the whole deployment**. Whichever business seeded first owned them,
 * and everybody who seeded afterwards was given a membership on the *same*
 * account: one well-known password, valid in every tenant that had ever
 * run the seed.
 *
 * Now:
 *
 *  • the address carries the business's own slug and lives on the
 *    `.invalid` domain, which by definition cannot be registered, so two
 *    businesses never share a login;
 *  • the password is random, generated per account, and printed once to
 *    whoever seeded — nobody else ever learns it;
 *  • seeding is a **server** operation, so it needs the server-to-backend
 *    secret. A browser cannot create accounts.
 */

/* --- Internal Helper Functions --- */

/**
 * A random password for a seeded account.
 *
 * Long enough to be worth nothing to a guesser, and made of characters that
 * do not need escaping in a shell or a password manager.
 */
function generateSeedPassword(): string {
    const alphabet =
        "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

/**
 * The address a seeded account gets.
 *
 * It is unique per business and per role, and it is on `.invalid`, a
 * domain reserved by RFC 2606 precisely so that it can never be
 * registered by anybody.
 */
async function seedEmailFor(
    ctx: any,
    businessId: Id<"businesses">,
    role: string
): Promise<string> {
    const business = await ctx.db.get(businessId);
    const slug = (business?.slug ?? business?.name ?? "demo")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return `${role}.${slug || "demo"}@example.invalid`;
}

async function runSeedCategories(ctx: any, businessId: Id<"businesses">) {
    const categories = ["Health & Beauty", "Supplements", "Personal Care", "Home Essentials", "Electronics", "Home"];
    const categoryIds: Id<"categories">[] = [];
    for (const cat of categories) {
        const existing = await ctx.db
            .query("categories")
            .withIndex("by_businessId_type", (q: any) => q.eq("businessId", businessId).eq("type", cat))
            .first();
        if (existing) {
            categoryIds.push(existing._id);
        } else {
            const id = await ctx.db.insert("categories", { type: cat, businessId });
            categoryIds.push(id);
        }
    }
    return categoryIds;
}

async function seedUsersInternal(ctx: any, businessId: Id<"businesses">) {
    const users = [
        { first_name: "Admin", last_name: "User", roles: ["admin"], role: "admin" },
        { first_name: "Sales", last_name: "Agent", roles: ["sales"], role: "cashier" },
        { first_name: "Stock", last_name: "Manager", roles: ["stock"], role: "stock" },
    ];
    const now = new Date().toISOString();
    const created: { email: string; password: string; role: string }[] = [];

    for (const user of users) {
        const email = await seedEmailFor(ctx, businessId, user.role);

        let account = await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", email))
            .unique();

        // The password is generated afresh every time, and the stored hash
        // is replaced to match. A seeded account therefore never carries a
        // password that is written down anywhere, and re-seeding cannot
        // leave an old, known one behind.
        const password = generateSeedPassword();
        const hashedPassword = bcrypt.hashSync(password, PASSWORD_HASH_COST);

        if (!account) {
            const userId = await ctx.db.insert("users", {
                first_name: user.first_name,
                last_name: user.last_name,
                email,
                roles: user.roles,
                password: hashedPassword,
                status: "active",
                emailVerified: true,
                createdAt: now,
            });
            account = await ctx.db.get(userId);
        } else {
            await ctx.db.patch(account._id, {
                password: hashedPassword,
                first_name: user.first_name,
                last_name: user.last_name,
                roles: user.roles,
            });
        }

        if (!account) continue;

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q: any) =>
                q.eq("businessId", businessId).eq("userId", account!._id)
            )
            .unique();
        if (!membership) {
            await ctx.db.insert("memberships", {
                userId: account._id,
                businessId,
                role: user.role,
                status: "active",
                createdAt: now,
                joinedAt: now,
            });
        }

        created.push({ email, password, role: user.role });
    }

    return created;
}

async function runSeedStocks(ctx: any, businessId: Id<"businesses">, categoryIds: Id<"categories">[]) {
    const sampleStocks = [
        { name: "Premium Aloe Vera Gel", productCode: "AV001", description: "Organic aloe vera gel", price: 25000, purchasePrice: 15000, qty: 50, pv: 10, bv: 5, categoryId: categoryIds[0] },
        { name: "Multivitamin Complex", productCode: "MV002", description: "60 capsules", price: 45000, purchasePrice: 30000, qty: 30, pv: 20, bv: 12, categoryId: categoryIds[1] },
        { name: "Herbal Toothpaste", productCode: "HT003", description: "Natural toothpaste", price: 12000, purchasePrice: 8000, qty: 100, pv: 4, bv: 2, categoryId: categoryIds[2] },
    ];
    for (const stock of sampleStocks) {
        const existing = await ctx.db
            .query("stocks")
            .withIndex("by_businessId_productCode", (q: any) =>
                q.eq("businessId", businessId).eq("productCode", stock.productCode)
            )
            .unique();
        if (!existing) await ctx.db.insert("stocks", { ...stock, businessId });
    }
}

async function runSeedLargeStock(ctx: any, businessId: Id<"businesses">, categoryIds: Id<"categories">[]) {
    const getRandomCat = () => categoryIds[Math.floor(Math.random() * categoryIds.length)];
    for (let i = 1; i <= 50; i++) {
        await ctx.db.insert("stocks", {
            businessId,
            name: `Product ${i}`,
            productCode: `REG-${1000 + i}`,
            description: `Inventory item #${i}`,
            price: 10000 + (Math.floor(Math.random() * 50) * 1000),
            purchasePrice: 5000 + (Math.floor(Math.random() * 50) * 500),
            qty: 50 + Math.floor(Math.random() * 100),
            pv: 5 + Math.floor(Math.random() * 20),
            bv: 2 + Math.floor(Math.random() * 10),
            categoryId: getRandomCat(),
            halfPrice: false,
        });
    }

    // Generate HP Stocks
    for (let i = 1; i <= 50; i++) {
        await ctx.db.insert("stocks", {
            businessId,
            name: `HP Exclusive Item ${i}`,
            productCode: `HP-${2000 + i}`,
            description: `Half-Price special item #${i}`,
            price: 20000 + (Math.floor(Math.random() * 50) * 1000),
            purchasePrice: 10000 + (Math.floor(Math.random() * 50) * 500),
            qty: 20 + Math.floor(Math.random() * 50),
            pv: 10 + Math.floor(Math.random() * 30),
            bv: 5 + Math.floor(Math.random() * 15),
            categoryId: getRandomCat(),
            halfPrice: true,
        });
    }
}

async function runSeedShops(ctx: any, businessId: Id<"businesses">) {
    const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect();
    if (memberships.length === 0) return;

    const manager = await ctx.db.get(memberships[0].userId);
    if (!manager) return;

    const stocks = await ctx.db
        .query("stocks")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .take(10);

    const shops = [
        { name: "Kampala Main Branch", serialNumber: "KLA-001", location: "Kampala Central", contact: "0414000111" },
        { name: "Mbarara Outlet", serialNumber: "MBR-002", location: "Mbarara Town", contact: "0485000222" },
    ];
    for (const shop of shops) {
        const existing = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
            .filter((q: any) => q.eq(q.field("serialNumber"), shop.serialNumber))
            .first();
        if (!existing) {
            await ctx.db.insert("shops", {
                businessId,
                ...shop,
                userId: manager._id,
                issuedStocks: stocks.map((s: any) => ({ stockId: s._id, name: s.name, qty: 50, price: s.price, productCode: s.productCode, pv: s.pv, bv: s.bv, halfPrice: false })),
            });
        }
    }
}

async function runSeedSales(ctx: any, businessId: Id<"businesses">) {
    const stocks = await ctx.db.query("stocks").withIndex("by_businessId", (q: any) => q.eq("businessId", businessId)).collect();
    const shops = await ctx.db.query("shops").withIndex("by_businessId", (q: any) => q.eq("businessId", businessId)).collect();
    const memberships = await ctx.db.query("memberships").withIndex("by_businessId", (q: any) => q.eq("businessId", businessId)).collect();
    if (stocks.length === 0 || memberships.length === 0) return;
    const operator = await ctx.db.get(memberships[0].userId);
    if (!operator) return;

    const now = new Date();
    for (let i = 0; i < 50; i++) {
        const saleDate = new Date(now);
        saleDate.setDate(now.getDate() - Math.floor(Math.random() * 30));
        const stock = stocks[Math.floor(Math.random() * stocks.length)];
        const qty = Math.floor(Math.random() * 2) + 1;
        const paymentModes = ["Cash", "Mobile Money", "Bank Transfer", "Bonus Transfer"];
        await ctx.db.insert("sales", {
            businessId,
            userId: operator._id,
            shopId: shops[0]?._id,
            total: stock.price * qty,
            date: saleDate.toISOString(),
            clientType: "Retail",
            paymentMode: paymentModes[Math.floor(Math.random() * paymentModes.length)],
            items: [{ stockId: stock._id, name: stock.name, price: stock.price, quantity: qty, pv: stock.pv, bv: stock.bv }],
        });
    }
}

async function runSeedPromotions(ctx: any, businessId: Id<"businesses">) {
    const promotions = [
        { name: "New Year Promo", prize: "Free T-Shirt & Cap", isActive: true },
        { name: "Mega Sales Event", prize: "UGX 50,000 Voucher", isActive: true },
    ];
    for (const promo of promotions) {
        const existing = await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
            .filter((q: any) => q.eq(q.field("name"), promo.name))
            .first();
        if (!existing) {
            await ctx.db.insert("promotions", { businessId, ...promo });
        }
    }
}

async function runSeedDistributors(ctx: any, businessId: Id<"businesses">) {
    const distributors = [
        { name: "Kato Joseph", phone: "0771112233", email: "kato@tiens.com", distributorId: "UG00112233", address: "Kampala, Katwe" },
        { name: "Nabaasa Sarah", phone: "0755443322", email: "sarah@tiens.com", distributorId: "UG44556677", address: "Mbarara, High Street" },
        { name: "Mukasa David", phone: "0700112233", email: "david@tiens.com", distributorId: "UG99887766", address: "Entebbe, Abayita Ababiri" },
        { name: "Atuhaire Peace", phone: "0788990011", email: "peace@tiens.com", distributorId: "UG11224455", address: "Gulu, Gulu Main Street" },
    ];
    for (const d of distributors) {
        const existing = await ctx.db
            .query("customers")
            .withIndex("by_businessId_phone", (q: any) => q.eq("businessId", businessId).eq("phone", d.phone))
            .unique();
        if (!existing) {
            await ctx.db.insert("customers", { businessId, ...d });
        }
    }
}

async function runSeedHPSales(ctx: any, businessId: Id<"businesses">) {
    const stocks = await ctx.db
        .query("stocks")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .filter((q: any) => q.eq(q.field("halfPrice"), true))
        .collect();
    const shops = await ctx.db.query("shops").withIndex("by_businessId", (q: any) => q.eq("businessId", businessId)).collect();
    const memberships = await ctx.db.query("memberships").withIndex("by_businessId", (q: any) => q.eq("businessId", businessId)).collect();
    if (stocks.length === 0 || memberships.length === 0) return;
    const operator = await ctx.db.get(memberships[0].userId);
    if (!operator) return;

    // Create 20 HP Sales
    const now = new Date();
    for (let i = 0; i < 20; i++) {
        const saleDate = new Date(now);
        saleDate.setDate(now.getDate() - Math.floor(Math.random() * 15)); // Recent 15 days
        const stock = stocks[Math.floor(Math.random() * stocks.length)];
        const qty = Math.floor(Math.random() * 5) + 1;

        await ctx.db.insert("sales", {
            businessId,
            userId: operator._id,
            shopId: shops[0]?._id,
            total: stock.price * qty,
            date: saleDate.toISOString(),
            clientType: "HP Client",
            items: [{ stockId: stock._id, name: stock.name, price: stock.price, quantity: qty, pv: stock.pv, bv: stock.bv }],
        });
    }
}

async function runSeedActivities(ctx: any, businessId: Id<"businesses">, userId: Id<"users">) {
    const actions = ["Stock Update", "New Shop", "Price Change", "Stock Issue"];
    for (let i = 0; i < 10; i++) {
        await ctx.db.insert("activityLogs", {
            businessId,
            userId,
            action: actions[Math.floor(Math.random() * actions.length)],
            details: "Sample activity log entry for testing dashboard visibility.",
            timestamp: new Date().toISOString(),
        });
    }
}

/* --- Public Mutations --- */

/**
 * Assert that the caller is the server.
 *
 * Seeding writes accounts, and an account is a global row: the `users`
 * table belongs to no single business. That makes account creation a
 * deployment-time operation rather than something a browser may ask for.
 */
function requireSeedOperator(serverSecret: string | undefined): void {
    if (serverSecretMatches(serverSecret)) return;
    throw new ConvexError(
        "Forbidden: demo accounts can only be created by the SMARTBUZ server. " +
            "Run scripts/seed-legacy-fixture.mjs instead of calling this from a browser."
    );
}

export const seed = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireSeedOperator(args.serverSecret);
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.manage");
        const catIds = await runSeedCategories(ctx, tenant.businessId);
        const accounts = await seedUsersInternal(ctx, tenant.businessId);
        await runSeedStocks(ctx, tenant.businessId, catIds);
        return { message: "Base seeding complete.", accounts };
    }
});

export const seedLargeStock = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.manage");
        const cats = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
            .collect();
        await runSeedLargeStock(ctx, tenant.businessId, cats.map((c) => c._id));
        return "Large stock seeded.";
    }
});

export const seedShopsAndDistributors = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");
        await runSeedShops(ctx, tenant.businessId);
        await runSeedDistributors(ctx, tenant.businessId);
        return "Shops seeded.";
    }
});

export const seedSales = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        await runSeedSales(ctx, tenant.businessId);
        return "Sales seeded.";
    }
});

export const seedActivityLogs = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");
        await runSeedActivities(ctx, tenant.businessId, tenant.user._id);
        return "Activities seeded.";
    }
});

export const runSeedUsers = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireSeedOperator(args.serverSecret);
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");
        const accounts = await seedUsersInternal(ctx, tenant.businessId);
        return { message: "Users seeded successfully.", accounts };
    }
});

export const seedEverything = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireSeedOperator(args.serverSecret);
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");
        const businessId = tenant.businessId;

        const catIds = await runSeedCategories(ctx, businessId);
        const accounts = await seedUsersInternal(ctx, businessId);
        await runSeedStocks(ctx, businessId, catIds);
        await runSeedLargeStock(ctx, businessId, catIds);
        await runSeedPromotions(ctx, businessId);
        await runSeedDistributors(ctx, businessId);
        await runSeedShops(ctx, businessId);
        await runSeedSales(ctx, businessId);
        await runSeedHPSales(ctx, businessId);
        await runSeedActivities(ctx, businessId, tenant.user._id);
        return { message: "COMPLETE SEED SUCCESSFUL!", accounts };
    }
});
