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
        clientOfflineId: v.optional(v.string()), // Idempotency key for offline queued sales
        isOfflineSync: v.optional(v.boolean()),
    }).index("by_date", ["date"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_customer_date", ["customerId", "date"])
        .index("by_invoiceNumber", ["invoiceNumber"])
        .index("by_clientOfflineId", ["clientOfflineId"]),

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
        // Modern vertical id from src/lib/business-categories.ts (e.g. "pharmacy").
        // businessType is kept in sync for backwards compatibility.
        categoryId: v.optional(v.string()),
        industry: v.optional(v.string()),
        modules: v.array(v.string()),
        currency: v.optional(v.string()),
        country: v.optional(v.string()),
        taxEnabled: v.optional(v.boolean()),
        taxRate: v.optional(v.number()),
        taxInclusive: v.optional(v.boolean()),
        taxNote: v.optional(v.string()),
        // URA Taxpayer Identification Number (printed on fiscal receipts).
        tin: v.optional(v.string()),
        isActive: v.boolean(),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
        businessAddress: v.optional(v.string()),
        businessPhone: v.optional(v.string()),
        // Opening cash float for cash reconciliation (till opening balance).
        openingFloat: v.optional(v.number()),
        // Monthly subscription plan for SaaS billing.
        plan: v.optional(v.string()),
        subscriptionStatus: v.optional(v.string()), // trial, active, expired, cancelled
        subscriptionExpiresAt: v.optional(v.string()),
    }).index("by_businessType", ["businessType"])
        .index("by_active", ["isActive"])
        .index("by_categoryId", ["categoryId"]),

    /* ───────────── Vertical modules ───────────── */

    /** Batches for batch/expiry tracking (pharmacy, supermarket, butchery). */
    productBatches: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        stockId: v.id("stocks"),
        batchNumber: v.string(),
        expiryDate: v.optional(v.string()), // ISO date
        qtyReceived: v.number(),
        qtyRemaining: v.number(),
        costPrice: v.optional(v.number()),
        supplier: v.optional(v.string()),
        userId: v.id("users"),
        date: v.string(),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_stockId", ["stockId"])
        .index("by_expiryDate", ["expiryDate"])
        .index("by_date", ["date"]),

    /** Appointments / bookings for service verticals. */
    appointments: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        businessType: v.string(), // "appointment" | "booking" | "class" | "table"
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        staffName: v.optional(v.string()),
        serviceName: v.string(),
        date: v.string(), // ISO date
        startTime: v.string(), // "09:00"
        endTime: v.optional(v.string()),
        status: v.string(), // pending, confirmed, completed, cancelled, no-show
        notes: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        createdBy: v.id("users"),
        createdAt: v.string(),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_date", ["date"])
        .index("by_status", ["status"])
        .index("by_customer", ["customerId"])
        .index("by_businessType", ["businessType"]),

    /** Restaurant tables / hotel rooms / beauty chairs. */
    serviceOutlets: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        businessType: v.string(), // "table" | "room" | "chair"
        name: v.string(),
        capacity: v.optional(v.number()),
        status: v.string(), // available, occupied, reserved, cleaning
        rate: v.optional(v.number()), // per night / per session
        currentBookingId: v.optional(v.id("appointments")),
        shopId: v.optional(v.id("shops")),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_businessType", ["businessType"])
        .index("by_status", ["status"]),

    /** Restaurant / café menu items linked to stock where applicable. */
    menuItems: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        category: v.string(),
        price: v.number(),
        description: v.optional(v.string()),
        available: v.optional(v.boolean()),
        preparationMinutes: v.optional(v.number()),
        dietary: v.optional(v.array(v.string())), // vegan, gluten-free, halal
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_category", ["category"]),

    /** Members — SACCO, gym, school, church, NGO, real estate. */
    members: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        memberNumber: v.string(),
        name: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        memberType: v.optional(v.string()), // shareholder, saver, student, beneficiary, tenant
        balance: v.number(), // savings / credit balance
        shares: v.optional(v.number()),
        status: v.optional(v.string()), // active, dormant, exited
        joinedDate: v.string(),
        notes: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_memberNumber", ["memberNumber"])
        .index("by_status", ["status"]),

    /** Member / customer financial ledger (shares, savings, fees). */
    memberTransactions: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        memberId: v.id("members"),
        type: v.string(), // deposit, withdrawal, share_purchase, loan, repayment, fee
        amount: v.number(),
        balanceAfter: v.number(),
        date: v.string(),
        reference: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_memberId", ["memberId"])
        .index("by_date", ["date"]),

    /** Customers with a saved money balance (credit books, layaway). */
    customerWallets: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.id("customers"),
        balance: v.number(),
        creditLimit: v.optional(v.number()),
        updatedAt: v.string(),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_customerId", ["customerId"]),

    /** Wallet ledger entries. */
    walletTransactions: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.id("customers"),
        type: v.string(), // topup, purchase, refund, adjustment
        amount: v.number(),
        balanceAfter: v.number(),
        date: v.string(),
        reference: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
        userId: v.id("users"),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_customerId", ["customerId"])
        .index("by_date", ["date"]),

    /** Service tickets — repair jobs, laundry garments, cleaning visits. */
    serviceTickets: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        ticketNumber: v.string(),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        serviceType: v.string(),
        description: v.optional(v.string()),
        status: v.string(), // received, in_progress, ready, delivered, cancelled
        priority: v.optional(v.string()), // low, normal, high
        estimatedCost: v.optional(v.number()),
        finalCost: v.optional(v.number()),
        assignedTo: v.optional(v.id("users")),
        assignedToName: v.optional(v.string()),
        receivedDate: v.string(),
        dueDate: v.optional(v.string()),
        deliveredDate: v.optional(v.string()),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_status", ["status"])
        .index("by_ticketNumber", ["ticketNumber"])
        .index("by_customer", ["customerId"]),

    /** Commissions earned by staff (barbers, stylists, agents). */
    staffCommissions: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        userId: v.id("users"),
        staffName: v.string(),
        saleId: v.optional(v.id("sales")),
        saleDate: v.string(),
        grossAmount: v.number(),
        rate: v.number(), // percentage
        commission: v.number(),
        paid: v.optional(v.boolean()),
        paidDate: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_userId", ["userId"])
        .index("by_saleDate", ["saleDate"]),

    /** Asset register — vehicles, pumps, equipment, rental items. */
    assets: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        assetTag: v.string(),
        name: v.string(),
        category: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        status: v.string(), // in_use, idle, maintenance, disposed
        purchaseDate: v.optional(v.string()),
        purchaseCost: v.optional(v.number()),
        currentValue: v.optional(v.number()),
        notes: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_assetTag", ["assetTag"])
        .index("by_category", ["category"])
        .index("by_status", ["status"]),

    /** Suppliers with payment terms (real purchasing workflow). */
    suppliers: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        name: v.string(),
        contact: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        paymentTerms: v.optional(v.string()), // "Net 30"
        balance: v.optional(v.number()),
        createdAt: v.string(),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_name", ["name"]),

    /** Purchase orders to suppliers. */
    purchaseOrders: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        poNumber: v.string(),
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.string(),
        status: v.string(), // draft, ordered, received, cancelled
        date: v.string(),
        expectedDate: v.optional(v.string()),
        total: v.number(),
        receivedDate: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            quantity: v.number(),
            unitCost: v.number(),
            receivedQty: v.optional(v.number()),
        })),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_poNumber", ["poNumber"])
        .index("by_status", ["status"])
        .index("by_date", ["date"]),

    /** Goods received against a purchase order. */
    goodsReceipts: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        poId: v.optional(v.id("purchaseOrders")),
        receiptNumber: v.string(),
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.string(),
        date: v.string(),
        total: v.number(),
        userId: v.id("users"),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            quantity: v.number(),
            unitCost: v.number(),
        })),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_receiptNumber", ["receiptNumber"])
        .index("by_date", ["date"]),

    /** Deliveries / dispatch runs. */
    deliveries: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        reference: v.string(),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        shopId: v.optional(v.id("shops")),
        destination: v.optional(v.string()),
        status: v.string(), // pending, dispatched, delivered, failed
        dispatchDate: v.optional(v.string()),
        deliveryDate: v.optional(v.string()),
        assignedTo: v.optional(v.id("users")),
        assignedToName: v.optional(v.string()),
        amount: v.optional(v.number()),
        notes: v.optional(v.string()),
        createdAt: v.string(),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_status", ["status"])
        .index("by_date", ["createdAt"]),

    /** Fuel dispensing log (fuel stations). */
    fuelDispenses: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        pumpName: v.string(),
        fuelType: v.string(), // petrol, diesel, kerosene
        litres: v.number(),
        pricePerLitre: v.number(),
        total: v.number(),
        attendantId: v.optional(v.id("users")),
        attendantName: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
        vehicleReg: v.optional(v.string()),
        date: v.string(),
        saleId: v.optional(v.id("sales")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_date", ["date"])
        .index("by_fuelType", ["fuelType"]),

    /** Vehicle register (transport, driving school). */
    vehicles: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        registration: v.string(),
        make: v.optional(v.string()),
        model: v.optional(v.string()),
        type: v.optional(v.string()), // taxi, bus, truck, motorcycle, car
        driverId: v.optional(v.id("users")),
        driverName: v.optional(v.string()),
        route: v.optional(v.string()),
        status: v.optional(v.string()), // active, maintenance, off_road
        nextServiceDate: v.optional(v.string()),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_registration", ["registration"])
        .index("by_status", ["status"]),

    /** Student / class enrolment (schools, driving schools, training). */
    classEnrolments: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        className: v.string(),
        studentId: v.optional(v.id("members")),
        studentName: v.string(),
        term: v.optional(v.string()),
        amountDue: v.optional(v.number()),
        amountPaid: v.optional(v.number()),
        status: v.optional(v.string()), // active, graduated, withdrawn
        enrolledDate: v.string(),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_className", ["className"])
        .index("by_studentId", ["studentId"]),

    /** Attendance register (schools, gyms, security, churches). */
    attendance: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        personId: v.optional(v.id("members")),
        personName: v.string(),
        className: v.optional(v.string()),
        date: v.string(),
        status: v.string(), // present, absent, late, excused
        recordedBy: v.optional(v.id("users")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_date", ["date"])
        .index("by_personId", ["personId"]),

    /** Till / cash-shift sessions for cash reconciliation. */
    tillSessions: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        sessionNumber: v.string(),
        userId: v.id("users"),
        userName: v.string(),
        shopId: v.optional(v.id("shops")),
        openedAt: v.string(),
        closedAt: v.optional(v.string()),
        openingFloat: v.number(),
        expectedCash: v.optional(v.number()),
        countedCash: v.optional(v.number()),
        variance: v.optional(v.number()),
        status: v.string(), // open, closed
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_status", ["status"])
        .index("by_userId", ["userId"])
        .index("by_openedAt", ["openedAt"]),

    /** Donations / contributions (church, NGO). */
    donations: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        donorName: v.string(),
        donorPhone: v.optional(v.string()),
        memberId: v.optional(v.id("members")),
        type: v.string(), // tithe, offering, pledge, grant, donation
        amount: v.number(),
        purpose: v.optional(v.string()),
        date: v.string(),
        userId: v.id("users"),
        reference: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_date", ["date"])
        .index("by_type", ["type"]),

    /** Retail sale lines for table service (restaurant / cafe). */
    tableOrders: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        outletId: v.id("serviceOutlets"),
        outletName: v.string(),
        customerName: v.optional(v.string()),
        staffId: v.optional(v.id("users")),
        status: v.string(), // open, paid, cancelled
        openedAt: v.string(),
        closedAt: v.optional(v.string()),
        total: v.number(),
        saleId: v.optional(v.id("sales")),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            price: v.number(),
            quantity: v.number(),
            notes: v.optional(v.string()),
        })),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_outletId", ["outletId"])
        .index("by_status", ["status"]),

    /** Rent / hire / recurring charge schedule (real estate, security, cleaning). */
    recurringCharges: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        description: v.string(),
        amount: v.number(),
        frequency: v.string(), // monthly, weekly, quarterly, yearly
        nextDueDate: v.string(),
        lastChargedDate: v.optional(v.string()),
        status: v.string(), // active, paused, ended
        serviceId: v.optional(v.id("serviceTickets")),
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_status", ["status"])
        .index("by_nextDueDate", ["nextDueDate"]),

    /** Serial / IMEI tracked units (phones, appliances, salvage). */
    productSerials: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        stockId: v.id("stocks"),
        serialNumber: v.string(),
        imei: v.optional(v.string()),
        status: v.string(), // in_stock, sold, returned, faulty
        condition: v.optional(v.string()), // new, grade_a, grade_b, used
        warrantyExpiry: v.optional(v.string()),
        soldToCustomerId: v.optional(v.id("customers")),
        soldDate: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_stockId", ["stockId"])
        .index("by_serialNumber", ["serialNumber"])
        .index("by_status", ["status"]),

    /** Custom measurement sets (tailors, carpenters, welding). */
    customerMeasurements: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        measurements: v.record(v.string(), v.number()),
        notes: v.optional(v.string()),
        updatedAt: v.string(),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_customerId", ["customerId"]),

    /** Production batches (bakeries, workshops, agro processing). */
    productionBatches: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        productName: v.string(),
        category: v.optional(v.string()),
        quantityProduced: v.number(),
        quantitySold: v.number(),
        unit: v.optional(v.string()),
        batchNumber: v.optional(v.string()),
        expiryDate: v.optional(v.string()),
        costPerUnit: v.optional(v.number()),
        date: v.string(),
        userId: v.id("users"),
        status: v.optional(v.string()), // active, completed, expired
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_date", ["date"])
        .index("by_status", ["status"]),

    /** Rental / hire records (power tools, event equipment, vehicles). */
    rentals: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        assetId: v.optional(v.id("assets")),
        assetName: v.string(),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        startDate: v.string(),
        endDate: v.optional(v.string()),
        rate: v.number(),
        deposit: v.optional(v.number()),
        status: v.string(), // reserved, out, returned, overdue
        notes: v.optional(v.string()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_status", ["status"])
        .index("by_customerId", ["customerId"]),

    /** Route fares for transport operators. */
    routeFares: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        routeName: v.string(),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        fare: v.number(),
        vehicleType: v.optional(v.string()),
        active: v.optional(v.boolean()),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_routeName", ["routeName"]),

    /** Per-category settings the operator can toggle at runtime. */
    categorySettings: defineTable({
        businessProfileId: v.optional(v.id("businessProfiles")),
        categoryId: v.string(),
        settings: v.record(v.string(), v.any()),
        updatedAt: v.string(),
        updatedBy: v.optional(v.id("users")),
    }).index("by_businessProfileId", ["businessProfileId"]).index("by_categoryId", ["categoryId"]),

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
        attempts: v.optional(v.number()), // Failed verification attempts (brute-force guard)
    }).index("by_email", ["email"]),

    counters: defineTable({
        name: v.string(), // e.g. "invoice"
        lastValue: v.number(),
    }).index("by_name", ["name"]),

    stockLedger: defineTable({
        stockId: v.id("stocks"),
        shopId: v.optional(v.id("shops")), // null/undefined = HQ warehouse
        deltaQty: v.number(),              // negative for sales/issues, positive for restocks/voids
        eventType: v.string(),             // "SALE", "SALE_VOID", "RESTOCK", "SHOP_ISSUE", "ADJUSTMENT"
        referenceId: v.optional(v.string()), // saleId, invoice number, etc.
        userId: v.id("users"),
        timestamp: v.string(),
        notes: v.optional(v.string()),
    })
        .index("by_stockId", ["stockId"])
        .index("by_shop_stock", ["shopId", "stockId"])
        .index("by_timestamp", ["timestamp"])
        .index("by_eventType", ["eventType"]),
});

