import { mutation } from "./_generated/server";
// Force sync
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import { Id } from "./_generated/dataModel";

export const seed = mutation({
    args: {},
    handler: async (ctx) => {
        // 1. Seed Categories
        const categories = [
            "Health & Beauty",
            "Supplements",
            "Personal Care",
            "Home Essentials",
        ];
        const categoryIds = [];
        for (const cat of categories) {
            const id = await ctx.db.insert("categories", { type: cat });
            categoryIds.push(id);
        }

        // 2. Seed Demo Users (Admin, Sales, Stock)
        const users = [
            {
                first_name: "Admin",
                last_name: "User",
                email: "admin@pos.com",
                password: "password123", // Simple for demo
                roles: ["admin", "sales", "stock", "settings", "reports"],
            },
            {
                first_name: "Sales",
                last_name: "Agent",
                email: "sales@pos.com",
                password: "password123",
                roles: ["sales"],
            },
            {
                first_name: "Stock",
                last_name: "Manager",
                email: "stock@pos.com",
                password: "password123",
                roles: ["stock"],
            },
        ];

        for (const user of users) {
            const existing = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", user.email))
                .unique();
            if (!existing) {
                const hashedPassword = bcrypt.hashSync(user.password, 10);
                await ctx.db.insert("users", {
                    ...user,
                    password: hashedPassword,
                });
            }
        }

        // 3. Seed Sample Stocks
        const sampleStocks = [
            {
                name: "Premium Aloe Vera Gel",
                productCode: "AV001",
                description: "Organic aloe vera gel for skin care.",
                price: 25000,
                purchasePrice: 15000,
                qty: 50,
                pv: 10,
                bv: 5,
                categoryId: categoryIds[0],
            },
            {
                name: "Multivitamin Complex",
                productCode: "MV002",
                description: "60 capsules of essential vitamins.",
                price: 45000,
                purchasePrice: 30000,
                qty: 30,
                pv: 20,
                bv: 12,
                categoryId: categoryIds[1],
            },
            {
                name: "Herbal Toothpaste",
                productCode: "HT003",
                description: "Fluoride-free natural toothpaste.",
                price: 12000,
                purchasePrice: 8000,
                qty: 100,
                pv: 4,
                bv: 2,
                categoryId: categoryIds[2],
            },
        ];

        for (const stock of sampleStocks) {
            const existing = await ctx.db
                .query("stocks")
                .withIndex("by_productCode", (q) => q.eq("productCode", stock.productCode))
                .unique();
            if (!existing) {
                await ctx.db.insert("stocks", stock);
            }
        }

        return "Seeding successful!";
    },
});

export const seedLargeStock = mutation({
    args: {},
    handler: async (ctx) => {
        // 1. Get Categories
        let categories = await ctx.db.query("categories").collect();
        const categoryNames = ["Health", "Electronics", "Home", "Beauty"];

        if (categories.length === 0) {
            for (const name of categoryNames) {
                await ctx.db.insert("categories", { type: name });
            }
            categories = await ctx.db.query("categories").collect();
        }

        const getRandomCat = () => categories[Math.floor(Math.random() * categories.length)]._id;

        // 2. Generate 200 Regular Stocks
        for (let i = 1; i <= 200; i++) {
            await ctx.db.insert("stocks", {
                name: `Regular Product ${i}`,
                productCode: `REG-${1000 + i}`,
                description: `Standard inventory item #${i}`,
                price: 10000 + (Math.floor(Math.random() * 50) * 1000), // Random price 10k-60k
                purchasePrice: 5000 + (Math.floor(Math.random() * 50) * 500),
                qty: 50 + Math.floor(Math.random() * 100), // 50-150 qty
                pv: 5 + Math.floor(Math.random() * 20),
                bv: 2 + Math.floor(Math.random() * 10),
                categoryId: getRandomCat(),
                halfPrice: false,
            });
        }

        // 3. Generate 200 HP Stocks
        for (let i = 1; i <= 200; i++) {
            await ctx.db.insert("stocks", {
                name: `HP Exclusive Item ${i}`,
                productCode: `HP-${2000 + i}`,
                description: `Half-Price special item #${i}`,
                price: 20000 + (Math.floor(Math.random() * 50) * 1000),
                purchasePrice: 10000 + (Math.floor(Math.random() * 50) * 500),
                qty: 20 + Math.floor(Math.random() * 50), // 20-70 qty
                pv: 10 + Math.floor(Math.random() * 30),
                bv: 5 + Math.floor(Math.random() * 15),
                categoryId: getRandomCat(),
                halfPrice: true,
            });
        }

        return "Successfully seeded 200 Regular and 200 HP stocks!";
    },
});

export const seedShopsAndDistributors = mutation({
    args: {},
    handler: async (ctx) => {
        // 1. Ensure we have some packages to link to distributors
        const existingPackages = await ctx.db.query("packages").collect();
        const packageIds: Id<"packages">[] = existingPackages.map(p => p._id);

        if (packageIds.length < 3) {
            const packageTemplates = [
                { name: "Silver Package", amount: 500000, bv: 100, pv: 50, registrationFee: 20000, isPaid: true },
                { name: "Gold Package", amount: 1500000, bv: 300, pv: 150, registrationFee: 20000, isPaid: true },
                { name: "Platinum Package", amount: 3000000, bv: 600, pv: 300, registrationFee: 20000, isPaid: true },
            ];
            for (const pkg of packageTemplates) {
                const existing = existingPackages.find(p => p.name === pkg.name);
                if (!existing) {
                    const id = await ctx.db.insert("packages", pkg);
                    packageIds.push(id);
                }
            }
        }

        const getPkgId = (index: number) => packageIds[index] || packageIds[0];

        // 2. Seed Distributors (Customers)
        const distributors = [
            { name: "Kato Joseph", phone: "0771112233", email: "kato@tiens.com", distributorId: "UG00112233", address: "Kampala, Katwe", packageId: getPkgId(0) },
            { name: "Nabaasa Sarah", phone: "0755443322", email: "sarah@tiens.com", distributorId: "UG44556677", address: "Mbarara, High Street", packageId: getPkgId(1) },
            { name: "Mukasa David", phone: "0700112233", email: "david@tiens.com", distributorId: "UG99887766", address: "Entebbe, Abayita Ababiri", packageId: getPkgId(2) },
            { name: "Atuhaire Peace", phone: "0788990011", email: "peace@tiens.com", distributorId: "UG11224455", address: "Gulu, Gulu Main Street", packageId: getPkgId(0) },
        ];

        for (const d of distributors) {
            const existing = await ctx.db
                .query("customers")
                .withIndex("by_phone", (q) => q.eq("phone", d.phone))
                .unique();
            if (!existing) {
                await ctx.db.insert("customers", d);
            }
        }

        // 3. Seed Shops
        // Get some users (preferably sales)
        const users = await ctx.db.query("users").collect();
        const salesUsers = users.filter(u => u.roles.includes("sales"));
        const manager = salesUsers.length > 0 ? salesUsers[0] : (users.length > 0 ? users[0] : null);

        if (!manager) {
            // If no users, create a default admin for manager
            return "Error: No users found. Please run the main 'seed' mutation first to create users.";
        }

        // Get some stocks to issue
        const stocks = await ctx.db.query("stocks").take(15);

        const shopTemplates = [
            { name: "Kampala Main Branch", serialNumber: "KLA-001", location: "Kampala Central", contact: "0414000111" },
            { name: "Mbarara Outlet", serialNumber: "MBR-002", location: "Mbarara Town", contact: "0485000222" },
            { name: "Gulu Hub", serialNumber: "GLU-003", location: "Gulu City", contact: "0471000333" },
            { name: "Jinji Branch", serialNumber: "JJA-004", location: "Jinja Main Street", contact: "0434000444" },
        ];

        for (const shop of shopTemplates) {
            const existing = await ctx.db
                .query("shops")
                .filter(q => q.eq(q.field("serialNumber"), shop.serialNumber))
                .first();

            if (!existing) {
                // Issue some random stocks
                const issuedStocks = stocks.slice(0, 5 + Math.floor(Math.random() * 5)).map(s => ({
                    stockId: s._id,
                    name: s.name,
                    qty: 20 + Math.floor(Math.random() * 50),
                    price: s.price,
                    productCode: s.productCode,
                    pv: s.pv,
                    bv: s.bv,
                    halfPrice: s.halfPrice || false,
                }));

                await ctx.db.insert("shops", {
                    ...shop,
                    userId: manager._id,
                    issuedStocks,
                });
            }
        }

        return "Successfully seeded 4 distributors and 4 shops with initial stock!";
    },
});
