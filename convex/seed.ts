import { mutation } from "./_generated/server";
// Force sync
import { v } from "convex/values";
import bcrypt from "bcryptjs";

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
