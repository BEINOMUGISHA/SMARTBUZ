import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    /* ────────────────────────────────────────────────────────────────
     * TENANT MODEL
     *
     * `businesses` is the tenant. Every tenant-owned record carries a
     * `businessId` and is indexed by it, so a query can never accidentally
     * read across a business boundary — the boundary is part of the
     * primary key of every index.
     *
     * `businessId` is optional in the schema only so that the schema push
     * does not invalidate rows written before the migration; the server
     * always treats a missing `businessId` as "not visible to anyone" and
     * `scripts/migrate-to-multitenancy.mjs` backfills them.
     * ──────────────────────────────────────────────────────────────── */

    /** The tenant. One row per business. */
    businesses: defineTable({
        name: v.string(),
        /** URL-safe identifier, unique per business. */
        slug: v.optional(v.string()),
        // Modern vertical id from src/lib/business-categories.ts (e.g. "pharmacy").
        categoryId: v.optional(v.string()),
        businessType: v.optional(v.string()),
        industry: v.optional(v.string()),
        modules: v.array(v.string()),

        /** Money + time. Both are per business (AUDIT.md §5.3, §5.6). */
        currency: v.optional(v.string()), // "UGX"
        currencySymbol: v.optional(v.string()),
        timezone: v.optional(v.string()), // "Africa/Kampala"
        locale: v.optional(v.string()), // "en-UG"
        dateFormat: v.optional(v.string()), // "dd/MM/yyyy"
        country: v.optional(v.string()), // "Uganda"

        /** URA tax configuration. The server owns the rate (verticals/tax.ts). */
        taxEnabled: v.optional(v.boolean()),
        taxRate: v.optional(v.number()),
        taxInclusive: v.optional(v.boolean()),
        taxNote: v.optional(v.string()),
        tin: v.optional(v.string()), // URA Taxpayer Identification Number

        /** Allow cashiers to override a line price at the till. */
        allowPriceOverrides: v.optional(v.boolean()),
        /** Opening cash float for cash reconciliation (till opening balance). */
        openingFloat: v.optional(v.number()),

        /** "active" | "suspended" | "closed" */
        status: v.optional(v.string()),
        /** The user who owns this business. Exactly one owner per business. */
        ownerId: v.optional(v.id("users")),
        createdBy: v.optional(v.id("users")),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
        businessAddress: v.optional(v.string()),
        businessPhone: v.optional(v.string()),

        /** Onboarding progress: which setup steps are still outstanding. */
        onboardingComplete: v.optional(v.boolean()),
        onboardingStep: v.optional(v.string()),

        /** Monthly subscription plan for SaaS billing. */
        plan: v.optional(v.string()),
        subscriptionStatus: v.optional(v.string()), // trial, active, expired, cancelled
        subscriptionExpiresAt: v.optional(v.string()),
    })
        .index("by_ownerId", ["ownerId"])
        .index("by_slug", ["slug"])
        .index("by_categoryId", ["categoryId"])
        .index("by_status", ["status"]),

    /**
     * Membership of a user in a business. A user may belong to many
     * businesses (AUDIT.md §2.3: "support users belonging to multiple
     * businesses"), and each membership carries the role and status that
     * decide what that user may do *inside that business only*.
     */
    memberships: defineTable({
        userId: v.id("users"),
        businessId: v.id("businesses"),
        /**
         * One of the Phase 2 business roles: business_owner,
         * business_admin, branch_manager, supervisor, cashier,
         * inventory_manager, accountant, salesperson, auditor.
         * See `convex/rbac.ts`.
         */
        role: v.string(),
        /** active | invited | suspended */
        status: v.optional(v.string()),
        jobTitle: v.optional(v.string()),
        employeeId: v.optional(v.id("employees")),
        /**
         * The branches this member is confined to.
         *
         * Empty/absent means "every branch of the business", except for
         * branch-scoped roles (a branch manager), which fall back to the
         * branches they manage. See `allowedBranchIds` in
         * `convex/tenancy.ts`.
         */
        branchIds: v.optional(v.array(v.id("branches"))),
        invitedBy: v.optional(v.id("users")),
        invitedAt: v.optional(v.string()),
        joinedAt: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    })
        .index("by_userId", ["userId"])
        .index("by_businessId", ["businessId"])
        .index("by_businessId_userId", ["businessId", "userId"])
        .index("by_businessId_role", ["businessId", "role"])
        .index("by_userId_status", ["userId", "status"]),

    /**
     * Staff records of a business. An employee is a person who works for
     * the business; it may or may not have a linked login account.
     */
    employees: defineTable({
        businessId: v.id("businesses"),
        /** Linked login account, when this employee can sign in. */
        userId: v.optional(v.id("users")),
        employeeCode: v.optional(v.string()),
        fullName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        jobTitle: v.optional(v.string()),
        department: v.optional(v.string()),
        branchId: v.optional(v.id("branches")),
        warehouseId: v.optional(v.id("warehouses")),
        /** Role requested for this employee. */
        role: v.optional(v.string()),
        /** active | inactive | suspended */
        status: v.optional(v.string()),
        hiredAt: v.optional(v.string()),
        salary: v.optional(v.number()),
        notes: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_status", ["businessId", "status"])
        .index("by_userId", ["userId"])
        .index("by_email", ["email"]),

    /** Sales points of a business (the shop counter / outlet). */
    branches: defineTable({
        businessId: v.id("businesses"),
        name: v.string(),
        code: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        managerId: v.optional(v.id("users")),
        /** Default warehouse that serves this branch. */
        warehouseId: v.optional(v.id("warehouses")),
        /** Exactly one branch per business is the default. */
        isDefault: v.optional(v.boolean()),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_isActive", ["businessId", "isActive"]),

    /** Storage locations of a business (head office stock, branch stock). */
    warehouses: defineTable({
        businessId: v.id("businesses"),
        name: v.string(),
        code: v.optional(v.string()),
        address: v.optional(v.string()),
        /** main | branch | transit | supplier */
        type: v.optional(v.string()),
        location: v.optional(v.string()),
        managerId: v.optional(v.id("users")),
        /** Exactly one warehouse per business is the default. */
        isDefault: v.optional(v.boolean()),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_isActive", ["businessId", "isActive"]),

    /** Outstanding invitations to join a business. */
    businessInvitations: defineTable({
        businessId: v.id("businesses"),
        email: v.string(),
        role: v.optional(v.string()),
        jobTitle: v.optional(v.string()),
        invitedBy: v.optional(v.id("users")),
        token: v.optional(v.string()),
        /** pending | accepted | revoked */
        status: v.optional(v.string()),
        expiresAt: v.optional(v.number()),
        createdAt: v.optional(v.string()),
        acceptedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_email", ["email"])
        .index("by_businessId_status", ["businessId", "status"]),

    /* ────────────────────────────────────────────────────────────────
     * IDENTITY (global, not tenant-owned)
     * ──────────────────────────────────────────────────────────────── */

    users: defineTable({
        first_name: v.string(),
        middle_name: v.optional(v.string()),
        last_name: v.string(),
        email: v.string(),
        password: v.string(), // Hashed
        roles: v.array(v.string()), // legacy global vocabulary; the real role lives on the membership
        profile_picture: v.optional(v.string()),
        address: v.optional(v.string()),
        phone_number: v.optional(v.string()),
        date_of_birth: v.optional(v.string()),
        gender: v.optional(v.string()),
        marital_status: v.optional(v.string()),
        nationality: v.optional(v.string()),
        /**
         * The business this user is currently working in. Switching
         * businesses updates this field; the server uses it to resolve
         * the tenant for every request, so the client never gets to
         * choose a tenant it has no membership in.
         */
        activeBusinessId: v.optional(v.id("businesses")),
        /** active | pending_verification | suspended */
        status: v.optional(v.string()),
        /** True once the address has been proven by a verification code. */
        emailVerified: v.optional(v.boolean()),
        emailVerifiedAt: v.optional(v.string()),
        lastLoginAt: v.optional(v.string()),
        /** When the password last changed — used to expire old sessions. */
        passwordChangedAt: v.optional(v.string()),
        createdAt: v.optional(v.string()),
    }).index("by_email", ["email"])
        .index("by_activeBusinessId", ["activeBusinessId"])
        .index("by_status", ["status"]),

    /**
     * Platform administrators.
     *
     * A platform role is global — it is not a membership in a business.
     * Only a `platform_super_admin` may write to this table, so a business
     * administrator can never promote themselves to platform level.
     */
    platformAdmins: defineTable({
        userId: v.id("users"),
        /** platform_super_admin | platform_support */
        role: v.string(),
        /** active | revoked */
        status: v.optional(v.string()),
        grantedBy: v.optional(v.id("users")),
        grantedAt: v.optional(v.string()),
        revokedAt: v.optional(v.string()),
        revokedBy: v.optional(v.id("users")),
        notes: v.optional(v.string()),
    })
        .index("by_userId", ["userId"])
        .index("by_role", ["role"])
        .index("by_status", ["status"]),

    /**
     * Server-side sessions.
     *
     * The browser only holds an HttpOnly cookie; the access token it
     * receives carries the `sessionId` in its `sid` claim. Revoking a
     * session here stops that token immediately, rather than waiting out
     * its 15-minute lifetime.
     */
    sessions: defineTable({
        userId: v.id("users"),
        /** Public identifier of the session; carried in the token's `sid`. */
        sessionId: v.string(),
        /** SHA-256 of the session secret. The secret itself is never stored. */
        secretHash: v.optional(v.string()),
        createdAt: v.number(),
        expiresAt: v.number(),
        lastSeenAt: v.optional(v.number()),
        /** The business the session was active in when it was created. */
        businessId: v.optional(v.id("businesses")),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        revokedAt: v.optional(v.number()),
        revokedReason: v.optional(v.string()),
    })
        .index("by_userId", ["userId"])
        .index("by_sessionId", ["sessionId"])
        .index("by_expiresAt", ["expiresAt"]),

    /**
     * Email verification codes.
     *
     * A new account starts as `pending_verification` and cannot sign in
     * until the address is proven.
     */
    emailVerifications: defineTable({
        userId: v.id("users"),
        email: v.string(),
        /** Hashed code — the plain code only ever exists in the email. */
        codeHash: v.string(),
        expiresAt: v.number(),
        attempts: v.optional(v.number()),
        verifiedAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_userId", ["userId"])
        .index("by_email", ["email"]),

    /**
     * Custom permissions granted to a *role* inside one business.
     *
     * A business administrator may widen a role (for example give
     * `supervisor` `sales.refund`) or narrow it. Grants can never include
     * a platform-only permission.
     */
    customRolePermissions: defineTable({
        businessId: v.id("businesses"),
        /** The business role the override applies to. */
        role: v.string(),
        /** Canonical permissions added to the role's defaults. */
        granted: v.optional(v.array(v.string())),
        /** Canonical permissions removed from the role's defaults. */
        denied: v.optional(v.array(v.string())),
        updatedBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId_role", ["businessId", "role"])
        .index("by_businessId", ["businessId"]),

    /**
     * Custom permissions granted to one *member* inside one business.
     */
    memberPermissionOverrides: defineTable({
        businessId: v.id("businesses"),
        userId: v.id("users"),
        granted: v.optional(v.array(v.string())),
        denied: v.optional(v.array(v.string())),
        grantedBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId_userId", ["businessId", "userId"])
        .index("by_businessId", ["businessId"]),

    /**
     * The security audit trail.
     *
     * Unlike `activityLogs` (a business-scoped feed of ordinary events),
     * this table records *privileged* actions: role and permission
     * changes, sign-ins, session revocations and platform operations. It
     * is append-only — there is no mutation that edits or deletes a row.
     */
    auditLogs: defineTable({
        /** Absent for platform-scope events. */
        businessId: v.optional(v.id("businesses")),
        actorUserId: v.optional(v.id("users")),
        /** The role the actor held when the action happened. */
        actorRole: v.optional(v.string()),
        /** e.g. "auth.login", "rbac.role.change", "platform.subscription.update" */
        action: v.string(),
        targetType: v.optional(v.string()),
        targetId: v.optional(v.string()),
        /** JSON payload with the details of the action. */
        metadata: v.optional(v.any()),
        /** "success" | "denied" */
        outcome: v.optional(v.string()),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        timestamp: v.string(),
    })
        .index("by_businessId_timestamp", ["businessId", "timestamp"])
        .index("by_timestamp", ["timestamp"])
        .index("by_actorUserId", ["actorUserId"])
        .index("by_action", ["action"]),

    userTypes: defineTable({
        type: v.string(),
    }),

    categories: defineTable({
        type: v.string(), // name of the category
        businessId: v.optional(v.id("businesses")),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_type", ["businessId", "type"]),

    stocks: defineTable({
        businessId: v.optional(v.id("businesses")),
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
        /** Where this product is stored. */
        warehouseId: v.optional(v.id("warehouses")),
        /** The branch this product belongs to (when branch-level stock). */
        branchId: v.optional(v.id("branches")),
        /**
         * The barcode printed on the product, if it has one.
         *
         * This is what a barcode scanner looks up. A product without a
         * barcode can still be sold — it is found by name — but it cannot
         * be scanned.
         */
        barcode: v.optional(v.string()),
        /**
         * The unit this product is measured in — `kg`, `crate`, `strip`.
         *
         * The catalogue's default unit is only a suggestion; this is what
         * the business actually sells in.
         */
        unit: v.optional(v.string()),
        /**
         * How many of `unit` make one whole pack — 12 for a dozen, 24 for
         * a crate of cans. Used by the bulk and wholesaler packages to turn
         * a price per pack into a price per unit.
         */
        unitsPerPack: v.optional(v.number()),
        /**
         * Whether the quantity may be fractional.
         *
         * A pharmacy's tablets are not sold in halves; a butcher's meat is.
         */
        allowFractional: v.optional(v.boolean()),
        /**
         * Whether this product is sold by weight.
         *
         * A weighed product's price is per unit of weight, and the till
         * takes the weight from a scale.
         */
        weightBased: v.optional(v.boolean()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_productCode", ["productCode"])
        .index("by_businessId_productCode", ["businessId", "productCode"])
        .index("by_businessId_category", ["businessId", "categoryId"])
        .index("by_businessId_warehouse", ["businessId", "warehouseId"])
        .index("by_qty", ["qty"])
        .index("by_category", ["categoryId"])
        .index("by_halfPrice", ["halfPrice"])
        .index("by_barcode", ["barcode"])
        .index("by_businessId_barcode", ["businessId", "barcode"])
        .searchIndex("search_name", { searchField: "name" })
        .searchIndex("search_supplier", { searchField: "supplier" }),

    customers: defineTable({
        businessId: v.optional(v.id("businesses")),
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        distributorId: v.optional(v.string()), // Custom ID for receipts
        address: v.optional(v.string()),
        /**
         * The branch this customer trades with. A customer may belong to
         * the business as a whole, or to one branch.
         */
        branchId: v.optional(v.id("branches")),
        /** retail | wholesale | credit */
        type: v.optional(v.string()),
        /**
         * The maximum credit this customer may carry. `0` means no credit.
         * The outstanding balance is derived from the loans and payments
         * on the account — it is never stored, so it cannot drift.
         */
        creditLimit: v.optional(v.number()),
        /** Loyalty points earned and available to spend. */
        loyaltyPoints: v.optional(v.number()),
        /** Lifetime value — the sum of this customer's sales. */
        totalSpent: v.optional(v.number()),
        /** When the customer last bought something. */
        lastPurchaseAt: v.optional(v.string()),
        notes: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_phone", ["phone"])
        .index("by_businessId_phone", ["businessId", "phone"])
        .index("by_businessId_branch", ["businessId", "branchId"])
        .searchIndex("search_name", { searchField: "name" })
        .searchIndex("search_distributorId", { searchField: "distributorId" }),

    promotions: defineTable({
        businessId: v.optional(v.id("businesses")),
        name: v.string(),
        prize: v.string(), // "what you win"
        isActive: v.boolean(),
        triggerType: v.optional(v.string()), // "Product", "TotalPV", "TotalBV"
        threshold: v.optional(v.number()),
    })
        .index("by_businessId", ["businessId"])
        .searchIndex("search_name", { searchField: "name" }),

    promotionProducts: defineTable({
        businessId: v.optional(v.id("businesses")),
        promotionId: v.id("promotions"),
        stockId: v.id("stocks"),
        requiredQuantity: v.number(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_promotion", ["promotionId"]),

    promotionRedemptions: defineTable({
        businessId: v.optional(v.id("businesses")),
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
        .index("by_businessId", ["businessId"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_salesId", ["salesId"]),

    sales: defineTable({
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        branchId: v.optional(v.id("branches")),
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
                /**
                 * What the till believed was on hand when it made this sale.
                 *
                 * Recorded only for sales made offline. When the server later
                 * finds a different figure, this is how it knows the stock
                 * moved under another device rather than simply being wrong.
                 */
                expectedQty: v.optional(v.number()),
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
        /**
         * Refunds. A refund is a separate, permissioned action
         * (`sales.refund`), not a sale edit — the stock comes back and the
         * trail records who authorised it.
         */
        refundAmount: v.optional(v.number()),
        refundedAt: v.optional(v.string()),
        refundedBy: v.optional(v.id("users")),
        refundReason: v.optional(v.string()),
        refundedItems: v.optional(v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                productCode: v.optional(v.string()),
                quantity: v.number(),
                amount: v.number(),
            })
        )),
        clientOfflineId: v.optional(v.string()), // Idempotency key for offline queued sales
        isOfflineSync: v.optional(v.boolean()),
        /**
         * The moment the sale happened **on the till**.
         *
         * An offline sale reaches the server later, but it belongs to the day
         * it was rung up — not the day it happened to find the network. The
         * reports are built from this date, not from the moment the server
         * happened to receive it.
         */
        occurredAt: v.optional(v.string()),
        /**
         * The installation that recorded the sale.
         *
         * "Which till rang this up" is the first question asked about any
         * offline sale that turns out to be a problem.
         */
        deviceId: v.optional(v.string()),
        /**
         * Whether the money has actually been confirmed.
         *
         * `pending_verification` means nobody has seen the payment but the
         * customer and the cashier. An offline mobile-money payment is
         * **not** a confirmed payment: it stays pending until it is checked
         * against the provider's own record. Cash in the drawer is a
         * different matter — that money is already in the business.
         */
        paymentConfirmation: v.optional(v.string()), // confirmed | pending_verification
        /**
         * The payment provider's reference for this sale.
         *
         * When this is present, the payment was taken through a provider
         * and the sale stays `pending_verification` until the provider
         * confirms it — the cashier's word is not the provider's
         * confirmation.
         *
         * A sale with no reference was paid for in front of the cashier
         * (cash, or a mobile-money transfer they watched arrive), which
         * is a different thing.
         */
        paymentReference: v.optional(v.string()),
        /** online | offline — where the sale was first recorded. */
        syncSource: v.optional(v.string()),
        /** The unique id of the transaction, wherever it was first created. */
        clientTransactionId: v.optional(v.string()),
        /**
         * What the till thought the sale came to.
         *
         * Recorded only for offline sales, where the price list on the till
         * may have been out of date. The books use the server's price — this
         * is kept so the difference can be seen and explained rather than
         * quietly swallowed.
         */
        clientTotal: v.optional(v.number()),
        // Price override audit trail. `hasPriceOverride` is true when the
        // business allows till-level price changes; `priceOverrides` records
        // the master price that was replaced on each affected line.
        hasPriceOverride: v.optional(v.boolean()),
        priceOverrides: v.optional(v.array(
            v.object({
                stockId: v.id("stocks"),
                name: v.string(),
                originalPrice: v.number(),
                price: v.number(),
            })
        )),
    }).index("by_businessId", ["businessId"])
        .index("by_businessId_date", ["businessId", "date"])
        .index("by_businessId_shop_date", ["businessId", "shopId", "date"])
        /** Branch-scoped reporting: the finance reports filter by branch. */
        .index("by_businessId_branch_date", ["businessId", "branchId", "date"])
        .index("by_date", ["date"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_customer_date", ["customerId", "date"])
        .index("by_invoiceNumber", ["invoiceNumber"])
        .index("by_clientOfflineId", ["clientOfflineId"])
        .index("by_businessId_occurredAt", ["businessId", "occurredAt"])
        .index("by_deviceId", ["deviceId"]),

    loans: defineTable({
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")), // Made optional for Walk-ins
        manualCustomerName: v.optional(v.string()), // For walk-in tracking
        salesId: v.id("sales"),
        amount: v.number(),
        balance: v.number(),
        date: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_customer", ["customerId"])
        .index("by_salesId", ["salesId"]),

    payments: defineTable({
        businessId: v.optional(v.id("businesses")),
        loanId: v.id("loans"),
        shopId: v.optional(v.id("shops")), // Scoped for auditing
        customerId: v.optional(v.id("customers")), // Scoped for auditing
        amount: v.number(),
        date: v.string(),
        balance: v.number(),
        /** cash | mobile_money | bank | card | cheque */
        method: v.optional(v.string()),
        /**
         * The receipt or transaction reference of this payment.
         *
         * Two payments with the same reference for the same customer are
         * the same payment — the second one is refused, so a double
         * submission cannot quietly pay an account twice.
         */
        reference: v.optional(v.string()),
        branchId: v.optional(v.id("branches")),
        userId: v.optional(v.id("users")),
        note: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_loan", ["loanId"])
        .index("by_date", ["date"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_customer", ["customerId"])
        .index("by_customer_date", ["customerId", "date"]),

    /**
     * Loyalty points movements.
     *
     * Kept separate from the money ledger: points are not money, and
     * mixing the two makes the statement unreadable.
     */
    loyaltyTransactions: defineTable({
        businessId: v.id("businesses"),
        customerId: v.id("customers"),
        /** Positive earns points, negative spends them. */
        points: v.number(),
        /** earn | redeem | adjust */
        type: v.string(),
        reason: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
        branchId: v.optional(v.id("branches")),
        date: v.string(),
        userId: v.optional(v.id("users")),
        /** The points balance after this movement. */
        balanceAfter: v.number(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_customer", ["customerId"])
        .index("by_customer_date", ["customerId", "date"]),

    expenses: defineTable({
        businessId: v.optional(v.id("businesses")),
        /**
         * The branch this expense belongs to.
         *
         * An expense with no branch is a business-wide expense: it is
         * counted in the business figures and left out of a single branch's
         * figures, because it cannot honestly be said to belong to one.
         */
        branchId: v.optional(v.id("branches")),
        date: v.string(),
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(), // category of expense
        userId: v.optional(v.id("users")), // user who recorded the expense
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_date", ["businessId", "date"])
        .index("by_businessId_branch_date", ["businessId", "branchId", "date"])
        .index("by_date", ["date"]),

    shops: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** Link to the branch this shop counter belongs to. */
        branchId: v.optional(v.id("branches")),
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
    })
        .index("by_businessId", ["businessId"])
        .index("by_user", ["userId"]),

    /**
     * @deprecated Superseded by `businesses`. Kept in the schema so the
     * migration can read the legacy rows before copying them; the table is
     * emptied by scripts/migrate-to-multitenancy.mjs and can be dropped
     * once every deployment has been migrated.
     */
    businessProfiles: defineTable({
        businessName: v.string(),
        businessType: v.string(),
        categoryId: v.optional(v.string()),
        industry: v.optional(v.string()),
        modules: v.array(v.string()),
        currency: v.optional(v.string()),
        country: v.optional(v.string()),
        taxEnabled: v.optional(v.boolean()),
        taxRate: v.optional(v.number()),
        taxInclusive: v.optional(v.boolean()),
        taxNote: v.optional(v.string()),
        tin: v.optional(v.string()),
        allowPriceOverrides: v.optional(v.boolean()),
        isActive: v.boolean(),
        createdBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
        businessAddress: v.optional(v.string()),
        businessPhone: v.optional(v.string()),
        openingFloat: v.optional(v.number()),
        plan: v.optional(v.string()),
        subscriptionStatus: v.optional(v.string()),
        subscriptionExpiresAt: v.optional(v.string()),
    }).index("by_businessType", ["businessType"])
        .index("by_active", ["isActive"])
        .index("by_categoryId", ["categoryId"]),

    /* ───────────── Vertical modules ───────────── */

    /** Batches for batch/expiry tracking (pharmacy, supermarket, butchery). */
    productBatches: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_stockId", ["stockId"])
        .index("by_expiryDate", ["expiryDate"])
        .index("by_date", ["date"]),

    /** Appointments / bookings for service verticals. */
    appointments: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_date", ["date"])
        .index("by_status", ["status"])
        .index("by_customer", ["customerId"])
        .index("by_businessType", ["businessType"]),

    /** Restaurant tables / hotel rooms / beauty chairs. */
    serviceOutlets: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        businessType: v.string(), // "table" | "room" | "chair"
        name: v.string(),
        capacity: v.optional(v.number()),
        status: v.string(), // available, occupied, reserved, cleaning
        rate: v.optional(v.number()), // per night / per session
        currentBookingId: v.optional(v.id("appointments")),
        shopId: v.optional(v.id("shops")),
        notes: v.optional(v.string()),

    }).index("by_businessId", ["businessId"]).index("by_businessType", ["businessType"])
        .index("by_status", ["status"]),

    /** Restaurant / café menu items linked to stock where applicable. */
    menuItems: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        category: v.string(),
        price: v.number(),
        description: v.optional(v.string()),
        available: v.optional(v.boolean()),
        preparationMinutes: v.optional(v.number()),
        dietary: v.optional(v.array(v.string())), // vegan, gluten-free, halal

    }).index("by_businessId", ["businessId"]).index("by_category", ["category"]),

    /** Members — SACCO, gym, school, church, NGO, real estate. */
    members: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_memberNumber", ["memberNumber"])
        .index("by_status", ["status"]),

    /** Member / customer financial ledger (shares, savings, fees). */
    memberTransactions: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        memberId: v.id("members"),
        type: v.string(), // deposit, withdrawal, share_purchase, loan, repayment, fee
        amount: v.number(),
        balanceAfter: v.number(),
        date: v.string(),
        reference: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.optional(v.id("users")),

    }).index("by_businessId", ["businessId"]).index("by_memberId", ["memberId"])
        .index("by_date", ["date"]),

    /** Customers with a saved money balance (credit books, layaway). */
    customerWallets: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.id("customers"),
        balance: v.number(),
        creditLimit: v.optional(v.number()),
        updatedAt: v.string(),

    }).index("by_businessId", ["businessId"]).index("by_customerId", ["customerId"]),

    /** Wallet ledger entries. */
    walletTransactions: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_customerId", ["customerId"])
        .index("by_date", ["date"]),

    /** Service tickets — repair jobs, laundry garments, cleaning visits. */
    serviceTickets: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_status", ["status"])
        .index("by_ticketNumber", ["ticketNumber"])
        .index("by_customer", ["customerId"]),

    /** Commissions earned by staff (barbers, stylists, agents). */
    staffCommissions: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_userId", ["userId"])
        .index("by_saleDate", ["saleDate"]),

    /** Asset register — vehicles, pumps, equipment, rental items. */
    assets: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_assetTag", ["assetTag"])
        .index("by_category", ["category"])
        .index("by_status", ["status"]),

    /** Suppliers with payment terms (real purchasing workflow). */
    suppliers: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        name: v.string(),
        contact: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        paymentTerms: v.optional(v.string()), // "Net 30"
        /** Payment terms in days — used to work out when an invoice falls due. */
        paymentTermsDays: v.optional(v.number()),
        taxNumber: v.optional(v.string()),
        /** The branch this supplier serves. */
        branchId: v.optional(v.id("branches")),
        /**
         * What the business owes this supplier.
         *
         * Derived from the supplier ledger — it is a cached convenience
         * field that is written on the same transaction as every ledger
         * entry, never the source of truth.
         */
        balance: v.optional(v.number()),
        currency: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
        notes: v.optional(v.string()),

    }).index("by_businessId", ["businessId"]).index("by_name", ["name"])
        .index("by_businessId_branch", ["businessId", "branchId"])
        .searchIndex("search_name", { searchField: "name" })
        .searchIndex("search_contact", { searchField: "contact" }),

    /**
     * The supplier account ledger.
     *
     * Every movement on a supplier account is one row here, in order, with
     * the running balance after it. That is what makes a supplier
     * statement possible and what makes an audit answerable.
     *
     * `amount` is signed from the supplier's point of view: a positive
     * amount increases what the business owes the supplier (an invoice),
     * a negative amount reduces it (a payment or a return).
     */
    supplierLedger: defineTable({
        businessId: v.id("businesses"),
        supplierId: v.id("suppliers"),
        /** invoice | payment | return | adjustment | credit */
        type: v.string(),
        /** Signed movement. */
        amount: v.number(),
        /** The balance owed after this movement. */
        balanceAfter: v.number(),
        invoiceId: v.optional(v.id("supplierInvoices")),
        purchaseOrderId: v.optional(v.id("purchaseOrders")),
        paymentId: v.optional(v.id("purchasePayments")),
        purchaseReturnId: v.optional(v.id("purchaseReturns")),
        branchId: v.optional(v.id("branches")),
        warehouseId: v.optional(v.id("warehouses")),
        /** The document this movement came from — an invoice number, a receipt. */
        reference: v.optional(v.string()),
        date: v.string(),
        userId: v.optional(v.id("users")),
        notes: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_supplier", ["supplierId"])
        .index("by_supplier_date", ["supplierId", "date"])
        .index("by_date", ["date"]),

    /**
     * An invoice received from a supplier.
     */
    supplierInvoices: defineTable({
        businessId: v.id("businesses"),
        invoiceNumber: v.string(),
        supplierId: v.id("suppliers"),
        supplierName: v.string(),
        date: v.string(),
        dueDate: v.optional(v.string()),
        /** The invoice total, before payments. */
        total: v.number(),
        /** How much has been paid against it. */
        amountPaid: v.number(),
        /** draft | open | partial | paid | cancelled */
        status: v.string(),
        purchaseOrderId: v.optional(v.id("purchaseOrders")),
        branchId: v.optional(v.id("branches")),
        warehouseId: v.optional(v.id("warehouses")),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            productCode: v.optional(v.string()),
            quantity: v.number(),
            unitCost: v.number(),
            /** Units of this line already returned to the supplier. */
            returnedQty: v.optional(v.number()),
        })),
        notes: v.optional(v.string()),
        createdBy: v.optional(v.id("users")),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_supplier", ["supplierId"])
        .index("by_supplier_date", ["supplierId", "date"])
        .index("by_invoiceNumber", ["invoiceNumber"])
        .index("by_status", ["status"]),

    /**
     * A payment made to a supplier.
     */
    purchasePayments: defineTable({
        businessId: v.id("businesses"),
        supplierId: v.id("suppliers"),
        supplierName: v.string(),
        amount: v.number(),
        date: v.string(),
        /** cash | mobile_money | bank | card | cheque */
        method: v.optional(v.string()),
        /**
         * The bank or receipt reference.
         *
         * Two payments with the same reference for the same supplier are
         * the same payment. The second one is refused, so a double
         * submission cannot quietly pay an invoice twice.
         */
        reference: v.optional(v.string()),
        invoiceId: v.optional(v.id("supplierInvoices")),
        purchaseOrderId: v.optional(v.id("purchaseOrders")),
        branchId: v.optional(v.id("branches")),
        userId: v.optional(v.id("users")),
        notes: v.optional(v.string()),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_supplier", ["supplierId"])
        .index("by_supplier_date", ["supplierId", "date"])
        .index("by_invoice", ["invoiceId"])
        .index("by_date", ["date"]),

    /**
     * Goods returned to a supplier.
     */
    purchaseReturns: defineTable({
        businessId: v.id("businesses"),
        returnNumber: v.string(),
        supplierId: v.id("suppliers"),
        supplierName: v.string(),
        purchaseOrderId: v.optional(v.id("purchaseOrders")),
        invoiceId: v.optional(v.id("supplierInvoices")),
        goodsReceiptId: v.optional(v.id("goodsReceipts")),
        date: v.string(),
        /** The credit the supplier is expected to give back. */
        total: v.number(),
        /** draft | completed | cancelled */
        status: v.string(),
        branchId: v.optional(v.id("branches")),
        warehouseId: v.optional(v.id("warehouses")),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            productCode: v.optional(v.string()),
            quantity: v.number(),
            unitCost: v.number(),
        })),
        notes: v.optional(v.string()),
        userId: v.optional(v.id("users")),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_supplier", ["supplierId"])
        .index("by_returnNumber", ["returnNumber"])
        .index("by_date", ["date"]),

    /**
     * What each product cost, and when.
     *
     * The purchase price on a product changes over time. This table keeps
     * every purchase cost in the order it happened, so the margin of a
     * sale can be worked out from the cost that actually applied then —
     * not from today's price.
     */
    stockCostHistory: defineTable({
        businessId: v.id("businesses"),
        stockId: v.id("stocks"),
        productCode: v.optional(v.string()),
        name: v.string(),
        /** The unit cost paid. */
        unitCost: v.number(),
        quantity: v.number(),
        /** unitCost × quantity. */
        totalCost: v.number(),
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.optional(v.string()),
        purchaseOrderId: v.optional(v.id("purchaseOrders")),
        goodsReceiptId: v.optional(v.id("goodsReceipts")),
        invoiceId: v.optional(v.id("supplierInvoices")),
        purchaseReturnId: v.optional(v.id("purchaseReturns")),
        branchId: v.optional(v.id("branches")),
        warehouseId: v.optional(v.id("warehouses")),
        date: v.string(),
        recordedBy: v.optional(v.id("users")),
    })
        .index("by_businessId", ["businessId"])
        .index("by_stock", ["stockId"])
        .index("by_stock_date", ["stockId", "date"])
        .index("by_supplier", ["supplierId"])
        .index("by_date", ["date"]),

    /** Purchase orders to suppliers. */
    purchaseOrders: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        poNumber: v.string(),
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.string(),
        /** draft | ordered | partially_received | received | cancelled */
        status: v.string(),
        date: v.string(),
        expectedDate: v.optional(v.string()),
        total: v.number(),
        /** How much of this order has been paid. */
        amountPaid: v.optional(v.number()),
        receivedDate: v.optional(v.string()),
        /** The branch this order is for. */
        branchId: v.optional(v.id("branches")),
        /** The warehouse the goods are expected to land in. */
        warehouseId: v.optional(v.id("warehouses")),
        /** The supplier invoice that settles this order. */
        invoiceId: v.optional(v.id("supplierInvoices")),
        notes: v.optional(v.string()),
        userId: v.id("users"),
        cancelledAt: v.optional(v.string()),
        cancelledBy: v.optional(v.id("users")),
        updatedAt: v.optional(v.string()),
        items: v.array(v.object({
            stockId: v.optional(v.id("stocks")),
            name: v.string(),
            productCode: v.optional(v.string()),
            quantity: v.number(),
            unitCost: v.number(),
            /** Units already received against this line. */
            receivedQty: v.optional(v.number()),
            /** Units already returned against this line. */
            returnedQty: v.optional(v.number()),
        })),

    }).index("by_businessId", ["businessId"]).index("by_poNumber", ["poNumber"])
        .index("by_status", ["status"])
        .index("by_date", ["date"])
        .index("by_businessId_date", ["businessId", "date"])
        .index("by_supplier", ["supplierId"]),

    /** Goods received against a purchase order. */
    goodsReceipts: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        poId: v.optional(v.id("purchaseOrders")),
        receiptNumber: v.string(),
        supplierId: v.optional(v.id("suppliers")),
        supplierName: v.string(),
        date: v.string(),
        total: v.number(),
        /** The branch the goods arrived at. */
        branchId: v.optional(v.id("branches")),
        /** The warehouse the goods were put away in. */
        warehouseId: v.optional(v.id("warehouses")),
        /** The supplier invoice this receipt settles, when there is one. */
        invoiceId: v.optional(v.id("supplierInvoices")),
        userId: v.id("users"),
        notes: v.optional(v.string()),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            productCode: v.optional(v.string()),
            quantity: v.number(),
            unitCost: v.number(),
            /** Which line of the purchase order this receipt settles. */
            poItemIndex: v.optional(v.number()),
        })),

    }).index("by_businessId", ["businessId"]).index("by_receiptNumber", ["receiptNumber"])
        .index("by_date", ["date"])
        .index("by_po", ["poId"])
        .index("by_businessId_date", ["businessId", "date"]),

    /** Deliveries / dispatch runs. */
    deliveries: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_status", ["status"])
        .index("by_date", ["createdAt"]),

    /** Fuel dispensing log (fuel stations). */
    fuelDispenses: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_date", ["date"])
        .index("by_fuelType", ["fuelType"]),

    /** Vehicle register (transport, driving school). */
    vehicles: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_registration", ["registration"])
        .index("by_status", ["status"]),

    /** Student / class enrolment (schools, driving schools, training). */
    classEnrolments: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        className: v.string(),
        studentId: v.optional(v.id("members")),
        studentName: v.string(),
        term: v.optional(v.string()),
        amountDue: v.number(),
        amountPaid: v.number(),
        status: v.string(), // active, graduated, withdrawn
        enrolledDate: v.string(),
        notes: v.optional(v.string()),

    }).index("by_businessId", ["businessId"]).index("by_className", ["className"])
        .index("by_studentId", ["studentId"]),

    /** Attendance register (schools, gyms, security, churches). */
    attendance: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        personId: v.optional(v.id("members")),
        personName: v.string(),
        className: v.optional(v.string()),
        date: v.string(),
        status: v.string(), // present, absent, late, excused
        recordedBy: v.optional(v.id("users")),

    }).index("by_businessId", ["businessId"]).index("by_date", ["date"])
        .index("by_personId", ["personId"]),

    /** Till / cash-shift sessions for cash reconciliation. */
    tillSessions: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_status", ["status"])
        .index("by_userId", ["userId"])
        .index("by_openedAt", ["openedAt"]),

    /** Donations / contributions (church, NGO). */
    donations: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_date", ["date"])
        .index("by_type", ["type"]),

    /** Retail sale lines for table service (restaurant / cafe). */
    tableOrders: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_outletId", ["outletId"])
        .index("by_status", ["status"]),

    /** Rent / hire / recurring charge schedule (real estate, security, cleaning). */
    recurringCharges: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_status", ["status"])
        .index("by_nextDueDate", ["nextDueDate"]),

    /** Serial / IMEI tracked units (phones, appliances, salvage). */
    productSerials: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        stockId: v.id("stocks"),
        serialNumber: v.string(),
        imei: v.optional(v.string()),
        status: v.string(), // in_stock, sold, returned, faulty
        condition: v.string(), // new, grade_a, grade_b, used
        warrantyExpiry: v.optional(v.string()),
        soldToCustomerId: v.optional(v.id("customers")),
        soldDate: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),

    }).index("by_businessId", ["businessId"]).index("by_stockId", ["stockId"])
        .index("by_serialNumber", ["serialNumber"])
        .index("by_status", ["status"]),

    /** Custom measurement sets (tailors, carpenters, welding). */
    customerMeasurements: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        customerId: v.id("customers"),
        customerName: v.string(),
        measurements: v.record(v.string(), v.number()),
        notes: v.optional(v.string()),
        updatedAt: v.string(),

    }).index("by_businessId", ["businessId"]).index("by_customerId", ["customerId"]),

    /** Production batches (bakeries, workshops, agro processing). */
    productionBatches: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_date", ["date"])
        .index("by_status", ["status"]),

    /** Rental / hire records (power tools, event equipment, vehicles). */
    rentals: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
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

    }).index("by_businessId", ["businessId"]).index("by_status", ["status"])
        .index("by_customerId", ["customerId"]),

    /** Route fares for transport operators. */
    routeFares: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        routeName: v.string(),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        fare: v.number(),
        vehicleType: v.optional(v.string()),
        active: v.optional(v.boolean()),

    }).index("by_businessId", ["businessId"]).index("by_routeName", ["routeName"]),

    /** Per-category settings the operator can toggle at runtime. */
    categorySettings: defineTable({
        businessId: v.optional(v.id("businesses")),
        /** @deprecated legacy pointer, migrated to businessId. */
        businessProfileId: v.optional(v.id("businessProfiles")),
        categoryId: v.string(),
        settings: v.record(v.string(), v.any()),
        updatedAt: v.string(),
        updatedBy: v.optional(v.id("users")),

    }).index("by_businessId", ["businessId"]).index("by_categoryId", ["categoryId"]),

    banking: defineTable({
        businessId: v.optional(v.id("businesses")),
        date: v.string(),
        amount: v.number(),
        comment: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_date", ["date"]),

    activityLogs: defineTable({
        businessId: v.optional(v.id("businesses")),
        userId: v.id("users"),
        action: v.string(), // e.g., "Add stock", "Create sale"
        details: v.string(), // JSON string or text
        timestamp: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_timestamp", ["timestamp"])
        .index("by_userId", ["userId"]),

    stockEntries: defineTable({
        businessId: v.optional(v.id("businesses")),
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
        .index("by_businessId", ["businessId"])
        .index("by_date", ["date"])
        .index("by_stockId", ["stockId"]),

    shopIssueRecords: defineTable({
        businessId: v.optional(v.id("businesses")),
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        quantity: v.number(),
        date: v.string(), // ISO String
        userId: v.id("users"),
    }).index("by_businessId", ["businessId"])
        .index("by_shop_date", ["shopId", "date"])
        .index("by_stockId", ["stockId"]),

    passwordResets: defineTable({
        email: v.string(),
        /**
         * The plain 6-digit code. Kept for backwards compatibility with
         * resets issued before hashing; new codes are stored in `codeHash`
         * only.
         */
        code: v.optional(v.string()),
        /** bcrypt hash of the code — the plain code is never stored. */
        codeHash: v.optional(v.string()),
        expiresAt: v.number(),
        attempts: v.optional(v.number()), // Failed verification attempts (brute-force guard)
        /** Set when the code has been used, so it cannot be replayed. */
        usedAt: v.optional(v.number()),
        requestedIp: v.optional(v.string()),
        createdAt: v.optional(v.number()),
    }).index("by_email", ["email"]),

    /** Sequential counters (invoice numbers). Scoped per business. */
    counters: defineTable({
        businessId: v.optional(v.id("businesses")),
        name: v.string(), // e.g. "invoice"
        lastValue: v.number(),
    }).index("by_businessId_name", ["businessId", "name"]),

    stockLedger: defineTable({
        businessId: v.optional(v.id("businesses")),
        stockId: v.id("stocks"),
        shopId: v.optional(v.id("shops")), // null/undefined = HQ warehouse
        deltaQty: v.number(),              // negative for sales/issues, positive for restocks/voids
        eventType: v.string(),             // "SALE", "SALE_VOID", "RESTOCK", "SHOP_ISSUE", "ADJUSTMENT"
        referenceId: v.optional(v.string()), // saleId, invoice number, etc.
        userId: v.id("users"),
        timestamp: v.string(),
        notes: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_stockId", ["stockId"])
        .index("by_shop_stock", ["shopId", "stockId"])
        .index("by_timestamp", ["timestamp"])
        .index("by_eventType", ["eventType"]),

    /**
     * A cashier shift — one till session.
     *
     * A shift opens with an **opening float** (the cash the cashier is given
     * to start with) and closes with the cash counted in the drawer. What
     * *should* be in the drawer is computed from the sales and the cash
     * movements of the shift, so the difference between counted and expected
     * is a real, explainable variance rather than a guess.
     */
    cashShifts: defineTable({
        businessId: v.id("businesses"),
        /** The branch whose till this is. */
        branchId: v.optional(v.id("branches")),
        /** The shop (counter) this shift was worked at, when there is one. */
        shopId: v.optional(v.id("shops")),
        /** The cashier who worked the shift. */
        userId: v.id("users"),
        /** A snapshot of the name, so the record still reads after a rename. */
        userName: v.string(),
        /** open | closed */
        status: v.string(),
        openedAt: v.string(),
        closedAt: v.optional(v.string()),
        /** The cash the cashier started with. */
        openingFloat: v.number(),
        /** The cash counted in the drawer when the shift closed. */
        countedCash: v.optional(v.number()),
        /** What the drawer should have held — computed, never typed in. */
        expectedCash: v.optional(v.number()),
        /** countedCash − expectedCash. Negative means cash is missing. */
        variance: v.optional(v.number()),
        notes: v.optional(v.string()),
        /** Who closed the shift. */
        closedBy: v.optional(v.id("users")),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_openedAt", ["businessId", "openedAt"])
        .index("by_businessId_branch", ["businessId", "branchId"])
        .index("by_userId", ["userId"])
        .index("by_status", ["status"]),

    /**
     * Money into or out of the till.
     *
     * This is the cash-drawer ledger: a pay-in (a float top-up, a bank
     * deposit being counted back in) or a pay-out (petty cash, a supplier
     * paid from the drawer). It is separate from `expenses` because paying a
     * bill from the drawer is not the same thing as an operating expense,
     * and from `purchasePayments` because this is the cash side of it.
     */
    cashMovements: defineTable({
        businessId: v.id("businesses"),
        branchId: v.optional(v.id("branches")),
        /** The shift this movement belongs to, when there is one. */
        shiftId: v.optional(v.id("cashShifts")),
        /** in | out */
        type: v.string(),
        amount: v.number(),
        /** What the money was for — float, deposit, petty cash, supplier… */
        category: v.string(),
        reason: v.string(),
        /**
         * The receipt or transaction reference.
         *
         * Two movements with the same reference are the same money, so the
         * second one is refused. A pay-out cannot be entered twice.
         */
        reference: v.optional(v.string()),
        date: v.string(),
        userId: v.id("users"),
        userName: v.optional(v.string()),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_date", ["businessId", "date"])
        .index("by_shiftId", ["shiftId"])
        .index("by_reference", ["reference"]),

    /**
     * Income that is not a sale.
     *
     * Rent from a third party, a service fee, a grant — money that came in
     * without goods leaving the shelf. Kept apart from `sales` so that
     * revenue stays the revenue and profit is not quietly flattered.
     */
    incomeRecords: defineTable({
        businessId: v.id("businesses"),
        branchId: v.optional(v.id("branches")),
        date: v.string(),
        amount: v.number(),
        /** Where the income came from. */
        source: v.string(),
        description: v.optional(v.string()),
        reference: v.optional(v.string()),
        userId: v.id("users"),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_date", ["businessId", "date"]),

    /**
     * A reconciliation between what a payment provider says was received and
     * what the books recorded.
     *
     * The variance is the point of the record: money that reached the bank
     * account but never reached the till, or the other way round.
     */
    reconciliations: defineTable({
        businessId: v.id("businesses"),
        branchId: v.optional(v.id("branches")),
        /** What is being reconciled: bank | mobile_money | cash. */
        kind: v.string(),
        /** The payment method being reconciled. */
        method: v.string(),
        /** The period being reconciled, as YYYY-MM. */
        period: v.string(),
        /** The provider's own reference for the statement. */
        statementReference: v.string(),
        /** What the provider says was received. */
        statementAmount: v.number(),
        /** What the books recorded. */
        recordedAmount: v.number(),
        /** statementAmount − recordedAmount. */
        variance: v.number(),
        /** reconciled | discrepancy */
        status: v.string(),
        notes: v.optional(v.string()),
        resolvedBy: v.optional(v.id("users")),
        resolvedAt: v.optional(v.string()),
        userId: v.id("users"),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_period", ["businessId", "period"])
        .index("by_status", ["status"]),

    /**
     * A subscription plan.
     *
     * The pricing is **data**, not code: the platform owner edits it, and
     * every price on the pricing page comes from this table. A plan says
     * what a business may do (its features) and how much of it there is
     * allowed (its limits).
     */
    plans: defineTable({
        /** The stable key a subscription refers to: starter, business… */
        key: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        /** The monthly price, in whole units of `currency`. */
        priceMonthly: v.number(),
        /** The annual price. Usually cheaper than twelve months of monthly. */
        priceAnnual: v.number(),
        currency: v.string(),
        /** How long the free trial lasts, in days. */
        trialDays: v.number(),
        /** How long the business keeps working after a failed payment. */
        gracePeriodDays: v.number(),
        /** How many devices may be registered. 0 means unlimited. */
        deviceLimit: v.number(),
        /** How many staff may have access. 0 means unlimited. */
        maxUsers: v.number(),
        /** How many branches the business may run. 0 means unlimited. */
        maxBranches: v.number(),
        /** How many warehouses the business may run. 0 means unlimited. */
        maxWarehouses: v.number(),
        /** How many products the business may stock. 0 means unlimited. */
        maxProducts: v.number(),
        /**
         * The entitlements this plan grants.
         *
         * These are the feature keys in `convex/entitlements.ts`. A feature
         * that is not in this list is not available to the business.
         */
        features: v.array(v.string()),
        /** A retired plan keeps its subscribers but cannot be chosen again. */
        isActive: v.boolean(),
        /** The order the plans are shown in on the pricing page. */
        sortOrder: v.number(),
        /** Whether this is one of the built-in plans. */
        isDefault: v.optional(v.boolean()),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
    })
        .index("by_key", ["key"])
        .index("by_isActive", ["isActive"]),

    /**
     * A business's subscription.
     *
     * One live subscription per business. It is **never deleted** — it is
     * cancelled or suspended — so the history of what a business paid for
     * and when stays readable.
     */
    subscriptions: defineTable({
        businessId: v.id("businesses"),
        /** The plan this subscription is on. */
        planKey: v.string(),
        /** trial | active | past_due | grace | suspended | expired | cancelled */
        status: v.string(),
        /** monthly | annual */
        billingCycle: v.string(),
        /** The start of the period that has been paid for. */
        currentPeriodStart: v.optional(v.string()),
        /** The end of the period that has been paid for. */
        currentPeriodEnd: v.optional(v.string()),
        /** When the free trial ends. */
        trialEndsAt: v.optional(v.string()),
        /** When the grace period ends — after this the business is blocked. */
        graceEndsAt: v.optional(v.string()),
        /** When the subscription was suspended, and why. */
        suspendedAt: v.optional(v.string()),
        suspendedReason: v.optional(v.string()),
        /** When the subscription was cancelled. */
        cancelledAt: v.optional(v.string()),
        /** Why the subscription was cancelled. */
        cancellationReason: v.optional(v.string()),
        /** The license key this subscription is bound to, when there is one. */
        licenseKeyId: v.optional(v.id("licenseKeys")),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_status", ["status"])
        .index("by_planKey", ["planKey"]),

    /**
     * The subscription history.
     *
     * Append-only: every change to a subscription is one row here, with the
     * status it moved from and the status it moved to. This is the record
     * of what the platform did and when.
     */
    subscriptionEvents: defineTable({
        businessId: v.id("businesses"),
        subscriptionId: v.optional(v.id("subscriptions")),
        /** created | trial_started | activated | renewed | extended | suspended | reactivated | cancelled | expired | payment_failed | payment_verified | plan_changed | device_revoked | license_issued | license_redeemed */
        type: v.string(),
        fromStatus: v.optional(v.string()),
        toStatus: v.optional(v.string()),
        fromPlan: v.optional(v.string()),
        toPlan: v.optional(v.string()),
        amount: v.optional(v.number()),
        currency: v.optional(v.string()),
        billingCycle: v.optional(v.string()),
        paymentId: v.optional(v.id("subscriptionPayments")),
        note: v.optional(v.string()),
        /** Who did it — a platform administrator, or the business owner. */
        actorUserId: v.optional(v.id("users")),
        actorRole: v.optional(v.string()),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_createdAt", ["businessId", "createdAt"])
        .index("by_subscriptionId", ["subscriptionId"]),

    /**
     * A payment made towards a subscription.
     *
     * A payment starts as **pending**: the business says they have paid and
     * gives the provider's reference. It becomes `verified` only when
     * somebody with authority confirms it against the provider's own
     * statement. Nothing becomes active on the say-so of the browser.
     */
    subscriptionPayments: defineTable({
        businessId: v.id("businesses"),
        subscriptionId: v.optional(v.id("subscriptions")),
        planKey: v.string(),
        amount: v.number(),
        currency: v.string(),
        /** monthly | annual */
        billingCycle: v.string(),
        /** The period the payment pays for. */
        periodStart: v.optional(v.string()),
        periodEnd: v.optional(v.string()),
        /** pending | verified | failed | refunded */
        status: v.string(),
        /** Which provider took the money: manual, paypal, stripe… */
        provider: v.string(),
        /**
         * The provider's own reference for the transaction.
         *
         * Two payments with the same provider reference are the same
         * money, so the second one is refused.
         */
        providerReference: v.optional(v.string()),
        /** When it was verified, and by whom. */
        verifiedAt: v.optional(v.string()),
        verifiedBy: v.optional(v.id("users")),
        /** Why a payment was rejected. */
        failureReason: v.optional(v.string()),
        notes: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.optional(v.string()),
    })
        .index("by_businessId", ["businessId"])
        .index("by_status", ["status"])
        .index("by_providerReference", ["provider", "providerReference"])
        .index("by_createdAt", ["createdAt"]),

    /**
     * A license key.
     *
     * The key itself is **never stored**. Only a keyed hash of it is, plus
     * the last few characters so a person can recognise their own key. A
     * database read cannot be turned back into a working license key.
     */
    licenseKeys: defineTable({
        /**
         * The business the key was issued to.
         *
         * A key may be issued unbound — for a customer who has not yet
         * registered their business — and is bound to whichever business
         * redeems it first.
         */
        businessId: v.optional(v.id("businesses")),
        subscriptionId: v.optional(v.id("subscriptions")),
        /** The keyed hash of the key. */
        keyHash: v.string(),
        /** The plan the key entitles the business to. */
        planKey: v.string(),
        /** The last few characters, so the owner can recognise the key. */
        keyHint: v.string(),
        /** The visible prefix, e.g. SBUZ. */
        keyPrefix: v.string(),
        /** active | revoked | expired */
        status: v.string(),
        issuedAt: v.string(),
        expiresAt: v.optional(v.string()),
        revokedAt: v.optional(v.string()),
        revokedBy: v.optional(v.id("users")),
        revocationReason: v.optional(v.string()),
        /** When it was last used to activate something. */
        lastUsedAt: v.optional(v.string()),
        useCount: v.optional(v.number()),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_keyHash", ["keyHash"])
        .index("by_status", ["status"]),

    /**
     * A device registered against a subscription.
     *
     * A plan allows a number of devices — one for a single till, several
     * for a business with more than one. A device that is revoked cannot be
     * used again until it is registered afresh.
     */
    devices: defineTable({
        businessId: v.id("businesses"),
        licenseKeyId: v.optional(v.id("licenseKeys")),
        /** The stable identifier the device reports for itself. */
        deviceId: v.string(),
        deviceName: v.string(),
        /** The platform it runs on: windows, android, web… */
        platform: v.optional(v.string()),
        appVersion: v.optional(v.string()),
        /** active | revoked */
        status: v.string(),
        registeredAt: v.string(),
        lastSeenAt: v.optional(v.string()),
        revokedAt: v.optional(v.string()),
        revokedBy: v.optional(v.id("users")),
        revocationReason: v.optional(v.string()),
        /**
         * When this device last pushed its offline queue.
         *
         * A device that has not synced for a long time is a device that may
         * be quietly holding sales that nobody has seen.
         */
        lastSyncAt: v.optional(v.string()),
        /** The state of the device's last synchronisation. */
        lastSyncStatus: v.optional(v.string()), // idle | syncing | ok | error
        /** The last error the device reported. */
        lastSyncError: v.optional(v.string()),
        createdAt: v.string(),
    })
        .index("by_businessId", ["businessId"])
        .index("by_businessId_deviceId", ["businessId", "deviceId"])
        .index("by_licenseKeyId", ["licenseKeyId"])
        .index("by_status", ["status"]),

/**
 * The synchronisation audit trail.
 *
 * Every push the server receives is recorded here: what arrived, from which
 * device, whether it was applied, refused as a duplicate, or held as a
 * conflict. When a business asks "did my till's sales get in?", this is the
 * answer.
 */
syncLogs: defineTable({
    businessId: v.id("businesses"),
    /** The installation that sent it. */
    deviceId: v.optional(v.string()),
    /** The transaction this log is about. */
    transactionId: v.optional(v.string()),
    /** push | pull */
    direction: v.string(),
    /** applied | duplicate | rejected | conflict */
    status: v.string(),
    /** How many times the device had tried before this one. */
    attempts: v.optional(v.number()),
    /** Why it was refused or held. */
    reason: v.optional(v.string()),
    /** The sale it produced, when it produced one. */
    saleId: v.optional(v.id("sales")),
    invoiceNumber: v.optional(v.string()),
    /** How many stock conflicts came with it. */
    conflictCount: v.optional(v.number()),
    actorUserId: v.optional(v.id("users")),
    createdAt: v.string(),
})
    .index("by_businessId", ["businessId"])
    .index("by_businessId_createdAt", ["businessId", "createdAt"])
    .index("by_transactionId", ["transactionId"])
    .index("by_deviceId", ["deviceId"]),

/**
 * Stock that two devices both sold while they were offline.
 *
 * When an offline sale arrives, the stock it needs may already have been
 * sold by another till. The sale is still applied — the customer has the
 * goods — but the shortfall is recorded here and shown to the owner, so it
 * is dealt with rather than quietly buried in a negative quantity.
 */
stockConflicts: defineTable({
    businessId: v.id("businesses"),
    /** The device that made the sale. */
    deviceId: v.optional(v.string()),
    /** The transaction that hit the conflict. */
    transactionId: v.optional(v.string()),
    stockId: v.id("stocks"),
    stockName: v.optional(v.string()),
    /** What the till believed was on hand when it made the sale. */
    expectedQty: v.optional(v.number()),
    /** What the server says is on hand now. */
    availableQty: v.number(),
    /** What the sale needed. */
    requestedQty: v.number(),
    /**
     * `insufficient` — there was not enough stock to cover the sale.
     * `drift`       — the stock moved since the till last saw it, but the
     *                 sale could still be covered.
     */
    kind: v.string(),
    /** pending | accepted | resolved | rejected */
    status: v.string(),
    /** What the owner decided. */
    resolution: v.optional(v.string()),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.string(),
})
    .index("by_businessId", ["businessId"])
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_transactionId", ["transactionId"]),

  /* ────────────────────────────────────────────────────────────────────
   * Phase 9 — integrations and industry packages
   * ──────────────────────────────────────────────────────────────────── */

  /**
   * One integration adapter, configured for one business.
   *
   * The row holds what the business chose; the *adapter* — what the
   * adapter is called, what it can do, what it needs — lives in the
   * registry (`convex/integrations/registry.ts`), so every integration is
   * described the same way and adding one does not mean adding a table.
   *
   * Secrets are encrypted before they get here and are never returned to
   * the browser. The interface can say whether a secret is present; it can
   * never read one back.
   */
  integrationConfigs: defineTable({
    businessId: v.id("businesses"),
    /** The adapter key from the registry, e.g. `mtn.momo`. */
    adapterKey: v.string(),
    /** Denormalised from the registry so a list needs no lookup. */
    category: v.string(),
    /** Whether the business has switched this adapter on. */
    enabled: v.boolean(),
    /** The non-secret configuration. */
    config: v.optional(v.record(v.string(), v.any())),
    /** The encrypted secrets, keyed by field name. */
    secrets: v.optional(v.record(v.string(), v.any())),
    /**
     * `unverified` — nothing has been tested.
     * `configured` — credentials saved, never exercised.
     * `verified`   — a live test reached the real provider and passed.
     * `failed`     — a live test was attempted and the provider refused it.
     */
    verificationStatus: v.string(),
    /** When the adapter last passed a live test. */
    verifiedAt: v.optional(v.string()),
    /** When a live test was last attempted, passed or not. */
    lastTestedAt: v.optional(v.string()),
    /** What the last live test said, in words. */
    lastTestResult: v.optional(v.string()),
    /** Whether the last test passed. */
    lastTestPassed: v.optional(v.boolean()),
    /** Who last changed it. */
    updatedBy: v.optional(v.id("users")),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_adapterKey", ["businessId", "adapterKey"])
    .index("by_businessId_category", ["businessId", "category"]),

  /**
   * Every call an integration makes, and every callback it receives.
   *
   * This is the audit trail for the whole integration layer: what was
   * sent, what came back, and what failed. It is also what an owner reads
   * when they ask "did that payment actually go through?".
   */
  integrationEvents: defineTable({
    businessId: v.id("businesses"),
    adapterKey: v.string(),
    /** `outbound` — we called the provider. `inbound` — it called us. */
    direction: v.string(),
    /** What kind of event: `payment_initiated`, `message_sent`, `live_test`, `webhook`… */
    kind: v.string(),
    /** Our reference, or the provider's. */
    reference: v.optional(v.string()),
    /** `ok` | `failed` */
    status: v.string(),
    /** A short human summary of what happened. */
    summary: v.optional(v.string()),
    /** The error, when there was one. */
    error: v.optional(v.string()),
    /** The provider's payload, kept for the audit. */
    payload: v.optional(v.any()),
    userId: v.optional(v.id("users")),
    createdAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_createdAt", ["businessId", "createdAt"])
    .index("by_adapterKey", ["adapterKey"])
    .index("by_reference", ["reference"]),

  /**
   * A payment started with a provider.
   *
   * The row is created the moment a collection is requested and is only
   * `succeeded` once the *provider* has confirmed it — never because the
   * browser said so. `reference` is our idempotency key: the same
   * reference is sent to the provider on every retry, so a timeout cannot
   * charge the customer twice.
   */
  paymentIntents: defineTable({
    businessId: v.id("businesses"),
    /** The adapter that was used. */
    adapterKey: v.string(),
    /** The provider's name, e.g. `MTN`. */
    provider: v.string(),
    /** Our reference — the idempotency key sent to the provider. */
    reference: v.string(),
    /** The provider's own id for the transaction. */
    providerReference: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    /** `pending` | `succeeded` | `failed` | `cancelled` */
    status: v.string(),
    /** The sale this payment belongs to. */
    saleId: v.optional(v.id("sales")),
    customerId: v.optional(v.id("customers")),
    /** True only once the provider's own callback confirmed it. */
    confirmedByProvider: v.optional(v.boolean()),
    description: v.optional(v.string()),
    /** The raw provider payload, for the audit. */
    providerPayload: v.optional(v.any()),
    error: v.optional(v.string()),
    /** Whether this was made in a sandbox rather than live. */
    sandbox: v.optional(v.boolean()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_reference", ["reference"])
    .index("by_providerReference", ["providerReference"])
    .index("by_saleId", ["saleId"]),

  /**
   * A statement that was imported from a provider.
   *
   * The header of the import. The lines are in `statementLines`.
   */
  statementImports: defineTable({
    businessId: v.id("businesses"),
    adapterKey: v.string(),
    /** The provider's name, shown on the reconciliation. */
    providerName: v.string(),
    accountLabel: v.optional(v.string()),
    /** The period covered, `YYYY-MM`. */
    period: v.optional(v.string()),
    /** Where the file came from. */
    filename: v.optional(v.string()),
    rowCount: v.number(),
    total: v.number(),
    currency: v.optional(v.string()),
    /** Rows that could not be read. A silent skip is a hole in the books. */
    warnings: v.optional(v.array(v.string())),
    importedBy: v.optional(v.id("users")),
    createdAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_period", ["businessId", "period"]),

  /**
   * One line of an imported statement.
   *
   * A line is matched against the payments the books recorded. It is only
   * marked `matched` when a real payment was found — the import never
   * invents a match to make the numbers look tidy.
   */
  statementLines: defineTable({
    businessId: v.id("businesses"),
    importId: v.id("statementImports"),
    /** The line's position in the file, so the operator can find it. */
    lineNumber: v.number(),
    date: v.string(),
    reference: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    fee: v.optional(v.number()),
    currency: v.optional(v.string()),
    /** `unmatched` | `matched` | `ignored` */
    status: v.string(),
    /** The payment this line settled. */
    matchedPaymentId: v.optional(v.id("payments")),
    /** The sale it settled. */
    matchedSaleId: v.optional(v.id("sales")),
    /** The reconciliation this line ended up in. */
    reconciliationId: v.optional(v.id("reconciliations")),
    /** `exact` | `amount_and_date` | `reference` | `manual` */
    matchType: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_businessId", ["businessId"])
    .index("by_importId", ["importId"])
    .index("by_businessId_status", ["businessId", "status"]),

  /**
   * A message that went out — an SMS, a WhatsApp message, an email.
   *
   * `status` is what SMARTBUZ knows for certain: `sent` means the
   * provider accepted it. It does not mean the customer read it, and the
   * interface never says it does.
   */
  messages: defineTable({
    businessId: v.id("businesses"),
    adapterKey: v.string(),
    /** `sms` | `whatsapp` | `email` */
    channel: v.string(),
    to: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    /** The template this was built from, when it was built from one. */
    templateKey: v.optional(v.string()),
    /** `sent` | `failed` */
    status: v.string(),
    providerMessageId: v.optional(v.string()),
    /** The provider's own delivery status, when it reports one. */
    deliveryStatus: v.optional(v.string()),
    /** What the message is about, so it can be found later. */
    relatedType: v.optional(v.string()),
    relatedId: v.optional(v.string()),
    error: v.optional(v.string()),
    sentBy: v.optional(v.id("users")),
    sentAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_relatedId", ["relatedId"])
    .index("by_businessId_createdAt", ["businessId", "createdAt"]),

  /**
   * A piece of hardware attached to a till.
   *
   * The server records what the business has and how it is behaving; the
   * browser does the talking, because the browser is what can reach a USB
   * or serial port. A device that has never been seen by the browser is
   * `configured`, never `verified` — the same rule the software adapters
   * follow.
   */
  hardwareDevices: defineTable({
    businessId: v.id("businesses"),
    /** The hardware key from the registry. */
    hardwareKey: v.string(),
    kind: v.string(),
    name: v.string(),
    /** The shop or branch the hardware belongs to. */
    shopId: v.optional(v.id("shops")),
    branchId: v.optional(v.id("branches")),
    /** The till this hardware is attached to. */
    deviceId: v.optional(v.string()),
    /** The settings — paper width, scale precision, and so on. */
    config: v.optional(v.record(v.string(), v.any())),
    /** `configured` | `testing` | `verified` | `not_working` */
    status: v.string(),
    /** What the operator said when they last tried it. */
    statusNote: v.optional(v.string()),
    /** When the browser last reported the device. */
    lastSeenAt: v.optional(v.string()),
    updatedBy: v.optional(v.id("users")),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_kind", ["businessId", "kind"])
    .index("by_deviceId", ["deviceId"]),

  /**
   * An industry package, switched on for one business.
   *
   * The package's features live in `convex/packages/registry.ts`, so the
   * packages are data rather than code, and a business runs only the ones
   * it has turned on.
   */
  industryPackages: defineTable({
    businessId: v.id("businesses"),
    /** The package key, e.g. `supermarket`. */
    packageKey: v.string(),
    enabled: v.boolean(),
    /** Which of the package's features are on. */
    features: v.optional(v.array(v.string())),
    /** The package's own settings. */
    settings: v.optional(v.record(v.string(), v.any())),
    updatedBy: v.optional(v.id("users")),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_packageKey", ["businessId", "packageKey"]),

  /**
   * A kitchen ticket — one order on the kitchen display.
   *
   * A ticket is fired from a table order. It carries its own copy of the
   * lines, so a later change to the table order does not silently change
   * what the kitchen is cooking.
   */
  kitchenTickets: defineTable({
    businessId: v.id("businesses"),
    /** The table order this ticket belongs to. */
    orderId: v.optional(v.id("tableOrders")),
    outletId: v.optional(v.id("serviceOutlets")),
    outletName: v.optional(v.string()),
    ticketNumber: v.string(),
    /** `queued` | `preparing` | `ready` | `served` | `cancelled` */
    status: v.string(),
    /** The lines to cook. */
    items: v.array(
      v.object({
        name: v.string(),
        quantity: v.number(),
        notes: v.optional(v.string()),
      })
    ),
    /** When the waiter fired it. */
    firedAt: v.string(),
    /** When the kitchen started on it. */
    startedAt: v.optional(v.string()),
    /** When it was plated. */
    readyAt: v.optional(v.string()),
    /** Who fired it. */
    firedBy: v.optional(v.id("users")),
    createdAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_orderId", ["orderId"]),

  /**
   * A prescription — a pharmacy's order to dispense.
   *
   * The pharmacy package records the prescriber properly, which the
   * generic appointment record could not: a prescription has a patient, a
   * prescriber and a list of medicine that has to come out of a batch.
   */
  prescriptions: defineTable({
    businessId: v.id("businesses"),
    customerId: v.optional(v.id("customers")),
    patientName: v.string(),
    patientPhone: v.optional(v.string()),
    /** The prescriber — the doctor, nurse or clinic. */
    prescriberName: v.string(),
    prescriberNumber: v.optional(v.string()),
    prescriberFacility: v.optional(v.string()),
    /** The medicine to dispense. */
    items: v.array(
      v.object({
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        dosage: v.optional(v.string()),
        quantity: v.number(),
        /** The batch it came out of, once it has been dispensed. */
        batchId: v.optional(v.id("productBatches")),
        batchNumber: v.optional(v.string()),
        expiryDate: v.optional(v.string()),
      })
    ),
    /** `pending` | `dispensed` | `partially_dispensed` | `cancelled` */
    status: v.string(),
    /** The sale it was dispensed against. */
    saleId: v.optional(v.id("sales")),
    dispensedBy: v.optional(v.id("users")),
    dispensedAt: v.optional(v.string()),
    /** Whether this needs the controlled-drug record kept alongside it. */
    controlled: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_customerId", ["customerId"]),

  /**
   * A price list — a wholesaler's volume tier, or a customer's own prices.
   */
  priceLists: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    /** `tier` — a volume band. `customer` — one customer's own prices. */
    type: v.string(),
    /** The customer this list belongs to, when the type is `customer`. */
    customerId: v.optional(v.id("customers")),
    /** The minimum quantity for a tier to apply. */
    minQty: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_businessId", ["businessId"])
    .index("by_businessId_type", ["businessId", "type"])
    .index("by_customerId", ["customerId"]),

  /**
   * One product's price within a price list.
   */
  priceListEntries: defineTable({
    businessId: v.id("businesses"),
    priceListId: v.id("priceLists"),
    stockId: v.id("stocks"),
    /** The price for this list. */
    price: v.number(),
    /** The quantity this price applies from — for a tier. */
    minQty: v.optional(v.number()),
  })
    .index("by_businessId", ["businessId"])
    .index("by_priceListId", ["priceListId"])
    .index("by_stockId", ["stockId"]),
});
