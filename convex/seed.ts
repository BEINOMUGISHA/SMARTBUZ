import { mutation } from "./_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import { Id } from "./_generated/dataModel";

// --- Internal Helper Functions ---

async function runSeedCategories(ctx: any) {
    const categories = ["Health & Beauty", "Supplements", "Personal Care", "Home Essentials", "Electronics", "Home"];
    const categoryIds = [];
    for (const cat of categories) {
        const existing = await ctx.db.query("categories").filter((q: any) => q.eq(q.field("type"), cat)).first();
        if (existing) {
            categoryIds.push(existing._id);
        } else {
            const id = await ctx.db.insert("categories", { type: cat });
            categoryIds.push(id);
        }
    }
    return categoryIds;
}

async function runSeedUsers(ctx: any) {
    const users = [
        { first_name: "Admin", last_name: "User", email: "admin@pos.com", password: "password123", roles: ["admin"] },
        { first_name: "Sales", last_name: "Agent", email: "sales@pos.com", password: "password123", roles: ["sales"] },
        { first_name: "Stock", last_name: "Manager", email: "stock@pos.com", password: "password123", roles: ["stock"] },
    ];
    for (const user of users) {
        const existing = await ctx.db.query("users").withIndex("by_email", (q: any) => q.eq("email", user.email)).unique();
        if (!existing) {
            const hashedPassword = bcrypt.hashSync(user.password, 10);
            await ctx.db.insert("users", { ...user, password: hashedPassword });
        }
    }
}

async function runSeedStocks(ctx: any, categoryIds: Id<"categories">[]) {
    const sampleStocks = [
        { name: "Premium Aloe Vera Gel", productCode: "AV001", description: "Organic aloe vera gel", price: 25000, purchasePrice: 15000, qty: 50, pv: 10, bv: 5, categoryId: categoryIds[0] },
        { name: "Multivitamin Complex", productCode: "MV002", description: "60 capsules", price: 45000, purchasePrice: 30000, qty: 30, pv: 20, bv: 12, categoryId: categoryIds[1] },
        { name: "Herbal Toothpaste", productCode: "HT003", description: "Natural toothpaste", price: 12000, purchasePrice: 8000, qty: 100, pv: 4, bv: 2, categoryId: categoryIds[2] },
    ];
    for (const stock of sampleStocks) {
        const existing = await ctx.db.query("stocks").withIndex("by_productCode", (q: any) => q.eq("productCode", stock.productCode)).unique();
        if (!existing) await ctx.db.insert("stocks", stock);
    }
}

async function runSeedLargeStock(ctx: any, categoryIds: Id<"categories">[]) {
    const getRandomCat = () => categoryIds[Math.floor(Math.random() * categoryIds.length)];
    for (let i = 1; i <= 50; i++) {
        await ctx.db.insert("stocks", {
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

async function runSeedShops(ctx: any) {
    const users = await ctx.db.query("users").collect();
    const manager = users.find((u: any) => u.roles.includes("sales")) || users[0];
    const stocks = await ctx.db.query("stocks").take(10);
    const shops = [
        { name: "Kampala Main Branch", serialNumber: "KLA-001", location: "Kampala Central", contact: "0414000111" },
        { name: "Mbarara Outlet", serialNumber: "MBR-002", location: "Mbarara Town", contact: "0485000222" },
    ];
    for (const shop of shops) {
        const existing = await ctx.db.query("shops").filter((q: any) => q.eq(q.field("serialNumber"), shop.serialNumber)).first();
        if (!existing) {
            await ctx.db.insert("shops", {
                ...shop,
                userId: manager._id,
                issuedStocks: stocks.map((s: any) => ({ stockId: s._id, name: s.name, qty: 50, price: s.price, productCode: s.productCode, pv: s.pv, bv: s.bv, halfPrice: false })),
            });
        }
    }
}

async function runSeedSales(ctx: any) {
    const stocks = await ctx.db.query("stocks").collect();
    const shops = await ctx.db.query("shops").collect();
    const users = await ctx.db.query("users").collect();
    if (stocks.length === 0 || users.length === 0) return;
    const now = new Date();
    for (let i = 0; i < 50; i++) {
        const saleDate = new Date(now);
        saleDate.setDate(now.getDate() - Math.floor(Math.random() * 30));
        const stock = stocks[Math.floor(Math.random() * stocks.length)];
        const qty = Math.floor(Math.random() * 2) + 1;
        await ctx.db.insert("sales", {
            userId: users[0]._id,
            shopId: shops[0]?._id,
            total: stock.price * qty,
            date: saleDate.toISOString(),
            clientType: "Retail",
            items: [{ stockId: stock._id, name: stock.name, price: stock.price, quantity: qty, pv: stock.pv, bv: stock.bv }],
        });
    }
}

async function runSeedPackages(ctx: any) {
    const packages = [
        { name: "Silver Package", amount: 500000, bv: 100, pv: 50, registrationFee: 20000, isPaid: true },
        { name: "Gold Package", amount: 1500000, bv: 300, pv: 150, registrationFee: 20000, isPaid: true },
        { name: "Platinum Package", amount: 3000000, bv: 600, pv: 300, registrationFee: 20000, isPaid: true },
    ];
    const packageIds = [];
    for (const pkg of packages) {
        const existing = await ctx.db.query("packages").filter((q: any) => q.eq(q.field("name"), pkg.name)).first();
        if (existing) {
            packageIds.push(existing._id);
        } else {
            const id = await ctx.db.insert("packages", pkg);
            packageIds.push(id);
        }
    }
    return packageIds;
}

async function runSeedDistributors(ctx: any, packageIds: Id<"packages">[]) {
    const distributors = [
        { name: "Kato Joseph", phone: "0771112233", email: "kato@tiens.com", distributorId: "UG00112233", address: "Kampala, Katwe", packageId: packageIds[0] },
        { name: "Nabaasa Sarah", phone: "0755443322", email: "sarah@tiens.com", distributorId: "UG44556677", address: "Mbarara, High Street", packageId: packageIds[1] },
        { name: "Mukasa David", phone: "0700112233", email: "david@tiens.com", distributorId: "UG99887766", address: "Entebbe, Abayita Ababiri", packageId: packageIds[2] },
        { name: "Atuhaire Peace", phone: "0788990011", email: "peace@tiens.com", distributorId: "UG11224455", address: "Gulu, Gulu Main Street", packageId: packageIds[0] },
    ];
    for (const d of distributors) {
        const existing = await ctx.db.query("customers").withIndex("by_phone", (q: any) => q.eq("phone", d.phone)).unique();
        if (!existing) {
            await ctx.db.insert("customers", d);
        }
    }
}

async function runSeedHPSales(ctx: any) {
    const stocks = await ctx.db.query("stocks").filter((q: any) => q.eq(q.field("halfPrice"), true)).collect();
    const shops = await ctx.db.query("shops").collect();
    const users = await ctx.db.query("users").collect();
    if (stocks.length === 0 || users.length === 0) return;

    // Create 20 HP Sales
    const now = new Date();
    for (let i = 0; i < 20; i++) {
        const saleDate = new Date(now);
        saleDate.setDate(now.getDate() - Math.floor(Math.random() * 15)); // Recent 15 days
        const stock = stocks[Math.floor(Math.random() * stocks.length)];
        const qty = Math.floor(Math.random() * 5) + 1;

        await ctx.db.insert("sales", {
            userId: users[0]._id,
            shopId: shops[0]?._id,
            total: stock.price * qty,
            date: saleDate.toISOString(),
            clientType: "HP Client",
            items: [{ stockId: stock._id, name: stock.name, price: stock.price, quantity: qty, pv: stock.pv, bv: stock.bv }],
        });
    }
}

async function runSeedActivities(ctx: any) {
    const users = await ctx.db.query("users").collect();
    if (users.length === 0) return;
    const actions = ["Stock Update", "New Shop", "Price Change", "Stock Issue"];
    for (let i = 0; i < 10; i++) {
        await ctx.db.insert("activityLogs", {
            userId: users[0]._id,
            action: actions[Math.floor(Math.random() * actions.length)],
            details: "Sample activity log entry for testing dashboard visibility.",
            timestamp: new Date().toISOString(),
        });
    }
}

// --- Public Mutations ---

export const seed = mutation({
    args: {},
    handler: async (ctx) => {
        const catIds = await runSeedCategories(ctx);
        await runSeedUsers(ctx);
        await runSeedStocks(ctx, catIds);
        return "Base seeding complete.";
    }
});

export const seedLargeStock = mutation({
    args: {},
    handler: async (ctx) => {
        const cats = await ctx.db.query("categories").collect();
        await runSeedLargeStock(ctx, cats.map(c => c._id));
        return "Large stock seeded.";
    }
});

export const seedShopsAndDistributors = mutation({
    args: {},
    handler: async (ctx) => {
        await runSeedShops(ctx);
        return "Shops seeded.";
    }
});

export const seedSales = mutation({
    args: {},
    handler: async (ctx) => {
        await runSeedSales(ctx);
        return "Sales seeded.";
    }
});

export const seedActivityLogs = mutation({
    args: {},
    handler: async (ctx) => {
        await runSeedActivities(ctx);
        return "Activities seeded.";
    }
});

export const seedEverything = mutation({
    args: {},
    handler: async (ctx) => {
        const catIds = await runSeedCategories(ctx);
        await runSeedUsers(ctx);
        await runSeedStocks(ctx, catIds);
        await runSeedLargeStock(ctx, catIds);
        const pkgIds = await runSeedPackages(ctx);
        await runSeedDistributors(ctx, pkgIds);
        await runSeedShops(ctx);
        await runSeedSales(ctx);
        await runSeedHPSales(ctx);
        await runSeedActivities(ctx);
        return "COMPLETE SEED SUCCESSFUL!";
    }
});

