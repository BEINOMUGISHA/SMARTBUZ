/**
 * SMART_BUZ — the packages for the education and non-profit businesses.
 *
 * Education & Community: the businesses that teach, worship or serve a
 * cause — a school, a church, a development programme.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * School and institute
 * ──────────────────────────────────────────────────────────────────────── */

const education: IndustryPackageDescriptor = {
    key: "education",
    label: "School / institute",
    summary:
        "Fee collection with class enrolment, term billing, a school calendar, student arrears and receipting parents.",
    categoryId: "education",
    modules: ["sales", "stock", "inventory", "expenses", "banking", "reports", "customers", "members", "classes", "attendance", "fees", "payroll", "notifications", "imports"],
    features: [
        {
            key: "class_enrolment",
            label: "Class enrolment",
            summary:
                "Put a student in a class for a term, and take them out of it again.",
            defaultEnabled: true,
        },
        {
            key: "term_billing",
            label: "Term billing",
            summary:
                "Raise a fee invoice per student per term, with the lines on it.",
            defaultEnabled: true,
        },
        {
            key: "payment_allocation",
            label: "Payment allocation",
            summary:
                "Take a payment and put it against the student's invoices.",
            defaultEnabled: true,
        },
        {
            key: "arrears_aging",
            label: "Arrears ageing",
            summary:
                "Who has not paid, by how much and for how long.",
            defaultEnabled: true,
        },
        {
            key: "parent_statement",
            label: "Parent statement",
            summary:
                "A statement a parent can read: what was billed, what was paid, what is owed.",
            defaultEnabled: true,
        },
        {
            key: "attendance",
            label: "Attendance",
            summary:
                "Mark who came to school each day.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "terms",
            label: "Terms",
            type: "string",
            default: "Term 1,Term 2,Term 3",
            help: "The terms the school bills in, separated by commas.",
        },
        {
            key: "billingDueDay",
            label: "Fees fall due on the",
            type: "number",
            default: 15,
        },
        {
            key: "graceDays",
            label: "Grace days",
            type: "number",
            default: 7,
        },
        {
            key: "defaultCurrency",
            label: "Currency",
            type: "string",
            default: "UGX",
            help: "The currency the fee invoices are raised in.",
        },
        {
            key: "requirePayerPhone",
            label: "Require the parent's phone number",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "The fee invoice carries its own lines. Changing the school's fee structure does not change the invoices already raised — which is deliberate, but it means the structure has to be maintained in two places.",
        "The arrears report says what is owed and for how long. There is no automatic reminder, no payment plan and no withholding of a report card.",
        "There is no admission form, no transcript and no exam record. The student record is the member record.",
        "Attendance is marked against a class on a day. There is no register print and no parent notification.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Church and religious organisation
 * ──────────────────────────────────────────────────────────────────────── */

const church: IndustryPackageDescriptor = {
    key: "church",
    label: "Church / religious organisation",
    summary:
        "House fellowship and church administration with tithes, offerings, member families, projects and member statements.",
    categoryId: "church",
    modules: ["sales", "stock", "expenses", "banking", "reports", "customers", "members", "classes", "receivables", "payroll", "notifications", "imports", "attendance"],
    features: [
        {
            key: "tithes_and_offerings",
            label: "Tithes and offerings",
            summary:
                "Record what came in and what it was for.",
            defaultEnabled: true,
        },
        {
            key: "member_families",
            label: "Member families",
            summary:
                "A household, not a person, with its members and its contact.",
            defaultEnabled: true,
        },
        {
            key: "projects",
            label: "Projects",
            summary:
                "A project with its own income, its costs and what is left.",
            defaultEnabled: true,
        },
        {
            key: "member_statements",
            label: "Member statements",
            summary:
                "A statement of what a member gave and what was received against it.",
            defaultEnabled: true,
        },
        {
            key: "harvest_fellowship",
            label: "Harvest and fellowship",
            summary:
                "Keep the branch, its members and what each one has given.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "tithePercent",
            label: "Tithe",
            type: "number",
            default: 10,
            help: "The tithe shown against a member's giving. SMARTBUZ records what was given; it does not decide what should be.",
        },
        {
            key: "harvestTargets",
            label: "Harvest target",
            type: "number",
            default: 0,
        },
        {
            key: "projectCategories",
            label: "Project categories",
            type: "string",
            default: "Building,Education,Medical,Mission,Other",
        },
        {
            key: "statementFrequency",
            label: "Statement frequency",
            type: "enum",
            default: "quarterly",
            options: [
                { value: "monthly", label: "Monthly" },
                { value: "quarterly", label: "Quarterly" },
                { value: "yearly", label: "Yearly" },
            ],
        },
        {
            key: "hideAmountsFromMembers",
            label: "Members see amounts",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "The tithe percentage is a reference shown beside a figure. SMARTBUZ does not judge what a member should give, and it does not enforce it.",
        "A project tracks its income and its costs. There is no budget-versus-actual report and no drawdown schedule.",
        "The member statement is a list of what was given and received. It is not a receipt with a fiscal note for a tax exemption.",
        "There is no attendance at services, no membership roll and no transfer between fellowships.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * NGO and development programme
 * ──────────────────────────────────────────────────────────────────────── */

const ngo: IndustryPackageDescriptor = {
    key: "ngo",
    label: "NGO / development programme",
    summary:
        "Programme delivery with donor funds, beneficiary disbursements, activity budgets and per-activity cost tracking.",
    categoryId: "ngo",
    modules: ["sales", "stock", "inventory", "expenses", "banking", "reports", "customers", "members", "receivables", "services", "payroll", "notifications", "imports"],
    features: [
        {
            key: "donor_funds",
            label: "Donor funds",
            summary:
                "Record what a donor committed, what has been received and what is left.",
            defaultEnabled: true,
        },
        {
            key: "beneficiary_disbursement",
            label: "Beneficiary disbursement",
            summary:
                "What was paid out to a beneficiary, and for what.",
            defaultEnabled: true,
        },
        {
            key: "activity_budgets",
            label: "Activity budgets",
            summary:
                "A budget for an activity, and what it has actually cost.",
            defaultEnabled: true,
        },
        {
            key: "beneficiary_register",
            label: "Beneficiary register",
            summary:
                "Who the programme serves, with what they have received.",
            defaultEnabled: true,
        },
        {
            key: "per_activity_costing",
            label: "Per-activity costing",
            summary:
                "The cost of reaching one beneficiary, worked out from the activity.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "programmes",
            label: "Programmes",
            type: "string",
            default: "",
            help: "The programmes the organisation runs, separated by commas.",
        },
        {
            key: "requireDonorReference",
            label: "Require the donor's reference",
            type: "boolean",
            default: true,
        },
        {
            key: "budgetVariancePercent",
            label: "Flag a budget variance above (%)",
            type: "number",
            default: 10,
        },
        {
            key: "defaultDisbursementMethod",
            label: "Default disbursement method",
            type: "enum",
            default: "cash",
            options: [
                { value: "cash", label: "Cash" },
                { value: "mobile_money", label: "Mobile money" },
                { value: "bank", label: "Bank transfer" },
            ],
        },
        {
            key: "requireBeneficiaryId",
            label: "Require a beneficiary on the register",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A donor record holds the commitment and what has been received against it. There is no donor portal, no receipt generation and no restricted-fund accounting.",
        "The beneficiary register is who the programme serves and what they have received. It is not a case-management system and holds no household or vulnerability detail.",
        "The per-beneficiary cost is the activity's costs divided by the beneficiaries served. It is not a cost-effectiveness measure against an outcome.",
        "There is no results framework, no indicator tracking and no donor report generator.",
    ],
};

export const communityPackages: IndustryPackageDescriptor[] = [
    education,
    church,
    ngo,
];
