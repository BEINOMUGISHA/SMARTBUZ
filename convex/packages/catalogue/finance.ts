/**
 * SMART_BUZ — the packages for the financial and community businesses.
 *
 * Finance & Property: the businesses that hold other people's money or
 * property — a SACCO, a property manager, a security company.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * SACCO and microfinance
 * ──────────────────────────────────────────────────────────────────────── */

const sacco: IndustryPackageDescriptor = {
    key: "sacco",
    label: "SACCO / microfinance",
    summary:
        "Cooperative lending with member share accounts, savings deposits, loan disbursement and repayment schedules.",
    categoryId: "sacco",
    modules: ["sales", "stock", "expenses", "banking", "reports", "customers", "members", "loans", "receivables", "payroll", "notifications", "imports", "plans", "attendance"],
    features: [
        {
            key: "share_accounts",
            label: "Share accounts",
            summary:
                "A member's shares, what they are worth and what they have earned.",
            defaultEnabled: true,
        },
        {
            key: "savings_accounts",
            label: "Savings deposits",
            summary:
                "A member's savings balance, with every movement on the ledger.",
            defaultEnabled: true,
        },
        {
            key: "loan_schedules",
            label: "Loan schedules",
            summary:
                "A loan with its repayment schedule, and what is left to pay.",
            defaultEnabled: true,
        },
        {
            key: "dividends",
            label: "Dividends",
            summary:
                "Declare a dividend against the shares and pay it to the members.",
            defaultEnabled: true,
        },
        {
            key: "arrears_reporting",
            label: "Arrears reporting",
            summary:
                "Which loans are late, by how much and for how long.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultSharePrice",
            label: "Share price",
            type: "number",
            default: 10000,
        },
        {
            key: "minimumShares",
            label: "Minimum shares on joining",
            type: "number",
            default: 1,
        },
        {
            key: "interestRatePercent",
            label: "Loan interest (% per year)",
            type: "number",
            default: 0,
        },
        {
            key: "loanTermMonths",
            label: "Default loan term (months)",
            type: "number",
            default: 12,
        },
        {
            key: "arrearsGraceDays",
            label: "Grace days before a loan is late",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "The loan records the schedule and the repayments. There is no interest accrual engine of its own: the interest is entered or comes from the lending module, and SMARTBUZ does not compound it daily.",
        "The arrears report says a loan is late and by how much. There is no dunning schedule, no penalty rate and no automatic letter.",
        "A dividend is declared against the shares and paid through the ledger. There is no withholding tax and no statutory return.",
        "There is no member onboarding form, no KYC document store and no credit bureau report.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Real estate and property management
 * ──────────────────────────────────────────────────────────────────────── */

const realestate: IndustryPackageDescriptor = {
    key: "realestate",
    label: "Real estate / property management",
    summary:
        "Property management with rent collection, tenant records, arrears tracking, maintenance requests and deposits.",
    categoryId: "realestate",
    modules: ["sales", "expenses", "banking", "reports", "customers", "members", "rooms", "rentals", "services", "maintenance", "assets", "quotes", "leads", "payroll", "notifications", "imports", "bookings"],
    features: [
        {
            key: "rent_roll",
            label: "Rent roll",
            summary:
                "Every property, who is in it, at what rent, and until when.",
            defaultEnabled: true,
        },
        {
            key: "rent_collection",
            label: "Rent collection",
            summary:
                "Raise the rent and record what came in, month by month.",
            defaultEnabled: true,
        },
        {
            key: "arrears_tracking",
            label: "Arrears tracking",
            summary:
                "Who has not paid, by how much and for how long.",
            defaultEnabled: true,
        },
        {
            key: "maintenance_requests",
            label: "Maintenance requests",
            summary:
                "A fault reported by a tenant, and the work done about it.",
            defaultEnabled: true,
        },
        {
            key: "deposits",
            label: "Deposits",
            summary:
                "Hold the deposit and return what is left at the end of the tenancy.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "rentDueDay",
            label: "Rent falls due on the",
            type: "number",
            default: 1,
            help: "The day of the month the rent is due.",
        },
        {
            key: "graceDays",
            label: "Grace days",
            type: "number",
            default: 5,
        },
        {
            key: "arrearsEscalationDays",
            label: "Escalate after (days)",
            type: "number",
            default: 30,
        },
        {
            key: "depositMonths",
            label: "Deposit (months of rent)",
            type: "number",
            default: 2,
        },
        {
            key: "lateFeePercent",
            label: "Late fee (%)",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "The arrears report is a list of what is owed and for how long. There is no letter, no notice to quit and no court process.",
        "The maintenance request records the fault and the work done. There is no contractor rota and no part or material cost against the job.",
        "There is no tenancy agreement template and no document store for the signed lease.",
        "There is no property valuation, no title search and no commission schedule for a sale.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Security services
 * ──────────────────────────────────────────────────────────────────────── */

const security: IndustryPackageDescriptor = {
    key: "security",
    label: "Security services",
    summary:
        "A guarding and security company with guard shifts, client contracts, incident logs and payroll deductions.",
    categoryId: "security",
    modules: ["sales", "stock", "expenses", "banking", "reports", "customers", "services", "attendance", "assets", "payroll", "notifications", "imports"],
    features: [
        {
            key: "guard_shifts",
            label: "Guard shifts",
            summary:
                "Who is on duty, at which post, from when to when.",
            defaultEnabled: true,
        },
        {
            key: "client_contracts",
            label: "Client contracts",
            summary:
                "A site, the hours it is covered and what it costs.",
            defaultEnabled: true,
        },
        {
            key: "incident_log",
            label: "Incident log",
            summary:
                "Everything that happened on a site, with the time and who saw it.",
            defaultEnabled: true,
        },
        {
            key: "attendance_checkpoints",
            label: "Checkpoint attendance",
            summary:
                "The rounds the guard walked, and when.",
            defaultEnabled: true,
        },
        {
            key: "payroll_deductions",
            label: "Payroll deductions",
            summary:
                "What each guard earned, and what was taken off for the client.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "shiftHours",
            label: "Length of a shift (hours)",
            type: "number",
            default: 12,
        },
        {
            key: "guardsPerShift",
            label: "Guards per shift per post",
            type: "number",
            default: 1,
        },
        {
            key: "checkpointIntervalMinutes",
            label: "Checkpoint interval (minutes)",
            type: "number",
            default: 60,
        },
        {
            key: "requireCheckpointOnShift",
            label: "A shift needs its checkpoints",
            type: "boolean",
            default: true,
        },
        {
            key: "overtimeRatePercent",
            label: "Overtime premium",
            type: "number",
            default: 50,
        },
    ],
    limitations: [
        "The shift roster records who is booked on. There is no roster generator that fills the gaps, no leave handling and no shift swapping.",
        "The incident log is what the guard typed. There is no photograph, no CCTV reference and no police follow-up.",
        "Checkpoint attendance is marked at the post. It is not a GPS trail and it cannot prove where the guard actually was.",
        "There is no licence or firearm register, and no client invoice run from the hours actually worked.",
    ],
};

export const financePackages: IndustryPackageDescriptor[] = [
    sacco,
    realestate,
    security,
];
