/**
 * SMART_BUZ — the packages for the service businesses.
 *
 * Services & Workshops: the businesses that sell time and skill rather
 * than goods — a barbershop, a salon, a spa, a gym, a laundry, a tailor,
 * a carpenter, a welder, a cleaning contract, a photographer, an events
 * company, a hardware yard, a construction business.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * Barbershop
 * ──────────────────────────────────────────────────────────────────────── */

const barber: IndustryPackageDescriptor = {
    key: "barber",
    label: "Barbershop",
    summary:
        "Chair-based service with a waiting list, stylist commission, and the day's services reconciled at close.",
    categoryId: "barber",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "appointments", "services", "quotes", "leads", "payroll", "notifications", "imports"],
    features: [
        {
            key: "chair_management",
            label: "Chair management",
            summary:
                "Every chair, who is in it and how long it has been busy.",
            defaultEnabled: true,
        },
        {
            key: "stylist_commission",
            label: "Stylist commission",
            summary:
                "Work out what each barber earned, and pay it.",
            defaultEnabled: true,
        },
        {
            key: "waiting_list",
            label: "Waiting list",
            summary:
                "Hold the walk-in who is waiting and give them the chair when it is free.",
            defaultEnabled: true,
        },
        {
            key: "service_catalogue",
            label: "Service catalogue",
            summary:
                "The cuts and services on offer and what each one costs.",
            defaultEnabled: true,
        },
        {
            key: "daily_reconciliation",
            label: "Daily reconciliation",
            summary:
                "Close the day against what was served and what was taken.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultSlotMinutes",
            label: "Length of a cut (minutes)",
            type: "number",
            default: 30,
        },
        {
            key: "commissionPercent",
            label: "Commission",
            type: "number",
            default: 40,
            help: "The share of the service price that goes to the barber.",
        },
        {
            key: "tipIncluded",
            label: "Tips are part of the commission",
            type: "boolean",
            default: false,
        },
        {
            key: "walkInOnly",
            label: "Walk-ins only",
            type: "boolean",
            default: false,
            help: "On, no appointments are taken.",
        },
    ],
    limitations: [
        "Commission is a percentage of the service price. There is no tiered commission, no product commission and no pay rate for a barber who is not selling.",
        "The waiting list holds a name and a time. It does not text the customer when a chair frees up.",
        "A chair is busy or free. There is no barber-to-chair assignment for the day and no rota.",
        "There is no loyalty scheme beyond the shared points ledger.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Hair salon
 * ──────────────────────────────────────────────────────────────────────── */

const salon: IndustryPackageDescriptor = {
    key: "salon",
    label: "Hair salon",
    summary:
        "Braiding, weaving and treatment services with stylist commission and package deals.",
    categoryId: "salon",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "appointments", "services", "promotions", "quotes", "leads", "payroll", "notifications", "imports", "plans"],
    features: [
        {
            key: "service_catalogue",
            label: "Service catalogue",
            summary:
                "The services on offer, what each costs and how long it takes.",
            defaultEnabled: true,
        },
        {
            key: "stylist_commission",
            label: "Stylist commission",
            summary:
                "Work out what each stylist earned, and pay it.",
            defaultEnabled: true,
        },
        {
            key: "package_deals",
            label: "Package deals",
            summary:
                "Sell a number of sessions together at a price below the single rate.",
            defaultEnabled: true,
        },
        {
            key: "client_records",
            label: "Client records",
            summary:
                "Keep what a client's hair needs — the colour, the length, the treatment.",
            defaultEnabled: true,
        },
        {
            key: "chair_management",
            label: "Chair management",
            summary:
                "Every chair, who is in it and how long it has been busy.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "commissionPercent",
            label: "Commission",
            type: "number",
            default: 40,
        },
        {
            key: "packageSessions",
            label: "Sessions in a package",
            type: "number",
            default: 6,
        },
        {
            key: "packageDiscountPercent",
            label: "Package discount",
            type: "number",
            default: 15,
        },
        {
            key: "defaultSlotMinutes",
            label: "Default slot (minutes)",
            type: "number",
            default: 60,
        },
        {
            key: "retainerPercent",
            label: "Deposit taken up front",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A package is a number of sessions at a price. It does not expire on a schedule, and it cannot be split between two people.",
        "Commission is a percentage of the service price. There is no tiered commission by the stylist's own service mix.",
        "A client record holds the notes the stylist typed. It is not a formula book and there is no photograph of the client's hair.",
        "There is no colour formula with the actual mix ratios, and no stock is taken out against a treatment.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Spa and wellness
 * ──────────────────────────────────────────────────────────────────────── */

const salonSpa: IndustryPackageDescriptor = {
    key: "salon_spa",
    label: "Beauty spa & wellness",
    summary:
        "Treatment rooms, package memberships, therapist commission and product retail.",
    categoryId: "salon_spa",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "appointments", "services", "promotions", "quotes", "leads", "payroll", "measurements", "notifications", "imports", "plans"],
    features: [
        {
            key: "treatment_rooms",
            label: "Treatment rooms",
            summary:
                "Every room, what it is set up for, and whether it is free.",
            defaultEnabled: true,
        },
        {
            key: "package_memberships",
            label: "Package memberships",
            summary:
                "A membership that gives a number of treatments a month.",
            defaultEnabled: true,
        },
        {
            key: "therapist_commission",
            label: "Therapist commission",
            summary:
                "Work out what each therapist earned, and pay it.",
            defaultEnabled: true,
        },
        {
            key: "product_retail",
            label: "Product retail",
            summary:
                "Sell the products used on the treatment, and take them off the stock.",
            defaultEnabled: true,
        },
        {
            key: "appointments",
            label: "Appointments",
            summary:
                "Book a client into a room and a therapist.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "commissionPercent",
            label: "Commission",
            type: "number",
            default: 35,
        },
        {
            key: "membershipTreatments",
            label: "Treatments a month",
            type: "number",
            default: 4,
        },
        {
            key: "membershipPrice",
            label: "Membership price",
            type: "number",
            default: 0,
            help: "Zero means no membership is offered until a price is set.",
        },
        {
            key: "rolloverTreatments",
            label: "Unused treatments roll over",
            type: "boolean",
            default: false,
        },
        {
            key: "productMarkupPercent",
            label: "Retail markup",
            type: "number",
            default: 40,
        },
    ],
    limitations: [
        "A membership counts the treatments used in the month. There is no freeze, no pause and no transfer between members.",
        "The commission is a share of the treatment price. The value of the products used is recorded but is not part of what the therapist is paid.",
        "There is no therapist rota, no room-service and no treatment-room turnover time built into the diary.",
        "There is no client consultation form and no treatment record beyond the note.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Gym and fitness centre
 * ──────────────────────────────────────────────────────────────────────── */

const fitness: IndustryPackageDescriptor = {
    key: "fitness",
    label: "Gym & fitness centre",
    summary:
        "Membership-driven gym with subscriptions, attendance tracking, lockers and personal-training packages.",
    categoryId: "fitness",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "members", "attendance", "services", "quotes", "leads", "payroll", "notifications", "imports", "appointments"],
    features: [
        {
            key: "memberships",
            label: "Memberships",
            summary:
                "A member on a plan, with what they have paid and what is due.",
            defaultEnabled: true,
        },
        {
            key: "attendance",
            label: "Attendance",
            summary:
                "Record who came in, so the member's plan can be counted.",
            defaultEnabled: true,
        },
        {
            key: "recurring_billing",
            label: "Recurring billing",
            summary:
                "Raise the membership every month without anybody asking.",
            defaultEnabled: true,
        },
        {
            key: "lockers",
            label: "Lockers",
            summary:
                "Lockers and what is in them, and who has the key.",
            defaultEnabled: true,
        },
        {
            key: "pt_packages",
            label: "Personal-training packages",
            summary:
                "Sell a block of sessions with a trainer.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultPlanMonths",
            label: "Default membership term (months)",
            type: "number",
            default: 1,
        },
        {
            key: "graceDays",
            label: "Grace days after a lapse",
            type: "number",
            default: 3,
            help: "How long a member may miss days before the membership is treated as lapsed.",
        },
        {
            key: "lockerFee",
            label: "Locker fee",
            type: "number",
            default: 0,
        },
        {
            key: "ptSessionMinutes",
            label: "Length of a training session (minutes)",
            type: "number",
            default: 60,
        },
        {
            key: "autoRenew",
            label: "Renew memberships automatically",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A membership is a plan and a payment schedule. There is no class booking, no capacity limit and no waitlist for a busy class.",
        "Attendance counts the visit. It does not link to a specific class or a trainer.",
        "Automatic renewal raises the charge. It does not take the payment through a provider on its own, and a failed renewal does not retry on a schedule.",
        "There is no access-control log, no turnstile integration and no photo for a membership card.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Laundry and dry cleaning
 * ──────────────────────────────────────────────────────────────────────── */

const laundry: IndustryPackageDescriptor = {
    key: "laundry",
    label: "Laundry & dry cleaning",
    summary:
        "Laundry with per-kilogram pricing, garment-level ticket tracking, a turnaround promise and collection and delivery.",
    categoryId: "laundry",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "services", "deliveries", "quotes", "leads", "payroll", "notifications", "imports", "pricing"],
    features: [
        {
            key: "per_kg_pricing",
            label: "Per-kilogram pricing",
            summary:
                "Price the wash by the weight of the load, with a minimum.",
            defaultEnabled: true,
        },
        {
            key: "garment_tickets",
            label: "Garment tickets",
            summary:
                "Number every garment, so one lost shirt is not the whole load.",
            defaultEnabled: true,
        },
        {
            key: "turnaround",
            label: "Turnaround tracking",
            summary:
                "Promise a day and see which tickets are late.",
            defaultEnabled: true,
        },
        {
            key: "collection_delivery",
            label: "Collection and delivery",
            summary:
                "Collect from the customer and deliver back, with the route on the ticket.",
            defaultEnabled: true,
        },
        {
            key: "stain_treatment",
            label: "Stain treatment",
            summary:
                "Record a stain and what was done about it, against the garment.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "pricePerKg",
            label: "Price per kilogram",
            type: "number",
            default: 0,
        },
        {
            key: "minimumCharge",
            label: "Minimum charge",
            type: "number",
            default: 0,
        },
        {
            key: "turnaroundHours",
            label: "Turnaround (hours)",
            type: "number",
            default: 48,
        },
        {
            key: "deliveryFee",
            label: "Delivery fee",
            type: "number",
            default: 0,
        },
        {
            key: "freeDeliveryAbove",
            label: "Free delivery above",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "The ticket tracks the order, not the machine. SMARTBUZ does not know which washer ran the load or what it cost to run.",
        "A stain is a note on the ticket. There is no stain library and no before-and-after photograph.",
        "The collection and delivery record holds the address and the fee. There is no driver route, no driver app and no proof of delivery.",
        "There is no loyalty scheme beyond the shared points ledger, and no subscription.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Tailoring and fashion design
 * ──────────────────────────────────────────────────────────────────────── */

const tailor: IndustryPackageDescriptor = {
    key: "tailor",
    label: "Tailoring & fashion design",
    summary:
        "Bespoke tailoring with customer measurements, fabric stock, work-in-progress orders and delivery deadlines.",
    categoryId: "tailor",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "services", "production", "deliveries", "quotes", "leads", "payroll", "measurements", "notifications", "imports"],
    features: [
        {
            key: "measurements",
            label: "Customer measurements",
            summary:
                "Keep a customer's measurements and reuse them on the next order.",
            defaultEnabled: true,
        },
        {
            key: "fabric_stock",
            label: "Fabric stock",
            summary:
                "Track the fabric by the metre, and cut from it.",
            defaultEnabled: true,
        },
        {
            key: "work_orders",
            label: "Work-in-progress orders",
            summary:
                "An order that is measured, cut, sewn and fitted — and where it has got to.",
            defaultEnabled: true,
        },
        {
            key: "fitting_appointments",
            label: "Fitting appointments",
            summary:
                "Book the customer in for a fitting.",
            defaultEnabled: true,
        },
        {
            key: "deposits",
            label: "Deposits",
            summary:
                "Take a deposit on the order, and the rest when it is finished.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultTurnaroundDays",
            label: "Turnaround (days)",
            type: "number",
            default: 14,
        },
        {
            key: "depositPercent",
            label: "Deposit taken up front",
            type: "number",
            default: 50,
        },
        {
            key: "measurementsExpireMonths",
            label: "Measurements are good for (months)",
            type: "number",
            default: 12,
        },
        {
            key: "fabricUnit",
            label: "Fabric unit",
            type: "enum",
            default: "metre",
            options: [
                { value: "metre", label: "Metres" },
                { value: "yard", label: "Yards" },
            ],
        },
        {
            key: "alterationsPrice",
            label: "Alteration price",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A measurement set is a set of numbers against a customer. There is no size chart, no body-shape template and no garment pattern library.",
        "The work order records the stage the job has reached. It does not schedule the cutting table or the sewing hours, and there is no piece-rate for the tailor.",
        "Fabric is tracked by the metre taken from stock. There is no lay plan, so the offcut is not booked back in automatically.",
        "There is no pattern making, no CAD and no picture of the finished garment.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Carpentry and furniture
 * ──────────────────────────────────────────────────────────────────────── */

const carpentry: IndustryPackageDescriptor = {
    key: "carpentry",
    label: "Carpentry & furniture",
    summary:
        "Furniture making and repair with timber stock, work orders, custom dimensions and installation.",
    categoryId: "carpentry",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "services", "production", "deliveries", "quotes", "leads", "payroll", "measurements", "notifications", "imports", "pricing"],
    features: [
        {
            key: "timber_stock",
            label: "Timber stock",
            summary:
                "Track timber by length and by board, in the units the yard buys in.",
            defaultEnabled: true,
        },
        {
            key: "custom_dimensions",
            label: "Custom dimensions",
            summary:
                "Record the size the customer asked for, so the job is cut right.",
            defaultEnabled: true,
        },
        {
            key: "work_orders",
            label: "Work orders",
            summary:
                "A job with its own measurements, its material and its due date.",
            defaultEnabled: true,
        },
        {
            key: "installation",
            label: "Installation",
            summary:
                "Record the installation and who did it.",
            defaultEnabled: true,
        },
        {
            key: "repair_quotes",
            label: "Repair quotes",
            summary:
                "Quote a repair before the customer decides.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "timberUnit",
            label: "Timber unit",
            type: "enum",
            default: "board",
            options: [
                { value: "board", label: "Boards" },
                { value: "metre", label: "Metres" },
                { value: "piece", label: "Pieces" },
            ],
        },
        {
            key: "quoteValidDays",
            label: "A quote is good for (days)",
            type: "number",
            default: 14,
        },
        {
            key: "defaultWarrantyMonths",
            label: "Warranty (months)",
            type: "number",
            default: 3,
        },
        {
            key: "installationFee",
            label: "Installation fee",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A custom dimension is a set of numbers against an order. There is no cut list, no nesting and no offcut tracked back into stock.",
        "The work order records the stage. It does not plan the workshop or measure the hours, and there is no piece rate.",
        "The installation record holds the date and who did it. It does not take a photograph, a signature or a customer acceptance.",
        "There is no design library and no drawing attached to a job.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Welding and metal fabrication
 * ──────────────────────────────────────────────────────────────────────── */

const welding: IndustryPackageDescriptor = {
    key: "welding",
    label: "Welding & metal fabrication",
    summary:
        "Metal fabrication with job orders, metal stock by weight, custom dimensions and site installation.",
    categoryId: "welding",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "services", "production", "deliveries", "quotes", "leads", "payroll", "notifications", "imports", "measurements", "pricing"],
    features: [
        {
            key: "weight_stock",
            label: "Metal stock by weight",
            summary:
                "Track steel, pipe and plate by the kilogram, not by the piece.",
            defaultEnabled: true,
        },
        {
            key: "custom_dimensions",
            label: "Custom dimensions",
            summary:
                "Record the size the job needs, so the metal is cut right.",
            defaultEnabled: true,
        },
        {
            key: "job_orders",
            label: "Job orders",
            summary:
                "A job with its own drawing, its material and its due date.",
            defaultEnabled: true,
        },
        {
            key: "site_installation",
            label: "Site installation",
            summary:
                "Record the installation, the site and who did it.",
            defaultEnabled: true,
        },
        {
            key: "welding_logs",
            label: "Welding logs",
            summary:
                "Record the welder, the process and the consumables used on a job.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "metalUnit",
            label: "Metal unit",
            type: "enum",
            default: "kg",
            options: [
                { value: "kg", label: "Kilograms" },
                { value: "tonne", label: "Tonnes" },
                { value: "metre", label: "Metres" },
            ],
        },
        {
            key: "offcutTracking",
            label: "Book offcuts back into stock",
            type: "boolean",
            default: true,
        },
        {
            key: "quoteValidDays",
            label: "A quote is good for (days)",
            type: "number",
            default: 14,
        },
        {
            key: "siteCalloutFee",
            label: "Site call-out fee",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "The offcut is booked back by the weight the operator enters. SMARTBUZ does not lay out the plate, so the offcut is not worked out for you.",
        "A welding log records the welder and the consumables. There is no qualification record, no procedure specification (WPS) and no inspector's sign-off.",
        "There is no structural calculation and no certification of the finished job.",
        "The site record holds the address and the date. It does not take a photograph of the finished work or the customer's acceptance.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Construction and hardware
 * ──────────────────────────────────────────────────────────────────────── */

const construction: IndustryPackageDescriptor = {
    key: "construction",
    label: "Construction & hardware",
    summary:
        "Hardware and building materials with site delivery, contractor credit, cement and steel unit handling and project costing.",
    categoryId: "construction",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "assets", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "plans", "rentals"],
    features: [
        {
            key: "project_costing",
            label: "Project costing",
            summary:
                "Cost a project as the materials go out to it, not at the end.",
            defaultEnabled: true,
        },
        {
            key: "site_delivery",
            label: "Site delivery",
            summary:
                "Deliver to the site and record what went on the truck.",
            defaultEnabled: true,
        },
        {
            key: "contractor_credit",
            label: "Contractor credit",
            summary:
                "Sell to a contractor on credit, against a limit.",
            defaultEnabled: true,
        },
        {
            key: "bulk_units",
            label: "Cement and steel by unit",
            summary:
                "Handle bags, tonnes and lengths without a decimal.",
            defaultEnabled: true,
        },
        {
            key: "hire_equipment",
            label: "Equipment hire",
            summary:
                "Hire out the mixer or the roller, and track it out and back.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "pcs",
            options: [
                { value: "pcs", label: "Pieces" },
                { value: "bag", label: "Bags" },
                { value: "tonne", label: "Tonnes" },
                { value: "metre", label: "Metres" },
                { value: "roll", label: "Rolls" },
            ],
        },
        {
            key: "defaultCreditDays",
            label: "Contractor credit term (days)",
            type: "number",
            default: 30,
        },
        {
            key: "deliveryFee",
            label: "Delivery fee",
            type: "number",
            default: 0,
        },
        {
            key: "minimumOrderForDelivery",
            label: "Minimum order for free delivery",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A project cost is the sum of the materials issued to it. It does not include the labour, the plant or the subcontractor's own invoice.",
        "A delivery record carries the site and the status. It does not carry the individual lines, so a delivery cannot be checked off against a picking list.",
        "Contractor credit uses the shared credit limit. There is no retention, no progress claim and no certificate of valuation.",
        "There is no bill of quantities and no variation order workflow.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Hardware and tools
 * ──────────────────────────────────────────────────────────────────────── */

const hardware: IndustryPackageDescriptor = {
    key: "hardware",
    label: "Hardware & tools",
    summary:
        "Hardware and tool retail with unit conversion, hire of power tools, and contractor accounts.",
    categoryId: "hardware",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "rentals", "deliveries", "pricing", "quotes", "leads", "plans", "payroll", "notifications", "imports"],
    features: [
        {
            key: "unit_conversion",
            label: "Unit conversion",
            summary:
                "Hold how many kilos are in a bag, so the yard can buy in bags and sell by weight.",
            defaultEnabled: true,
        },
        {
            key: "tool_hire",
            label: "Tool hire",
            summary:
                "Hire out a power tool and track it out and back.",
            defaultEnabled: true,
        },
        {
            key: "contractor_accounts",
            label: "Contractor accounts",
            summary:
                "Sell to a contractor on credit, against a limit.",
            defaultEnabled: true,
        },
        {
            key: "bulk_tiers",
            label: "Bulk pricing",
            summary:
                "A price that drops as the quantity grows.",
            defaultEnabled: true,
        },
        {
            key: "cut_to_length",
            label: "Cut to length",
            summary:
                "Cut timber or pipe to the length the customer asks for.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "pcs",
            options: [
                { value: "pcs", label: "Pieces" },
                { value: "bag", label: "Bags" },
                { value: "kg", label: "Kilograms" },
                { value: "metre", label: "Metres" },
                { value: "litre", label: "Litres" },
            ],
        },
        {
            key: "hireDepositPercent",
            label: "Hire deposit",
            type: "number",
            default: 50,
        },
        {
            key: "defaultHireDays",
            label: "Default hire (days)",
            type: "number",
            default: 3,
        },
        {
            key: "cutFeePerCut",
            label: "Cut fee",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A hire record holds the asset, the customer and the dates. There is no servicing schedule for the tool and no damage inspection on return.",
        "The cut-to-length charge is the fee the operator enters. SMARTBUZ does not measure the cut or work out the offcut.",
        "Contractor credit uses the shared credit limit, with no retention and no dunning schedule.",
        "There is no supplier price comparison and no automatic reorder suggestion.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Cleaning services
 * ──────────────────────────────────────────────────────────────────────── */

const cleaning: IndustryPackageDescriptor = {
    key: "cleaning",
    label: "Cleaning services",
    summary:
        "Cleaning and fumigation contracts with recurring schedules, per-visit billing and staff assignment.",
    categoryId: "cleaning",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "appointments", "services", "deliveries", "quotes", "leads", "payroll", "notifications", "imports"],
    features: [
        {
            key: "recurring_contracts",
            label: "Recurring contracts",
            summary:
                "A contract that is serviced on a schedule and billed each time.",
            defaultEnabled: true,
        },
        {
            key: "per_visit_billing",
            label: "Per-visit billing",
            summary:
                "Bill each visit, with what was cleaned and how long it took.",
            defaultEnabled: true,
        },
        {
            key: "staff_assignment",
            label: "Staff assignment",
            summary:
                "Say who is going to the site, and see who is working where.",
            defaultEnabled: true,
        },
        {
            key: "checklists",
            label: "Service checklists",
            summary:
                "The list of what the visit covers, and what was ticked off.",
            defaultEnabled: true,
        },
        {
            key: "fumigation",
            label: "Fumigation",
            summary:
                "Record a fumigation: the chemical, the area and the certificate.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultFrequency",
            label: "Default frequency",
            type: "enum",
            default: "weekly",
            options: [
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "fortnightly", label: "Fortnightly" },
                { value: "monthly", label: "Monthly" },
            ],
        },
        {
            key: "defaultVisitMinutes",
            label: "Default visit length (minutes)",
            type: "number",
            default: 90,
        },
        {
            key: "fuelAllowance",
            label: "Travel allowance per visit",
            type: "number",
            default: 0,
        },
        {
            key: "requireChecklist",
            label: "Require the checklist to be completed",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A contract is a schedule and a price. It does not raise a work order for each visit automatically; the visit is recorded against it.",
        "The checklist records what was ticked. There is no photograph of the site and no client signature.",
        "A fumigation record holds the chemical and the certificate number entered by the operator; SMARTBUZ does not issue the certificate.",
        "There is no payroll deduction for the staff on a visit, and no overtime or leave handling.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Photography and studio
 * ──────────────────────────────────────────────────────────────────────── */

const photography: IndustryPackageDescriptor = {
    key: "photography",
    label: "Photography & studio",
    summary:
        "Photo studio with session booking, package sales, prints upsell and shoot scheduling.",
    categoryId: "photography",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "bookings", "services", "production", "quotes", "leads", "payroll", "notifications", "imports", "appointments"],
    features: [
        {
            key: "session_booking",
            label: "Session booking",
            summary:
                "Book the studio and the photographer for a shoot.",
            defaultEnabled: true,
        },
        {
            key: "package_sales",
            label: "Package sales",
            summary:
                "Sell a package of prints or a session with extras.",
            defaultEnabled: true,
        },
        {
            key: "prints_upsell",
            label: "Prints upsell",
            summary:
                "Offer the prints and the frames after the shoot.",
            defaultEnabled: true,
        },
        {
            key: "client_gallery",
            label: "Client gallery",
            summary:
                "Keep the client's pictures and what was ordered from them.",
            defaultEnabled: false,
        },
        {
            key: "shoot_scheduling",
            label: "Shoot scheduling",
            summary:
                "Know which shoots are on, and when each one is.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultSessionMinutes",
            label: "Length of a session (minutes)",
            type: "number",
            default: 60,
        },
        {
            key: "depositPercent",
            label: "Deposit up front",
            type: "number",
            default: 50,
        },
        {
            key: "printSettlementDays",
            label: "Prints settle in (days)",
            type: "number",
            default: 14,
        },
        {
            key: "includeGalleryAccess",
            label: "Include gallery access in every booking",
            type: "boolean",
            default: false,
        },
    ],
    limitations: [
        "A session booking holds the time, the package and the fee. SMARTBUZ does not take the photographs and there is no online gallery without a third-party service.",
        "The prints upsell is a list of products the operator offers. It is not a live proofing tool.",
        "There is no second-shooter allocation, no studio-capacity limit and no equipment list per shoot.",
        "There is no licence or usage-rights tracking on the images.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Events and catering
 * ──────────────────────────────────────────────────────────────────────── */

const event: IndustryPackageDescriptor = {
    key: "event",
    label: "Events & catering",
    summary:
        "Event management and catering with per-guest pricing, deposits, venue hire and event scheduling.",
    categoryId: "event",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "loans", "bookings", "services", "deliveries", "quotes", "leads", "payroll", "notifications", "imports", "appointments", "pricing", "measurements"],
    features: [
        {
            key: "per_guest_pricing",
            label: "Per-guest pricing",
            summary:
                "Price a menu per guest and multiply it out when the numbers change.",
            defaultEnabled: true,
        },
        {
            key: "deposits",
            label: "Deposits",
            summary:
                "Take a deposit on the booking and the rest nearer the day.",
            defaultEnabled: true,
        },
        {
            key: "venue_hire",
            label: "Venue hire",
            summary:
                "Hire out a venue, with the hours and what it costs.",
            defaultEnabled: true,
        },
        {
            key: "event_scheduling",
            label: "Event scheduling",
            summary:
                "Keep the diary of events and the people who staff them.",
            defaultEnabled: true,
        },
        {
            key: "supplier_costs",
            label: "Supplier costs",
            summary:
                "Record what the hire, the caterer and the flowers cost, so the margin is real.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "depositPercent",
            label: "Deposit up front",
            type: "number",
            default: 30,
        },
        {
            key: "defaultGuestCount",
            label: "Default number of guests",
            type: "number",
            default: 50,
        },
        {
            key: "venueHourlyRate",
            label: "Venue rate per hour",
            type: "number",
            default: 0,
        },
        {
            key: "serviceStaffRatio",
            label: "Staff per guest",
            type: "number",
            default: 12,
            help: "How many guests one member of staff can serve.",
        },
    ],
    limitations: [
        "An event prices by guest and records the supplier costs the operator enters. SMARTBUZ does not place the hire orders or check the caterer's availability.",
        "The staffing figure is a ratio; it does not build a rota, check the staff's availability or record their hours.",
        "There is no seating plan and no table allocation.",
        "There is no weather contingency for an outdoor event and no deposit schedule beyond the one percentage.",
    ],
};

export const servicesPackages: IndustryPackageDescriptor[] = [
    barber,
    salon,
    salonSpa,
    fitness,
    laundry,
    tailor,
    carpentry,
    welding,
    construction,
    hardware,
    cleaning,
    photography,
    event,
];
