import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import bcrypt from "bcryptjs";
import { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";

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
 */

/* --- Internal Helper Functions --- */

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
        { first_name: "Admin", last_name: "User", email: "admin@pos.com", password: "password123", roles: ["admin"], role: "admin" },
        { first_name: "Sales", last_name: "Agent", email: "sales@pos.com", password: "password123", roles: ["sales"], role: "cashier" },
        { first_name: "Stock", last_name: "Manager", email: "stock@pos.com", password: "password123", roles: ["stock"], role: "stock" },
    ];
    const now = new Date().toISOString();

    for (const user of users) {
        let account = await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", user.email))
            .unique();

        if (!account) {
            const hashedPassword = bcrypt.hashSync(user.password, 10);
            const userId = await ctx.db.insert("users", {
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                roles: user.roles,
                password: hashedPassword,
                status: "active",
                createdAt: now,
            });
            account = await ctx.db.get(userId);
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
    }
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

export const seed = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.manage");
        const catIds = await runSeedCategories(ctx, tenant.businessId);
        await seedUsersInternal(ctx, tenant.businessId);
        await runSeedStocks(ctx, tenant.businessId, catIds);
        return "Base seeding complete.";
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
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");
        await seedUsersInternal(ctx, tenant.businessId);
        return "Users seeded successfully.";
    }
});

export const seedEverything = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");
        const businessId = tenant.businessId;

        const catIds = await runSeedCategories(ctx, businessId);
        await seedUsersInternal(ctx, businessId);
        await runSeedStocks(ctx, businessId, catIds);
        await runSeedLargeStock(ctx, businessId, catIds);
        await runSeedPromotions(ctx, businessId);
        await runSeedDistributors(ctx, businessId);
        await runSeedShops(ctx, businessId);
        await runSeedSales(ctx, businessId);
        await runSeedHPSales(ctx, businessId);
        await runSeedActivities(ctx, businessId, tenant.user._id);
        return "COMPLETE SEED SUCCESSFUL!";
    }
});
