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
        supplier: v.optional(v.string()),
    })
        .index("by_productCode", ["productCode"])
        .index("by_qty", ["qty"])
        .index("by_category", ["categoryId"])
        .index("by_halfPrice", ["halfPrice"])
        .searchIndex("search_name", { searchField: "name" })
        .searchIndex("search_supplier", { searchField: "supplier" }),

    customers: defineTable({
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        distributorId: v.optional(v.string()), // Custom ID for receipts
        address: v.optional(v.string()),
    }).index("by_phone", ["phone"]),

    promotions: defineTable({
        name: v.string(),
        prize: v.string(), // "what you win"
        isActive: v.boolean(),
        triggerType: v.optional(v.string()), // "Product", "TotalPV", "TotalBV"
        threshold: v.optional(v.number()),
    }).searchIndex("search_name", { searchField: "name" }),

    promotionProducts: defineTable({
        promotionId: v.id("promotions"),
        stockId: v.id("stocks"),
        requiredQuantity: v.number(),
    }).index("by_promotion", ["promotionId"]),

    promotionRedemptions: defineTable({
        promotionId: v.id("promotions"),
        salesId: v.id("sales"),
        customerId: v.optional(v.id("customers")),
        userId: v.id("users"),
        shopId: v.optional(v.id("shops")),
        date: v.string(),
        redeemedQuantity: v.number(), // How many times it was triggered
        productName: v.string(), // Name of product that triggered it (snapshot)
        productCode: v.optional(v.string()),
        prize: v.string(), // Snapshot of prize
    })
        .index("by_shop_date", ["shopId", "date"])
        .index("by_salesId", ["salesId"]),

    sales: defineTable({
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        userId: v.id("users"),
        total: v.number(),
        date: v.string(), // ISO String
        clientType: v.string(), // retail, distributor, etc.
        isLoan: v.optional(v.boolean()),
        paymentDueDate: v.optional(v.string()),
        paymentMode: v.optional(v.string()), // Cash, Mobile Money, Bank Transfer, Loan, Bonus Transfer, None
        manualCustomerName: v.optional(v.string()), // For walk-in customers
        initialDeposit: v.optional(v.number()), // Recorded deposit for loans
        items: v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                price: v.number(),
                productCode: v.optional(v.string()),
                quantity: v.number(),
                pv: v.number(),
                bv: v.number(),
            })
        ),
        packageType: v.optional(v.string()), // Bronze, Silver, Gold
        deliveryStatus: v.optional(v.string()), // Taken, Pending
        customerPhone: v.optional(v.string()),
        customerLocation: v.optional(v.string()),
        transactionType: v.optional(v.string()), // Sale, Swap
        invoiceNumber: v.optional(v.string()), // Sequential serial number (e.g. MBR-101)
        returnedItems: v.optional(v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                productCode: v.optional(v.string()),
                quantity: v.number(),
            })
        )),
    }).index("by_date", ["date"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_customer_date", ["customerId", "date"])
        .index("by_invoiceNumber", ["invoiceNumber"]),

    loans: defineTable({
        customerId: v.optional(v.id("customers")), // Made optional for Walk-ins
        manualCustomerName: v.optional(v.string()), // For walk-in tracking
        salesId: v.id("sales"),
        amount: v.number(),
        balance: v.number(),
        date: v.string(),
    })
        .index("by_customer", ["customerId"])
        .index("by_salesId", ["salesId"]),

    payments: defineTable({
        loanId: v.id("loans"),
        shopId: v.optional(v.id("shops")), // Scoped for auditing
        customerId: v.optional(v.id("customers")), // Scoped for auditing
        amount: v.number(),
        date: v.string(),
        balance: v.number(),
    })
        .index("by_loan", ["loanId"])
        .index("by_date", ["date"])
        .index("by_shop_date", ["shopId", "date"]),

    expenses: defineTable({
        date: v.string(),
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(), // category of expense
        userId: v.optional(v.id("users")), // user who recorded the expense
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
                productCode: v.optional(v.string()),
                pv: v.number(),
                bv: v.number(),
                halfPrice: v.boolean(),
            })
        ),
    }).index("by_user", ["userId"]),

    businessProfiles: defineTable({
        businessName: v.string(),
        businessType: v.string(),
        industry: v.optional(v.string()),
        modules: v.array(v.string()),
        currency: v.optional(v.string()),
        country: v.optional(v.string()),
        taxEnabled: v.optional(v.boolean()),
        isActive: v.boolean(),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    }).index("by_businessType", ["businessType"])
        .index("by_active", ["isActive"]),

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

    stockEntries: defineTable({
        stockId: v.id("stocks"),
        quantity: v.number(),
        userId: v.id("users"),
        date: v.string(), // ISO String
        price: v.number(),
        purchasePrice: v.number(),
        pv: v.number(),
        bv: v.number(),
        halfPrice: v.boolean(),
        type: v.string(), // "add" or "restock"
        supplier: v.optional(v.string()),
    })
        .index("by_date", ["date"])
        .index("by_stockId", ["stockId"]),

    shopIssueRecords: defineTable({
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        quantity: v.number(),
        date: v.string(), // ISO String
        userId: v.id("users"),
    }).index("by_shop_date", ["shopId", "date"])
        .index("by_stockId", ["stockId"]),

    passwordResets: defineTable({
        email: v.string(),
        code: v.string(),
        expiresAt: v.number(),
    }).index("by_email", ["email"]),

    counters: defineTable({
        name: v.string(), // e.g. "invoice"
        lastValue: v.number(),
    }).index("by_name", ["name"]),
});
