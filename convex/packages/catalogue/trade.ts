/**
 * SMART_BUZ — the packages for the retail and trade businesses.
 *
 * Retail & Trade: the shops that sell goods — a mini-market, an
 * agro-dealer, a farm aggregator, a dairy, a butchery, a bakery, a
 * bookshop, a stationer, a printer, a shoe shop, a beauty counter.
 *
 * Every package here describes what that trade does differently from a
 * plain shop, and — just as importantly — what SMARTBUZ does not do for
 * it yet. The limits are part of the description: a business that knows
 * them on Monday is not finding them out on Saturday.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * General retail — the mini-market
 * ──────────────────────────────────────────────────────────────────────── */

const retail: IndustryPackageDescriptor = {
    key: "retail",
    label: "General retail / mini-market",
    summary:
        "Counter sales for everyday goods, with loyalty points, promotions and the layaway plans a customer asks for when they cannot pay all at once.",
    categoryId: "retail",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "promotions", "suppliers", "pricing", "quotes", "leads", "plans", "payroll", "notifications", "imports", "batches", "expiry"],
    features: [
        {
            key: "loyalty_points",
            label: "Loyalty points",
            summary:
                "Award points on what a customer spends and let them spend them again.",
            defaultEnabled: true,
        },
        {
            key: "promotions",
            label: "Promotions",
            summary:
                "Run multi-buy and threshold promotions on products and on the whole basket.",
            defaultEnabled: true,
        },
        {
            key: "layaway",
            label: "Layaway plans",
            summary:
                "Let a customer pay for an item over time, with a deposit and a schedule of payments.",
            defaultEnabled: true,
        },
        {
            key: "expiry_alerts",
            label: "Expiry alerts",
            summary:
                "See what is about to expire, and take the oldest stock first.",
            defaultEnabled: true,
        },
        {
            key: "credit_sales",
            label: "Credit sales",
            summary:
                "Sell on credit against a limit, and see what each customer owes.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultLoyaltyRate",
            label: "Loyalty points per unit spent",
            type: "number",
            default: 1,
            help: "One point for each unit of money spent, by default.",
        },
        {
            key: "layawayMinimumDeposit",
            label: "Layaway deposit",
            type: "number",
            default: 30,
            help: "The percentage of the price taken when a plan is opened.",
        },
        {
            key: "layawayMonths",
            label: "Layaway term (months)",
            type: "number",
            default: 3,
        },
        {
            key: "expiryWarningDays",
            label: "Warn this many days before expiry",
            type: "number",
            default: 30,
        },
        {
            key: "allowCreditSales",
            label: "Allow credit sales",
            type: "boolean",
            default: false,
            help:
                "Turn this on to let a customer buy now and pay later. The credit limit is set on the customer.",
        },
    ],
    limitations: [
        "A layaway plan holds one item. A customer taking three things home over three months needs three plans, and the stock is only released from the shelf when the last payment is taken.",
        "Loyalty points are awarded and spent through the ledger; there is no tiered member level, no birthday bonus and no voucher printed from the till.",
        "Credit sales use the shared credit limit; there is no interest and no penalty rate on what is overdue.",
        "Promotions are threshold and multi-buy rules. There is no coupon code and no time-of-day pricing.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Agro-inputs
 * ──────────────────────────────────────────────────────────────────────── */

const agro: IndustryPackageDescriptor = {
    key: "agro",
    label: "Agriculture / agro-inputs",
    summary:
        "Sells seed, fertiliser and crop protection in sacks and by the kilogram, quotes per hectare, and keeps the buying group's credit in one place.",
    categoryId: "agro",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "plans"],
    features: [
        {
            key: "weight_pricing",
            label: "Weight-based pricing",
            summary:
                "Price a sack, a bag or a kilo from one price per unit of weight.",
            defaultEnabled: true,
        },
        {
            key: "unit_conversions",
            label: "Unit conversions",
            summary:
                "Hold how many kilos are in a sack, so the till can price in either unit.",
            defaultEnabled: true,
        },
        {
            key: "volume_tiers",
            label: "Volume pricing",
            summary:
                "A price that drops as the quantity grows — five sacks costs less than five.",
            defaultEnabled: true,
        },
        {
            key: "group_credit",
            label: "Group credit",
            summary:
                "Sell to a buying group on credit and see what the whole group owes.",
            defaultEnabled: false,
        },
        {
            key: "seasonal_stock",
            label: "Seasonal stock",
            summary:
                "Watch what is in stock against the season it belongs to.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "kg",
            options: [
                { value: "kg", label: "Kilograms" },
                { value: "sack", label: "Sacks" },
                { value: "bag", label: "Bags" },
                { value: "litre", label: "Litres" },
                { value: "pcs", label: "Pieces" },
            ],
            help: "The unit a new product gets when it is created.",
        },
        {
            key: "pricePerHectare",
            label: "Quote per hectare",
            type: "boolean",
            default: false,
            help:
                "On, the operator enters the area planted and SMARTBUZ works out what the inputs for it cost.",
        },
        {
            key: "defaultCreditDays",
            label: "Default credit term (days)",
            type: "number",
            default: 30,
        },
        {
            key: "requireBatchOnChemicals",
            label: "Require a batch on crop-protection products",
            type: "boolean",
            default: true,
            help:
                "With this on, a chemical cannot be sold without a batch number, so a recall can be traced.",
        },
    ],
    limitations: [
        "Quoting per hectare works from the area the operator enters and the rates on the price list. SMARTBUZ does not know the crop, the soil or the planting calendar, so it cannot recommend a rate.",
        "The seasonal stock view is a filter on dates the operator sets. It does not forecast a season or place an order with a supplier on its own.",
        "Group credit treats the buying group as one account; it does not split the debt between the members of the group.",
        "A crop-protection product is recorded by its batch, but there is no residue-withdrawal period, so SMARTBUZ cannot tell the operator when a product may safely be harvested.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Farm produce aggregator
 * ──────────────────────────────────────────────────────────────────────── */

const farming: IndustryPackageDescriptor = {
    key: "farming",
    label: "Farm produce / aggregator",
    summary:
        "Buys from farmers at a grade and a weight, pays out per delivery, and sells on to a buyer who wants to know exactly what they got.",
    categoryId: "farming",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "suppliers", "production", "receivables", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "batches", "expiry"],
    features: [
        {
            key: "grade_pricing",
            label: "Grade-based pricing",
            summary:
                "A price per kilogram for each grade, so the best fruit pays best.",
            defaultEnabled: true,
        },
        {
            key: "collection_records",
            label: "Collection records",
            summary:
                "Record what was delivered, by whom, at what weight and at what price.",
            defaultEnabled: true,
        },
        {
            key: "farmer_payments",
            label: "Farmer payments",
            summary:
                "Pay a farmer for a delivery, and see what they are still owed.",
            defaultEnabled: true,
        },
        {
            key: "buyer_settlement",
            label: "Buyer settlement",
            summary:
                "Settle with the buyer on the deliveries that went to them.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultGrade",
            label: "Default grade",
            type: "enum",
            default: "standard",
            options: [
                { value: "premium", label: "Premium" },
                { value: "standard", label: "Standard" },
                { value: "reject", label: "Reject" },
            ],
        },
        {
            key: "allowPartialDeliveries",
            label: "Allow part-delivery of an order",
            type: "boolean",
            default: true,
            help:
                "On, a buyer order can be filled over several collections. Off, it is filled in one.",
        },
        {
            key: "weighingPrecision",
            label: "Weight precision (kg)",
            type: "number",
            default: 2,
            help: "How many decimal places a weight carries.",
        },
        {
            key: "defaultBuyerCreditDays",
            label: "Buyer credit term (days)",
            type: "number",
            default: 14,
        },
    ],
    limitations: [
        "A delivery records a weight, a grade and a price. SMARTBUZ does not inspect the produce: the grade is what the operator said it was.",
        "Farmer payment is recorded against the delivery. There is no mobile-money payout, so the payment is marked as made once somebody has made it.",
        "The settlement view compares what was delivered against what was invoiced; it does not raise the buyer's invoice for you.",
        "There is no cold-chain or temperature record on a delivery.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Dairy
 * ──────────────────────────────────────────────────────────────────────── */

const dairy: IndustryPackageDescriptor = {
    key: "dairy",
    label: "Dairy / milk collection",
    summary:
        "Collects milk from farmers by the litre, records the fat and protein a farmer gets, and pays on quality rather than on volume alone.",
    categoryId: "dairy",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "suppliers", "production", "pricing", "leads", "payroll", "notifications", "imports", "batches", "expiry"],
    features: [
        {
            key: "volume_pricing",
            label: "Volume pricing",
            summary:
                "Pay a rate per litre, with a band that rises as the day's litres grow.",
            defaultEnabled: true,
        },
        {
            key: "quality_grade",
            label: "Quality grading",
            summary:
                "Grade each collection so a better grade pays more.",
            defaultEnabled: true,
        },
        {
            key: "collection_schedule",
            label: "Collection schedule",
            summary:
                "Know which farmers are due to be collected, and when they were last.",
            defaultEnabled: true,
        },
        {
            key: "chilling_records",
            label: "Chilling records",
            summary:
                "Record the temperature the milk was cooled to on arrival.",
            defaultEnabled: false,
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
            key: "priceBands",
            label: "Pay bands",
            type: "string",
            default: "0,500,1000",
            help:
                "The litre thresholds that change the rate, separated by commas. A farmer over a threshold is paid the higher rate for the whole day's milk.",
        },
        {
            key: "requireChillingTemperature",
            label: "Require a chilling temperature",
            type: "boolean",
            default: false,
            help: "With this on, a collection cannot be recorded without the temperature.",
        },
        {
            key: "paymentFrequency",
            label: "Payment frequency",
            type: "enum",
            default: "monthly",
            options: [
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
            ],
        },
    ],
    limitations: [
        "The fat and protein figures are what the operator entered from the test. SMARTBUZ does not run a milk test or read a milk analyser.",
        "Chilling temperature is recorded, not monitored: nothing is alerted when it is out of range.",
        "Payment is marked as made against a farmer's ledger. There is no mobile-money payout from inside SMARTBUZ.",
        "The collection schedule records who was due and when they were last collected; it does not plan vehicle routes.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Butchery
 * ──────────────────────────────────────────────────────────────────────── */

const butchery: IndustryPackageDescriptor = {
    key: "butchery",
    label: "Butchery / meat shop",
    summary:
        "Sells meat by the kilogram, records which animal and which cut it came from, and keeps the carcass and offal accounted for.",
    categoryId: "butchery",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "suppliers", "batches", "expiry", "pricing", "leads", "payroll", "notifications", "imports"],
    features: [
        {
            key: "weight_pricing",
            label: "Weight-based pricing",
            summary:
                "Price every cut by the kilogram, from the carcass weight down.",
            defaultEnabled: true,
        },
        {
            key: "cut_tracking",
            label: "Cut tracking",
            summary:
                "Know which cut of which animal a piece of meat came from.",
            defaultEnabled: true,
        },
        {
            key: "carcass_yield",
            label: "Carcass yield",
            summary:
                "See how much saleable meat an animal gave, and what the offal was worth.",
            defaultEnabled: true,
        },
        {
            key: "butchery_orders",
            label: "Whole-carcass orders",
            summary:
                "Take an order for a whole animal and split it into cuts against it.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "kg",
            options: [
                { value: "kg", label: "Kilograms" },
                { value: "pcs", label: "Pieces" },
            ],
        },
        {
            key: "priceByGrade",
            label: "Price by grade",
            type: "boolean",
            default: true,
            help:
                "On, each cut carries its own grade — prime, choice, economy — and its own price.",
        },
        {
            key: "carcassYieldTarget",
            label: "Target yield",
            type: "number",
            default: 60,
            help: "The percentage of the live weight expected to come off as saleable meat.",
        },
        {
            key: "recordOffalValue",
            label: "Record the value of offal",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "The yield figure compares the meat sold against the carcass weight entered. It does not know the animal's live weight, so it cannot tell you whether the animal was a good buy.",
        "A cut is linked to an animal by name. There is no traceability certificate and no batch code printed on the wrapping.",
        "Carcass orders split an animal into cuts against it, but the splitting is done by the operator rather than by a cutting plan.",
        "There is no cold-chain record and no temperature on a cut.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Bakery
 * ──────────────────────────────────────────────────────────────────────── */

const baker: IndustryPackageDescriptor = {
    key: "baker",
    label: "Bakery / confectionery",
    summary:
        "Bakes in batches, records the yield and the cost of a batch, and sells what came out of the oven before it goes stale.",
    categoryId: "baker",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "production", "batches", "expiry", "pricing", "leads", "payroll", "notifications", "imports"],
    features: [
        {
            key: "production_batches",
            label: "Production batches",
            summary:
                "Record each bake — how much went in, how much came out and what it cost.",
            defaultEnabled: true,
        },
        {
            key: "recipe_costing",
            label: "Recipe costing",
            summary:
                "Work out what a loaf or a cake cost to make, from the ingredients it used.",
            defaultEnabled: true,
        },
        {
            key: "same_day_baking",
            label: "Same-day baking",
            summary:
                "Sell the day's bake, and see what is left at closing.",
            defaultEnabled: true,
        },
        {
            key: "expiry_alerts",
            label: "Expiry alerts",
            summary:
                "See what is about to go stale, soonest first.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultShelfLifeDays",
            label: "Shelf life (days)",
            type: "number",
            default: 3,
            help: "How long a bake is good for when it leaves the oven.",
        },
        {
            key: "targetYieldPercent",
            label: "Target yield",
            type: "number",
            default: 95,
            help: "The percentage of the raw weight expected to come out as product.",
        },
        {
            key: "recordWaste",
            label: "Record waste",
            type: "boolean",
            default: true,
            help: "With this on, unsold product can be written off against a batch.",
        },
        {
            key: "batchPrefix",
            label: "Batch prefix",
            type: "string",
            default: "B",
            help: "Printed at the start of each batch number, e.g. B250326-A.",
        },
    ],
    limitations: [
        "A batch records what went into it and what came out. SMARTBUZ does not scale a recipe, so a double bake is two batches, not one batch at double size.",
        "Waste is written off against a batch by hand. There is no automatic write-off at closing and no reason analysis beyond the note.",
        "The shelf life is a setting, not a reading — nothing is logged from a probe or a thermometer.",
        "There is no production plan: SMARTBUZ does not say what to bake tomorrow, only what was baked.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Bookshop / stationery
 * ──────────────────────────────────────────────────────────────────────── */

const bookshop: IndustryPackageDescriptor = {
    key: "bookshop",
    label: "Bookshop / stationery",
    summary:
        "Sells books and stationery, tracks the publisher and the edition, and knows what a school has ordered from it.",
    categoryId: "bookshop",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "batches"],
    features: [
        {
            key: "publisher_catalogue",
            label: "Publisher catalogue",
            summary:
                "Record the publisher, the edition and the ISBN against a title.",
            defaultEnabled: true,
        },
        {
            key: "school_order_lists",
            label: "School order lists",
            summary:
                "Take a school's list for a term and fill it line by line.",
            defaultEnabled: false,
        },
        {
            key: "isbn_lookup",
            label: "ISBN lookup",
            summary:
                "Find a title by its ISBN, so the counter does not retype it.",
            defaultEnabled: true,
        },
        {
            key: "stationery_packs",
            label: "School packs",
            summary:
                "Sell a prepared starter pack as one line and break it down into its parts.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultMarkupPercent",
            label: "Default markup",
            type: "number",
            default: 25,
            help: "The margin a new title gets when it is created.",
        },
        {
            key: "allowBackOrder",
            label: "Allow back orders",
            type: "boolean",
            default: true,
            help: "On, a title that is out of stock can still be sold, to be supplied later.",
        },
        {
            key: "schoolTerms",
            label: "School terms",
            type: "string",
            default: "Term 1,Term 2,Term 3",
            help: "The terms the order lists are filed under.",
        },
        {
            key: "requireIsbn",
            label: "Require an ISBN",
            type: "boolean",
            default: false,
        },
    ],
    limitations: [
        "An ISBN is stored and looked up; SMARTBUZ does not reach out to a book database to fetch the title and price.",
        "A school order list is a list of lines. There is no purchase-order workflow to the school and no way to chase what has not arrived.",
        "A starter pack is one product; the parts it contains are not tracked as separate stock, so the pack cannot be broken down to restock what is missing.",
        "There is no publisher settlement or returns handling.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Stationery and office supplies
 * ──────────────────────────────────────────────────────────────────────── */

const stationery: IndustryPackageDescriptor = {
    key: "stationery",
    label: "Stationery & office supplies",
    summary:
        "Office and school supplies with corporate account pricing and monthly school-contract billing.",
    categoryId: "stationery",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "pricing", "payroll", "notifications", "imports"],
    features: [
        {
            key: "account_pricing",
            label: "Account pricing",
            summary:
                "A price of their own for a company or a school, which wins over the list price.",
            defaultEnabled: true,
        },
        {
            key: "contract_billing",
            label: "Contract billing",
            summary:
                "Charge what a contract says at the end of the month, not at the counter.",
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
            key: "recurring_supply",
            label: "Recurring supply",
            summary:
                "A standing order that raises the bill every month without anybody asking.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultCreditDays",
            label: "Account credit term (days)",
            type: "number",
            default: 30,
        },
        {
            key: "billingDay",
            label: "Contract billing day",
            type: "number",
            default: 1,
            help: "The day of the month the contract bills are raised.",
        },
        {
            key: "defaultContractMinimum",
            label: "Minimum contract value",
            type: "number",
            default: 0,
            help: "The smallest a contract bill may be. Zero means no minimum.",
        },
        {
            key: "taxInclusive",
            label: "Prices include tax",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A contract records what is owed and when; SMARTBUZ does not chase the customer and there is no dunning schedule.",
        "A standing order raises the bill on the day. It does not check the stock is there first.",
        "Account pricing is one price per product per account. There is no contract with a minimum spend that changes the price of one line.",
        "There is no purchase-order import from a customer's own system.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Printing and graphics
 * ──────────────────────────────────────────────────────────────────────── */

const printing: IndustryPackageDescriptor = {
    key: "printing",
    label: "Printing / graphics",
    summary:
        "Takes a job with its own dimensions, works out the cost of the paper, ink and time, and quotes the job before it is printed.",
    categoryId: "printing",
    modules: ["sales", "pos", "stock", "expenses", "banking", "reports", "customers", "loans", "production", "services", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "measurements"],
    features: [
        {
            key: "job_quoting",
            label: "Job quoting",
            summary:
                "Quote a job from its size, its quantity and the finish.",
            defaultEnabled: true,
        },
        {
            key: "material_tracking",
            label: "Material tracking",
            summary:
                "Track the paper and ink a job consumed, so the cost is real.",
            defaultEnabled: true,
        },
        {
            key: "production_queue",
            label: "Production queue",
            summary:
                "Keep the jobs in the order they will be printed, and mark each one done.",
            defaultEnabled: true,
        },
        {
            key: "artwork_versions",
            label: "Artwork versions",
            summary:
                "Keep each version of the artwork against the job.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultPaperUnit",
            label: "Default paper unit",
            type: "enum",
            default: "sheet",
            options: [
                { value: "sheet", label: "Sheets" },
                { value: "ream", label: "Reams" },
                { value: "roll", label: "Rolls" },
            ],
        },
        {
            key: "minimumCharge",
            label: "Minimum charge",
            type: "number",
            default: 0,
            help: "The smallest a job may be charged. Zero means no minimum.",
        },
        {
            key: "quoteValidDays",
            label: "A quote is good for (days)",
            type: "number",
            default: 14,
        },
        {
            key: "includeSetupTime",
            label: "Charge for setup time",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A quote is worked out from the operator's figures. SMARTBUZ does not read the artwork, measure the bleed or check the colour profile.",
        "The cost of a job uses the cost of the material from the stock record; ink, labour and machine time are entered by the operator as a cost line.",
        "There is no press schedule and no capacity planning — the queue is a list, not a plan.",
        "Artwork versions are recorded by name. SMARTBUZ does not store, preview or proof the file.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Shoes and fashion
 * ──────────────────────────────────────────────────────────────────────── */

const shoes: IndustryPackageDescriptor = {
    key: "shoes",
    label: "Shoe & fashion retail",
    summary:
        "Footwear and apparel with size and colour variants, season-based stock and layaway plans.",
    categoryId: "shoes",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "promotions", "suppliers", "pricing", "quotes", "leads", "plans", "payroll", "measurements", "notifications", "imports", "batches"],
    features: [
        {
            key: "variants",
            label: "Size and colour variants",
            summary:
                "One product, many sizes and colours, each with its own stock.",
            defaultEnabled: true,
        },
        {
            key: "season_stock",
            label: "Season-based stock",
            summary:
                "Mark stock by the season it belongs to and watch what is left of it.",
            defaultEnabled: true,
        },
        {
            key: "layaway",
            label: "Layaway plans",
            summary:
                "Hold a pair for a customer who wants to pay over time.",
            defaultEnabled: true,
        },
        {
            key: "alterations",
            label: "Alteration orders",
            summary:
                "Send a pair for alteration and keep the order against the customer.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "layawayDepositPercent",
            label: "Layaway deposit",
            type: "number",
            default: 40,
        },
        {
            key: "layawayMonths",
            label: "Layaway term (months)",
            type: "number",
            default: 2,
        },
        {
            key: "holdDays",
            label: "How long a layaway is held",
            type: "number",
            default: 60,
            help: "How long the item is kept before the plan is called in.",
        },
        {
            key: "seasons",
            label: "Seasons",
            type: "string",
            default: "SS,AW",
            help: "The season labels stock is filed under, separated by commas.",
        },
    ],
    limitations: [
        "A variant is a size and a colour with its own quantity. There is no shape or width variant, and no curve or length option on a made-to-measure shoe.",
        "A layaway plan holds one variant. There is no 'hold this for 48 hours without payment' reservation, so the item can still be sold at the counter.",
        "The season is a label on the stock. SMARTBUZ does not forecast which sizes will sell and does not place an order with the supplier.",
        "An alteration order is a service ticket with a due date. SMARTBUZ does not record the measurement taken for the alteration.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Cosmetics and beauty retail
 * ──────────────────────────────────────────────────────────────────────── */

const beauty: IndustryPackageDescriptor = {
    key: "beauty",
    label: "Cosmetics & beauty retail",
    summary:
        "Beauty product retail with shade and size variants, batch traceability and loyalty-driven promotions.",
    categoryId: "beauty",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "promotions", "suppliers", "pricing", "quotes", "leads", "payroll", "measurements", "notifications", "imports", "batches", "plans"],
    features: [
        {
            key: "shade_variants",
            label: "Shade and size variants",
            summary:
                "Each shade of a foundation is its own stock, with its own barcode.",
            defaultEnabled: true,
        },
        {
            key: "batch_traceability",
            label: "Batch traceability",
            summary:
                "Know which batch a product came from, so a complaint can be traced.",
            defaultEnabled: true,
        },
        {
            key: "loyalty_points",
            label: "Loyalty points",
            summary:
                "Award points on what a customer spends and let them spend them again.",
            defaultEnabled: true,
        },
        {
            key: "promotions",
            label: "Promotions",
            summary:
                "Run multi-buy and threshold promotions on products and on the whole basket.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultLoyaltyRate",
            label: "Loyalty points per unit spent",
            type: "number",
            default: 1,
        },
        {
            key: "requireBatchOnExpiry",
            label: "Require a batch on anything that expires",
            type: "boolean",
            default: true,
        },
        {
            key: "expiryWarningDays",
            label: "Warn this many days before expiry",
            type: "number",
            default: 90,
        },
        {
            key: "testerPolicy",
            label: "Tester stock",
            type: "enum",
            default: "separate",
            options: [
                { value: "separate", label: "Kept as separate stock" },
                { value: "ignored", label: "Not tracked" },
            ],
            help: "Whether a tester is a line of stock that has to be counted.",
        },
    ],
    limitations: [
        "A shade is a variant with its own quantity. There is no shade-match service and no shade finder.",
        "A batch is recorded for traceability. There is no ingredient list, no allergen flag and no patch-test record.",
        "Loyalty points are awarded and spent through the ledger. There is no tiered member level and no voucher printed at the till.",
        "There is no booking for a treatment and no commission split; a beauty counter that also does treatments needs the salon package as well.",
    ],
};

export const tradePackages: IndustryPackageDescriptor[] = [
    retail,
    agro,
    farming,
    dairy,
    butchery,
    baker,
    bookshop,
    stationery,
    printing,
    shoes,
    beauty,
];
