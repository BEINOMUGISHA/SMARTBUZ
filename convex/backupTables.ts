/**
 * SMARTBUZ — the tables a backup covers.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this list is explicit
 *
 * A backup that forgets a table is worse than no backup, because it is
 * believed in. So the list of what is backed up is written down here,
 * in one place, and the restore refuses to run against anything it does
 * not recognise.
 *
 * Every table here has a `by_businessId` index, so a business's rows can
 * be read with an index scan rather than by reading the table and
 * filtering — which is both faster and bounded by the data that belongs
 * to that business.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What is deliberately not here
 *
 * - `users` — an account is a person, not a business. Several businesses
 *   share the same people, and one person's account does not belong to
 *   any one business. The backup carries the ids so the data still
 *   resolves, and the accounts themselves are restored by invitation.
 * - `sessions`, `emailVerifications`, `loginAttempts`, `emailThrottle`,
 *   `passwordResets` — a session does not survive a restore, and a reset
 *   code that outlived its restore would be a way in.
 * - `subscriptions`, `subscriptionEvents`, `subscriptionPayments`,
 *   `licenseKeys` — these are the platform's records of what the business
 *   has paid for. They are not the business's data, and restoring them
 *   would let a restored database grant itself a licence.
 * - `platformAdmins`, `plans` — the platform's own.
 * - `businessProfiles` — the legacy table the multitenancy migration
 *   emptied. There is nothing in it worth keeping.
 */

export const BACKUP_TABLES = [
    // The tenant model
    "memberships",
    "employees",
    "branches",
    "warehouses",
    "businessInvitations",
    "customRolePermissions",
    "memberPermissionOverrides",

    // The catalogue and its prices
    "categories",
    "categorySettings",
    "stocks",
    "stockCostHistory",
    "stockEntries",
    "stockLedger",
    "productBatches",
    "productSerials",
    "productionBatches",

    // Customers and the money they owe
    "customers",
    "customerWallets",
    "walletTransactions",
    "customerMeasurements",
    "members",
    "memberTransactions",
    "loyaltyTransactions",

    // Sales and the books
    "sales",
    "payments",
    "loans",
    "expenses",
    "incomeRecords",
    "cashShifts",
    "cashMovements",
    "reconciliations",
    "banking",

    // Counting and stock movement
    "shops",
    "counters",
    "shopIssueRecords",

    // Promotions
    "promotions",
    "promotionProducts",
    "promotionRedemptions",

    // Suppliers and purchasing
    "suppliers",
    "supplierLedger",
    "supplierInvoices",
    "purchaseOrders",
    "purchasePayments",
    "purchaseReturns",
    "goodsReceipts",
    "deliveries",

    // Tills and devices
    "devices",
    "tillSessions",

    // The audit trail
    "auditLogs",
    "activityLogs",

    // The verticals
    "appointments",
    "serviceOutlets",
    "serviceTickets",
    "staffCommissions",
    "assets",
    "menuItems",
    "tableOrders",
    "recurringCharges",
    "donations",
    "fuelDispenses",
    "vehicles",
    "classEnrolments",
    "attendance",
    "rentals",
    "routeFares",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/**
 * The tables the restore will accept.
 *
 * A restore is given a file. If the file names a table this does not
 * recognise, the restore refuses rather than guessing: a backup from a
 * different application, or a file somebody edited, must not be able to
 * write into the database.
 */
export const RESTORABLE_TABLES: ReadonlySet<string> = new Set<string>(BACKUP_TABLES);

/** How many rows are read or written at a time. */
export const BACKUP_CHUNK_SIZE = 200;
