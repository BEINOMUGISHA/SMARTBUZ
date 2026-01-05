import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    users: defineTable({
        first_name: v.string(),
        middle_name: v.optional(v.string()),
        last_name: v.string(),
        email: v.string(),
        password: v.string(), // Hashed
        roles: v.array(v.string()), // admin, sales, stock, settings, reports
        profile_picture: v.optional(v.string()),
        address: v.optional(v.string()),
        phone_number: v.optional(v.string()),
        date_of_birth: v.optional(v.string()),
        gender: v.optional(v.string()),
        marital_status: v.optional(v.string()),
        nationality: v.optional(v.string()),
    }).index("by_email", ["email"]),

    userTypes: defineTable({
        type: v.string(),
    }),

    categories: defineTable({
        type: v.string(), // name of the category
    }),

    stocks: defineTable({
        name: v.string(),
        productCode: v.string(),
        description: v.optional(v.string()),
        price: v.number(),
        purchasePrice: v.number(),
        qty: v.number(),
        pv: v.number(),
        bv: v.number(),
        categoryId: v.id("categories"),
        halfPrice: v.optional(v.boolean()),
    })
        .index("by_productCode", ["productCode"])
        .searchIndex("search_name", { searchField: "name" }),

    customers: defineTable({
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        distributorId: v.optional(v.string()), // Custom ID for receipts
        address: v.optional(v.string()),
        packageId: v.optional(v.id("packages")),
    }).index("by_phone", ["phone"]),

    packages: defineTable({
        name: v.string(),
        amount: v.number(),
        bv: v.number(),
        pv: v.number(),
        registrationFee: v.number(),
        isPaid: v.boolean(),
        distributorId: v.optional(v.id("customers")),
    }),

    packageProducts: defineTable({
        packageId: v.id("packages"),
        stockId: v.id("stocks"),
        quantity: v.number(),
    }).index("by_package", ["packageId"]),

    sales: defineTable({
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        userId: v.id("users"),
        total: v.number(),
        date: v.string(), // ISO String
        clientType: v.string(), // retail, distributor, etc.
        items: v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                price: v.number(),
                quantity: v.number(),
                pv: v.number(),
                bv: v.number(),
            })
        ),
    }).index("by_date", ["date"]),

    loans: defineTable({
        customerId: v.id("customers"),
        salesId: v.id("sales"),
        amount: v.number(),
        balance: v.number(),
        date: v.string(),
    }).index("by_customer", ["customerId"]),

    payments: defineTable({
        loanId: v.id("loans"),
        amount: v.number(),
        date: v.string(),
        balance: v.number(),
    }).index("by_loan", ["loanId"]),

    expenses: defineTable({
        date: v.string(),
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(), // category of expense
    }).index("by_date", ["date"]),

    shops: defineTable({
        name: v.string(),
        serialNumber: v.string(),
        location: v.string(),
        contact: v.string(),
        userId: v.id("users"),
        issuedStocks: v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                qty: v.number(),
                price: v.number(),
                productCode: v.string(),
                pv: v.number(),
                bv: v.number(),
                halfPrice: v.boolean(),
            })
        ),
    }).index("by_user", ["userId"]),

    banking: defineTable({
        date: v.string(),
        amount: v.number(),
        comment: v.string(),
    }).index("by_date", ["date"]),

    activityLogs: defineTable({
        userId: v.id("users"),
        action: v.string(), // e.g., "Add stock", "Create sale"
        details: v.string(), // JSON string or text
        timestamp: v.string(),
    })
        .index("by_timestamp", ["timestamp"])
        .index("by_userId", ["userId"]),

    passwordResets: defineTable({
        email: v.string(),
        code: v.string(),
        expiresAt: v.number(),
    }).index("by_email", ["email"]),
});
