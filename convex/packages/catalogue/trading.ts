/**
 * SMART_BUZ — the packages for the trading businesses.
 *
 * Industrial & Mobility: the businesses that sell things people need
 * tracked or serviced — a phone shop, an electronics retailer, a repair
 * workshop, a salvage yard, a filling station, a transport operator, a
 * driving school.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * Mobile phone shop
 * ──────────────────────────────────────────────────────────────────────── */

const mobile: IndustryPackageDescriptor = {
    key: "mobile",
    label: "Mobile phone shop",
    summary:
        "Phones and accessories with IMEI and serial tracking, a warranty register, trade-ins and carrier bundles.",
    categoryId: "mobile",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "services", "pricing", "quotes", "leads", "plans", "payroll", "notifications", "imports", "batches"],
    features: [
        {
            key: "imei_tracking",
            label: "IMEI and serial tracking",
            summary:
                "Every handset's IMEI, so a phone can be traced to the till it was sold at.",
            defaultEnabled: true,
        },
        {
            key: "warranty_register",
            label: "Warranty register",
            summary:
                "Know which handsets are under warranty, until when, and who bought them.",
            defaultEnabled: true,
        },
        {
            key: "trade_in",
            label: "Trade-ins",
            summary:
                "Take a phone in part payment and put its value against the new one.",
            defaultEnabled: true,
        },
        {
            key: "carrier_bundles",
            label: "Carrier bundles",
            summary:
                "Sell the handset and the airtime together as one line.",
            defaultEnabled: true,
        },
        {
            key: "accessory_bundles",
            label: "Accessory bundles",
            summary:
                "Sell the charger, the case and the screen together with the phone.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "requireImei",
            label: "Require an IMEI on every handset",
            type: "boolean",
            default: true,
        },
        {
            key: "warrantyMonths",
            label: "Default warranty (months)",
            type: "number",
            default: 12,
        },
        {
            key: "tradeInEnabled",
            label: "Accept trade-ins",
            type: "boolean",
            default: true,
        },
        {
            key: "tradeInMarkupPercent",
            label: "Trade-in valuation margin",
            type: "number",
            default: 20,
            help: "The margin added to a trade-in value before it is offered.",
        },
        {
            key: "bundlesRequireSim",
            label: "Bundles need a SIM",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A trade-in is valued by the operator and put against the sale. SMARTBUZ does not test the phone, grade it or check it against a stolen-device list.",
        "The warranty register records what was sold and when. It does not raise a claim with the manufacturer or track a repair.",
        "A carrier bundle is one sale line. The airtime itself is not managed here — there is no subscriber account, no recharge and no network settlement.",
        "There is no device-credit plan with a monthly instalment and a handset return at the end.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Electronics and appliances
 * ──────────────────────────────────────────────────────────────────────── */

const electronics: IndustryPackageDescriptor = {
    key: "electronics",
    label: "Electronics & appliances",
    summary:
        "TVs, fridges and appliances with serial and warranty tracking, installation bookings and technician service tickets.",
    categoryId: "electronics",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "services", "deliveries", "pricing", "quotes", "leads", "plans", "payroll", "notifications", "imports", "batches", "assets"],
    features: [
        {
            key: "serial_tracking",
            label: "Serial and warranty tracking",
            summary:
                "Every appliance's serial number and its warranty, against the customer who bought it.",
            defaultEnabled: true,
        },
        {
            key: "installation_booking",
            label: "Installation booking",
            summary:
                "Book the installer and the date the appliance goes in.",
            defaultEnabled: true,
        },
        {
            key: "service_tickets",
            label: "Service tickets",
            summary:
                "A repair job, the fault, the parts used and what it cost.",
            defaultEnabled: true,
        },
        {
            key: "extended_warranty",
            label: "Extended warranty",
            summary:
                "Sell a warranty that runs past the manufacturer's, and keep the two apart.",
            defaultEnabled: true,
        },
        {
            key: "trade_in",
            label: "Trade-ins",
            summary:
                "Take an old appliance in part payment.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "warrantyMonths",
            label: "Manufacturer warranty (months)",
            type: "number",
            default: 12,
        },
        {
            key: "extendedWarrantyMonths",
            label: "Extended warranty (months)",
            type: "number",
            default: 12,
        },
        {
            key: "installationFee",
            label: "Installation fee",
            type: "number",
            default: 0,
        },
        {
            key: "serviceCalloutFee",
            label: "Service call-out fee",
            type: "number",
            default: 0,
        },
        {
            key: "tradeInEnabled",
            label: "Accept trade-ins",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "The serial register records what was sold. SMARTBUZ does not check the warranty with the manufacturer and does not raise the claim.",
        "An installation booking reserves a technician's time. There is no technician rota, no van stock and no job sheet for the engineer.",
        "A service ticket records the fault, the parts and the labour cost the technician enters. It does not order the parts.",
        "There is no energy-efficiency rating on the catalogue and no recycling or disposal record for the old appliance.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Electronics repair
 * ──────────────────────────────────────────────────────────────────────── */

const electronicsRepair: IndustryPackageDescriptor = {
    key: "electronics_repair",
    label: "Electronics repair",
    summary:
        "A repair workshop with job tickets, fault diagnosis, parts consumption and warranty periods.",
    categoryId: "electronics_repair",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "services", "quotes", "leads", "payroll", "notifications", "imports", "batches", "measurements"],
    features: [
        {
            key: "repair_tickets",
            label: "Repair tickets",
            summary:
                "A job with the device, the fault, the diagnosis and the outcome.",
            defaultEnabled: true,
        },
        {
            key: "parts_consumption",
            label: "Parts consumption",
            summary:
                "Take the parts used off the stock and see what the job really cost.",
            defaultEnabled: true,
        },
        {
            key: "fault_history",
            label: "Fault history",
            summary:
                "What has been wrong with this device before.",
            defaultEnabled: true,
        },
        {
            key: "repair_warranty",
            label: "Repair warranty",
            summary:
                "The period the repair is guaranteed for, and what it covers.",
            defaultEnabled: true,
        },
        {
            key: "bench_diagnostics",
            label: "Bench diagnostics",
            summary:
                "Record the tests run, so the diagnosis is not guesswork.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultLabourRate",
            label: "Labour rate per hour",
            type: "number",
            default: 0,
        },
        {
            key: "diagnosticFee",
            label: "Diagnostic fee",
            type: "number",
            default: 0,
            help: "The fee taken before the repair is quoted. Zero means no fee.",
        },
        {
            key: "repairWarrantyDays",
            label: "Repair warranty (days)",
            type: "number",
            default: 30,
        },
        {
            key: "requireModelAndSerial",
            label: "Require the model and serial",
            type: "boolean",
            default: true,
        },
        {
            key: "depositPercent",
            label: "Deposit on a repair",
            type: "number",
            default: 0,
        },
    ],
    limitations: [
        "A repair ticket records the diagnosis the technician entered. SMARTBUZ does not run a diagnostic, read a board or suggest a fault.",
        "Parts are taken off the stock by the quantity the technician enters. There is no parts reservation while the device is on the bench.",
        "There is no bench queue, no technician productivity and no workshop board.",
        "There is no repair-tracking link to the manufacturer and no firmware or software flashing record.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Second-hand and salvage
 * ──────────────────────────────────────────────────────────────────────── */

const salvage: IndustryPackageDescriptor = {
    key: "salvage",
    label: "Second-hand / salvage",
    summary:
        "Used goods trading with condition grading, unique serial tracking and refurbishment cost tracking.",
    categoryId: "salvage",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "promotions", "suppliers", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "batches", "plans"],
    features: [
        {
            key: "condition_grading",
            label: "Condition grading",
            summary:
                "Grade each item, and price it from the grade.",
            defaultEnabled: true,
        },
        {
            key: "unique_serial_tracking",
            label: "Unique serial tracking",
            summary:
                "Every used item has its own serial, so one unit can be traced.",
            defaultEnabled: true,
        },
        {
            key: "refurbishment_costs",
            label: "Refurbishment costs",
            summary:
                "Record what it cost to put an item right, and see the margin.",
            defaultEnabled: true,
        },
        {
            key: "grade_pricing",
            label: "Grade-based pricing",
            summary:
                "A price per grade, so the same model sells at different prices.",
            defaultEnabled: true,
        },
        {
            key: "warranty_on_used",
            label: "Warranty on used goods",
            summary:
                "Sell used goods with a warranty of their own, apart from the manufacturer's.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "grades",
            label: "Grades used",
            type: "string",
            default: "grade_a,grade_b,grade_c,as_is",
            help: "The condition grades the business trades in, separated by commas.",
        },
        {
            key: "defaultGrade",
            label: "Default grade",
            type: "enum",
            default: "grade_b",
            options: [
                { value: "grade_a", label: "Grade A" },
                { value: "grade_b", label: "Grade B" },
                { value: "grade_c", label: "Grade C" },
                { value: "as_is", label: "As is" },
            ],
        },
        {
            key: "warrantyDays",
            label: "Warranty on used goods (days)",
            type: "number",
            default: 30,
        },
        {
            key: "requireSerial",
            label: "Require a serial on every used item",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A grade is what the operator says the item is. There is no checklist behind the grade and no grading photograph.",
        "Refurbishment costs are entered against the item. There is no work order, no labour routing and no parts reservation.",
        "The warranty on a used item is a period on the sale; there is no third-party warranty claim workflow.",
        "There is no consignment, no buy-back pricing rule and no dealer settlement.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Fuel station
 * ──────────────────────────────────────────────────────────────────────── */

const fuel: IndustryPackageDescriptor = {
    key: "fuel",
    label: "Fuel station",
    summary:
        "A petrol station with pump management, price per litre, attendant shift reconciliation and fuel-loss tracking.",
    categoryId: "fuel",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "fuelPump", "assets", "pricing", "payroll", "notifications", "imports", "attendance"],
    features: [
        {
            key: "pump_management",
            label: "Pump management",
            summary:
                "Every pump, what it is set to and what it is selling.",
            defaultEnabled: true,
        },
        {
            key: "price_per_litre",
            label: "Price per litre",
            summary:
                "Price by the litre, and change the price at any time.",
            defaultEnabled: true,
        },
        {
            key: "shift_reconciliation",
            label: "Shift reconciliation",
            summary:
                "Reconcile the attendant's shift against the fuel that was sold.",
            defaultEnabled: true,
        },
        {
            key: "fuel_loss_tracking",
            label: "Fuel loss tracking",
            summary:
                "Compare the fuel delivered against the fuel sold, and see the loss.",
            defaultEnabled: true,
        },
        {
            key: "tank_management",
            label: "Tank management",
            summary:
                "What is in each tank and how much is left.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "litre",
            options: [
                { value: "litre", label: "Litres" },
                { value: "kg", label: "Kilograms" },
            ],
        },
        {
            key: "lossTolerancePercent",
            label: "Acceptable loss",
            type: "number",
            default: 2,
            help: "The percentage of loss that is still normal. Anything more is flagged.",
        },
        {
            key: "shiftHours",
            label: "Length of an attendant shift (hours)",
            type: "number",
            default: 8,
        },
        {
            key: "requireAttendantNumber",
            label: "Require the attendant's number",
            type: "boolean",
            default: true,
        },
        {
            key: "priceIncludesTax",
            label: "Price includes tax",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "The fuel loss figure compares what was delivered against what was sold, using the stock record. It does not measure the tank or correct for temperature, so a small loss is normal and a large one is flagged rather than explained.",
        "There is no automatic link to a tank gauge, no dip reading and no calibration record.",
        "A shift reconciliation compares the attendant's cash against the sales of the shift. It does not take a physical reading of the tank at the start and the end.",
        "There is no card terminal integration and no loyalty scheme for the forecourt.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Transport and taxi
 * ──────────────────────────────────────────────────────────────────────── */

const transport: IndustryPackageDescriptor = {
    key: "transport",
    label: "Transport / taxi",
    summary:
        "A transport operator with per-route fares, vehicle records, driver assignment, trip revenue and vehicle servicing.",
    categoryId: "transport",
    modules: ["sales", "pos", "expenses", "banking", "reports", "customers", "assets", "services", "maintenance", "payroll", "notifications", "imports", "attendance"],
    features: [
        {
            key: "route_fares",
            label: "Route fares",
            summary:
                "A fare per route, changed when the fuel price moves.",
            defaultEnabled: true,
        },
        {
            key: "vehicle_records",
            label: "Vehicle records",
            summary:
                "Every vehicle, its papers and its condition.",
            defaultEnabled: true,
        },
        {
            key: "driver_assignment",
            label: "Driver assignment",
            summary:
                "Which vehicle and which driver are on the road today.",
            defaultEnabled: true,
        },
        {
            key: "trip_revenue",
            label: "Trip revenue",
            summary:
                "What each route and each vehicle earned.",
            defaultEnabled: true,
        },
        {
            key: "servicing_schedule",
            label: "Servicing schedule",
            summary:
                "Know which vehicle is due for a service and which is overdue.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultFareBasis",
            label: "Fare is",
            type: "enum",
            default: "route",
            options: [
                { value: "route", label: "Per route" },
                { value: "distance", label: "Per kilometre" },
            ],
        },
        {
            key: "serviceIntervalKm",
            label: "Service interval (km)",
            type: "number",
            default: 5000,
        },
        {
            key: "serviceIntervalDays",
            label: "Service interval (days)",
            type: "number",
            default: 90,
        },
        {
            key: "driverCommissionPercent",
            label: "Driver's share",
            type: "number",
            default: 0,
            help: "The share of the fare that goes to the driver. Zero means the whole fare is the operator's.",
        },
    ],
    limitations: [
        "A trip is recorded against a route or a vehicle. There is no passenger-ticket record, so a shared taxi's passengers are not counted.",
        "There is no GPS or telematics link, so the distance a vehicle covered comes from the odometer the operator enters.",
        "The servicing list is a reminder by distance or by date. It does not book a garage or hold a spare part for the job.",
        "There is no vehicle-hire agreement, no deposit handling and no excess waiver on a hired vehicle.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Driving school
 * ──────────────────────────────────────────────────────────────────────── */

const drivingSchool: IndustryPackageDescriptor = {
    key: "driving_school",
    label: "Driving school",
    summary:
        "A driving school with learner enrolment, lesson scheduling, a vehicle fleet, instructor allocation and fee tracking.",
    categoryId: "driving_school",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "members", "bookings", "assets", "attendance", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "appointments"],
    features: [
        {
            key: "learner_enrolment",
            label: "Learner enrolment",
            summary:
                "Enrol a learner, with their permit and their contact details.",
            defaultEnabled: true,
        },
        {
            key: "lesson_scheduling",
            label: "Lesson scheduling",
            summary:
                "Book a lesson against a learner, a vehicle and an instructor.",
            defaultEnabled: true,
        },
        {
            key: "instructor_allocation",
            label: "Instructor allocation",
            summary:
                "Which instructor is teaching which learners this week.",
            defaultEnabled: true,
        },
        {
            key: "vehicle_fleet",
            label: "Vehicle fleet",
            summary:
                "The cars, their papers and when they are in use.",
            defaultEnabled: true,
        },
        {
            key: "fee_tracking",
            label: "Fee tracking",
            summary:
                "What each learner has paid and what is still due.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "lessonMinutes",
            label: "Length of a lesson (minutes)",
            type: "number",
            default: 60,
        },
        {
            key: "lessonPrice",
            label: "Price of a lesson",
            type: "number",
            default: 0,
        },
        {
            key: "theoryLessons",
            label: "Theory lessons included",
            type: "number",
            default: 4,
        },
        {
            key: "depositPercent",
            label: "Deposit up front",
            type: "number",
            default: 50,
        },
        {
            key: "vehiclesPerInstructor",
            label: "Vehicles per instructor",
            type: "number",
            default: 1,
        },
    ],
    limitations: [
        "A lesson is booked against a learner, a vehicle and an instructor. There is no conflict check across the instructor's own calendar beyond the booking itself.",
        "There is no learner's licence record kept by the school — the learner keeps that — and no tracking of the tests booked with the licensing authority.",
        "Fee tracking uses the shared invoice and payment records. There is no instalment plan specific to a learner and no automatic reminder before the fee is due.",
        "There is no vehicle tracking for the school's own cars beyond which lesson they are on.",
    ],
};

export const tradingPackages: IndustryPackageDescriptor[] = [
    mobile,
    electronics,
    electronicsRepair,
    salvage,
    fuel,
    transport,
    drivingSchool,
];
