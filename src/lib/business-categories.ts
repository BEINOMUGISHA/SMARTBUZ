/**
 * SMART_BUZ — Business Category Catalog
 *
 * A single source of truth describing every business vertical SMART_BUZ
 * supports in the Ugandan market. Each category declares:
 *
 *   - `modules`   which functional areas are enabled (drives the sidebar)
 *   - `features`  unique capabilities that category gets (drives dashboard
 *                 widgets, extra screens, and specialised sale logic)
 *   - `tax`       URA VAT defaults (18% standard, exempt categories)
 *   - `units`     the unit of measure this trade sells in
 *   - `terminology` the words this trade uses ("Table" vs "Counter", etc.)
 *
 * The catalog is intentionally data-driven: a new vertical is added by
 * appending an entry here, not by branching UI code. The shell (sidebar,
 * dashboard, receipts, setup wizard) reads from this file.
 *
 * VAT note (URA, Uganda):
 *   Standard rate is 18%. VAT is charged on the value added and is
 *   *inclusive* in most Ugandan retail prices. Exempt/zero-rated goods
 *   (basic necessities, agricultural inputs, certain services) must be
 *   marked per-product so the receipt VAT split stays correct.
 */

export type CategoryId =
    | "retail"
    | "supermarket"
    | "wholesale"
    | "pharmacy"
    | "clinic"
    | "restaurant"
    | "cafe"
    | "barber"
    | "salon"
    | "hotel"
    | "hardware"
    | "agro"
    | "fuel"
    | "mobile"
    | "electronics"
    | "salvage"
    | "bookshop"
    | "stationery"
    | "printing"
    | "baker"
    | "butchery"
    | "dairy"
    | "farming"
    | "transport"
    | "tailor"
    | "carpentry"
    | "welding"
    | "laundry"
    | "salon_spa"
    | "fitness"
    | "education"
    | "church"
    | "ngo"
    | "sacco"
    | "realestate"
    | "construction"
    | "event"
    | "beauty"
    | "shoes"
    | "electronics_repair"
    | "photography"
    | "veterinary"
    | "security"
    | "cleaning"
    | "driving_school";

/** Functional areas a category can switch on. */
export type ModuleId =
    | "dashboard"
    | "sales"
    | "pos"
    | "stock"
    | "inventory"
    | "shops"
    | "expenses"
    | "reports"
    | "customers"
    | "loans"
    | "promotions"
    | "suppliers"
    | "purchaseOrders"
    | "appointments"
    | "tables"
    | "rooms"
    | "menu"
    | "prescriptions"
    | "batches"
    | "expiry"
    | "bookings"
    | "classes"
    | "members"
    | "deliveries"
    | "rentals"
    | "services"
    | "production"
    | "fuelPump"
    | "assets"
    | "maintenance"
    | "attendance"
    | "receivables"
    | "grn"
    | "finance"
    | "businessIntelligence"
    | "systemconfig";

/** Unique capabilities that unlock specialised behaviour. */
export type FeatureId =
    | "batchTracking"
    | "expiryAlerts"
    | "prescriptions"
    | "controlledDrugs"
    | "tableOrders"
    | "kitchenDisplay"
    | "roomBooking"
    | "appointmentBooking"
    | "stylistCommission"
    | "fuelDispensing"
    | "unitConversion"
    | "tieredPricing"
    | "classEnrolment"
    | "memberAccounts"
    | "roomNights"
    | "serviceTickets"
    | "productionBatches"
    | "weightBased"
    | "perishable"
    | "layaway"
    | "vehicleRegistrations"
    | "serialNumbers"
    | "rentalHire"
    | "assetRegister"
    | "donations"
    | "studentFees"
    | "attendance"
    | "hirePurchase"
    | "customMeasurements"
    | "gridSizes"
    | "routeFares"
    | "recurringServices";

export interface CategoryTax {
    /** Whether VAT applies at all for this vertical. */
    enabled: boolean;
    /** URA standard VAT rate. */
    rate: number;
    /** True when shelf prices already include VAT (normal in Ugandan retail). */
    inclusive: boolean;
    /** Legal tax note printed on receipts. */
    note: string;
}

export interface CategoryUnits {
    /** Default unit a product is measured in. */
    default: string;
    /** Other units this trade commonly uses. */
    alternatives: string[];
    /** True when quantity may be fractional (kg, litres, metres). */
    allowFractional: boolean;
}

export interface CategoryTerminology {
    /** What a sellable item is called, e.g. "Product", "Dish", "Medicine". */
    item: string;
    /** What the shop is called, e.g. "Branch", "Table", "Room". */
    outlet: string;
    /** What the salesperson is called. */
    staff: string;
    /** What a customer is called. */
    customer: string;
}

export interface BusinessCategory {
    id: CategoryId;
    /** Display name. */
    name: string;
    /** Short description used in the setup wizard and marketplace grid. */
    description: string;
    /** Lucide icon name (without the `Lucide` prefix) for the UI. */
    icon: string;
    /** Tailwind-friendly accent colour token used for theming. */
    accent: string;
    /** Modules enabled for this vertical — drives the sidebar. */
    modules: ModuleId[];
    /** Unique capabilities enabled — drives specialised screens. */
    features: FeatureId[];
    /** VAT configuration for this vertical. */
    tax: CategoryTax;
    /** Units of measure used by this trade. */
    units: CategoryUnits;
    /** Domain vocabulary, so the UI speaks the trade's language. */
    terminology: CategoryTerminology;
    /** Sample products seeded when this category is chosen. */
    sampleProducts: Array<{
        name: string;
        category: string;
        price: number;
        purchasePrice: number;
        pv?: number;
        bv?: number;
        unit?: string;
    }>;
    /** True when a customer can walk in and be served immediately. */
    walkIn: boolean;
    /** True when the vertical needs appointments or bookings to operate. */
    scheduled: boolean;
}

/** Standard Ugandan VAT configuration (18%, inclusive). */
const STANDARD_TAX: CategoryTax = {
    enabled: true,
    rate: 18,
    inclusive: true,
    note: "VAT inclusive @ 18% — Price shown includes VAT",
};

/** VAT-exempt vertical (e.g. most agricultural primary sales). */
const EXEMPT_TAX: CategoryTax = {
    enabled: false,
    rate: 0,
    inclusive: false,
    note: "VAT exempt",
};

/** URA exempt-goods note (zero-rated agricultural and basic necessities). */
const ZERO_RATED_TAX: CategoryTax = {
    enabled: true,
    rate: 0,
    inclusive: true,
    note: "VAT zero-rated (exempt goods) @ 0%",
};

const RETAIL_UNITS: CategoryUnits = {
    default: "pcs",
    alternatives: ["pcs", "pack", "box", "dozen", "kg", "litre"],
    allowFractional: false,
};

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
    /* ───────────────────────── Retail & Trade ───────────────────────── */
    {
        id: "retail",
        name: "General Retail / Mini-Market",
        description:
            "Counter sales for everyday goods. Barcode-friendly, fast checkout, low-stock alerts and daily takings reconciliation.",
        icon: "Store",
        accent: "emerald",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "promotions", "suppliers", "systemconfig"],
        features: ["batchTracking", "expiryAlerts", "perishable", "layaway", "tieredPricing"],
        tax: STANDARD_TAX,
        units: RETAIL_UNITS,
        terminology: { item: "Product", outlet: "Branch", staff: "Cashier", customer: "Customer" },
        sampleProducts: [
            { name: "Colgate Toothpaste 100ml", category: "Personal Care", price: 8000, purchasePrice: 5500 },
            { name: "Rwenzori Water 500ml", category: "Beverages", price: 1500, purchasePrice: 900 },
            { name: "Blue Band 250g", category: "Groceries", price: 9500, purchasePrice: 7000 },
            { name: "Airtel Airtime (UGX 1000)", category: "Airtime", price: 1000, purchasePrice: 1000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "supermarket",
        name: "Supermarket",
        description:
            "Large-format retail with multiple tills, expiry management, supplier credit and department-level reporting.",
        icon: "ShoppingBasket",
        accent: "teal",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "batches", "expiry", "deliveries", "systemconfig"],
        features: ["batchTracking", "expiryAlerts", "perishable", "tieredPricing", "unitConversion", "hirePurchase"],
        tax: STANDARD_TAX,
        units: RETAIL_UNITS,
        terminology: { item: "Product", outlet: "Branch", staff: "Cashier", customer: "Shopper" },
        sampleProducts: [
            { name: "Mukwano Cooking Oil 5L", category: "Grocery", price: 145000, purchasePrice: 128000 },
            { name: "Nokidezi Sugar 1kg", category: "Grocery", price: 7000, purchasePrice: 6000 },
            { name: "Fresh Milk 1L", category: "Dairy", price: 3500, purchasePrice: 2800 },
            { name: "Kim-Fay Cigarettes (Packet)", category: "Tobacco", price: 20000, purchasePrice: 19500 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "wholesale",
        name: "Wholesale / Distributor",
        description:
            "Bulk selling to retailers on credit. Van delivery runs, credit limits per customer, tiered pricing by volume and container pricing.",
        icon: "Truck",
        accent: "indigo",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "systemconfig"],
        features: ["tieredPricing", "unitConversion", "hirePurchase", "vehicleRegistrations"],
        tax: STANDARD_TAX,
        units: { default: "carton", alternatives: ["carton", "piece", "bag", "crate", "kg"], allowFractional: false },
        terminology: { item: "Product", outlet: "Route", staff: "Sales Agent", customer: "Distributor" },
        sampleProducts: [
            { name: "Colgate Toothpaste 100ml (Carton of 48)", category: "Personal Care", price: 340000, purchasePrice: 300000 },
            { name: "Rwenzori Water 500ml (Carton of 24)", category: "Beverages", price: 32000, purchasePrice: 26000 },
            { name: "Nokidezi Sugar 1kg (Bag of 50kg)", category: "Grocery", price: 330000, purchasePrice: 295000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "agro",
        name: "Agriculture / Agro-Inputs",
        description:
            "Fertiliser, seed and crop-protection stock. Unit conversion between sacks, kilos and crates, seasonal demand, and agro-dealer credit.",
        icon: "Sprout",
        accent: "lime",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "systemconfig"],
        features: ["unitConversion", "tieredPricing", "hirePurchase", "weightBased"],
        tax: ZERO_RATED_TAX,
        units: { default: "kg", alternatives: ["kg", "sack", "crate", "litre", "packet", "tonne"], allowFractional: true },
        terminology: { item: "Input", outlet: "Outlet", staff: "Agro Dealer", customer: "Farmer" },
        sampleProducts: [
            { name: "DAP Fertiliser 50kg", category: "Fertiliser", price: 110000, purchasePrice: 96000, unit: "sack" },
            { name: "Maize Seed (KERNEL) 10kg", category: "Seed", price: 85000, purchasePrice: 72000, unit: "packet" },
            { name: "Roundup Herbicide 1L", category: "Crop Protection", price: 45000, purchasePrice: 38000, unit: "litre" },
            { name: "Urea Fertiliser 50kg", category: "Fertiliser", price: 98000, purchasePrice: 85000, unit: "sack" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "farming",
        name: "Farm Produce / Aggregator",
        description:
            "Buying and selling farm produce at collection points. Weight-based pricing, grade pricing, and buyer settlements per consignment.",
        icon: "Wheat",
        accent: "amber",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "suppliers", "production", "receivables", "systemconfig"],
        features: ["weightBased", "perishable", "unitConversion", "tieredPricing"],
        tax: ZERO_RATED_TAX,
        units: { default: "kg", alternatives: ["kg", "tonne", "crate", "sack", "bunch"], allowFractional: true },
        terminology: { item: "Produce", outlet: "Collection Point", staff: "Aggregator", customer: "Farmer" },
        sampleProducts: [
            { name: "Maize Grain (Grade 1)", category: "Cereals", price: 3200, purchasePrice: 2900, unit: "kg" },
            { name: "Coffee Cherry (Dry)", category: "Coffee", price: 12000, purchasePrice: 10500, unit: "kg" },
            { name: "Millet Grain", category: "Cereals", price: 4500, purchasePrice: 3900, unit: "kg" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "dairy",
        name: "Dairy / Milk Collection",
        description:
            "Milk collection and dairy retail. Volume-based daily collections, chilling cost tracking, and spoilage control on perishables.",
        icon: "Milk",
        accent: "sky",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "suppliers", "production", "systemconfig"],
        features: ["weightBased", "perishable", "unitConversion", "batchTracking"],
        tax: ZERO_RATED_TAX,
        units: { default: "litre", alternatives: ["litre", "kg", "crate"], allowFractional: true },
        terminology: { item: "Product", outlet: "Collection Centre", staff: "Collector", customer: "Farmer" },
        sampleProducts: [
            { name: "Fresh Cow Milk", category: "Milk", price: 1200, purchasePrice: 950, unit: "litre" },
            { name: "Yoghurt 500g", category: "Value Added", price: 4000, purchasePrice: 3000 },
            { name: "Cheese Block 1kg", category: "Value Added", price: 18000, purchasePrice: 14000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "butchery",
        name: "Butchery / Meat Shop",
        description:
            "Meat retail and wholesale cuts. Batching for freshness, per-day spoilage write-off, and cut-weight pricing per kilogram.",
        icon: "Drumstick",
        accent: "red",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "suppliers", "batches", "expiry", "systemconfig"],
        features: ["batchTracking", "perishable", "weightBased", "expiryAlerts"],
        tax: STANDARD_TAX,
        units: { default: "kg", alternatives: ["kg", "piece", "quarter"], allowFractional: true },
        terminology: { item: "Cut", outlet: "Butchery", staff: "Butcher", customer: "Customer" },
        sampleProducts: [
            { name: "Beef Cuts (per kg)", category: "Beef", price: 14000, purchasePrice: 11000, unit: "kg" },
            { name: "Chicken (Dressed, per kg)", category: "Poultry", price: 9000, purchasePrice: 7200, unit: "kg" },
            { name: "Pork Ribs (per kg)", category: "Pork", price: 12000, purchasePrice: 9500, unit: "kg" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "baker",
        name: "Bakery / Confectionery",
        description:
            "Baked goods production and retail. Daily production batches, shelf-life tracking, and end-of-day unsold write-down.",
        icon: "Croissant",
        accent: "orange",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "production", "batches", "expiry", "systemconfig"],
        features: ["productionBatches", "batchTracking", "expiryAlerts", "perishable"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "dozen", "tray", "kg"], allowFractional: false },
        terminology: { item: "Product", outlet: "Bakery", staff: "Baker", customer: "Customer" },
        sampleProducts: [
            { name: "Chapati (per piece)", category: "Bread", price: 1500, purchasePrice: 900 },
            { name: "Cake Slices (per piece)", category: "Cake", price: 5000, purchasePrice: 3000 },
            { name: "Mandazi (per piece)", category: "Snacks", price: 1000, purchasePrice: 600 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "bookshop",
        name: "Bookshop / Stationery",
        description:
            "Books and school supplies. Title-level stock, exam-season demand spikes, and school bulk orders on credit.",
        icon: "BookOpen",
        accent: "violet",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "systemconfig"],
        features: ["tieredPricing", "serialNumbers"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "Zero-rated educational materials @ 0%" },
        units: { default: "pcs", alternatives: ["pcs", "pack", "set"], allowFractional: false },
        terminology: { item: "Title", outlet: "Branch", staff: "Bookseller", customer: "Customer" },
        sampleProducts: [
            { name: "Primary 4 Learner's Book", category: "Textbooks", price: 28000, purchasePrice: 22000 },
            { name: "Exercise Book (40 pages)", category: "Stationery", price: 3500, purchasePrice: 2500 },
            { name: "Bic Pen (per piece)", category: "Stationery", price: 1000, purchasePrice: 600 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "printing",
        name: "Printing / Graphics",
        description:
            "Print shop and graphics work. Job-order tracking, per-job pricing, and balance collection on large orders.",
        icon: "Printer",
        accent: "slate",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "loans", "production", "services", "systemconfig"],
        features: ["serviceTickets", "customMeasurements"],
        tax: STANDARD_TAX,
        units: { default: "job", alternatives: ["job", "page", "piece", "set"], allowFractional: false },
        terminology: { item: "Job", outlet: "Branch", staff: "Operator", customer: "Customer" },
        sampleProducts: [
            { name: "Business Card Printing (100 pcs)", category: "Cards", price: 35000, purchasePrice: 12000 },
            { name: "Banner Printing (per sqm)", category: "Banners", price: 15000, purchasePrice: 6000 },
            { name: "Photocopy (per page)", category: "Copying", price: 200, purchasePrice: 50 },
            { name: "T-Shirt Printing (per shirt)", category: "Apparel", price: 15000, purchasePrice: 5000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "stationery",
        name: "Stationery & Office Supplies",
        description: "Office and school supplies with corporate account pricing and monthly school-contract billing.",
        icon: "Pencil",
        accent: "cyan",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "systemconfig"],
        features: ["tieredPricing", "unitConversion"],
        tax: STANDARD_TAX,
        units: RETAIL_UNITS,
        terminology: { item: "Item", outlet: "Branch", staff: "Sales Agent", customer: "Customer" },
        sampleProducts: [
            { name: "A4 Paper Ream (500 sheets)", category: "Paper", price: 32000, purchasePrice: 26000 },
            { name: "HP Toner Cartridge", category: "Printing", price: 185000, purchasePrice: 150000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "shoes",
        name: "Shoe & Fashion Retail",
        description: "Footwear and apparel retail with size/colour variants, season-based stock and layaway plans.",
        icon: "Footprints",
        accent: "pink",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "promotions", "suppliers", "systemconfig"],
        features: ["serialNumbers", "layaway", "tieredPricing"],
        tax: STANDARD_TAX,
        units: { default: "pair", alternatives: ["pair", "pcs", "set", "dozen"], allowFractional: false },
        terminology: { item: "Item", outlet: "Branch", staff: "Sales Agent", customer: "Customer" },
        sampleProducts: [
            { name: "Mens Leather Shoes (Size 42)", category: "Shoes", price: 145000, purchasePrice: 105000 },
            { name: "Ladies Sandals", category: "Shoes", price: 55000, purchasePrice: 38000 },
            { name: "Kids Sneakers", category: "Shoes", price: 45000, purchasePrice: 32000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "beauty",
        name: "Cosmetics & Beauty Retail",
        description: "Beauty product retail with shade/size variants, batch traceability and loyalty-driven promotions.",
        icon: "Sparkles",
        accent: "fuchsia",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "promotions", "suppliers", "systemconfig"],
        features: ["batchTracking", "serialNumbers", "layaway"],
        tax: STANDARD_TAX,
        units: RETAIL_UNITS,
        terminology: { item: "Product", outlet: "Branch", staff: "Beauty Advisor", customer: "Client" },
        sampleProducts: [
            { name: "Foundation 30ml", category: "Makeup", price: 45000, purchasePrice: 32000 },
            { name: "Shea Butter Lotion 300ml", category: "Skincare", price: 28000, purchasePrice: 19000 },
        ],
        walkIn: true,
        scheduled: false,
    },

    /* ───────────────────────── Food & Beverage ───────────────────────── */
    {
        id: "restaurant",
        name: "Restaurant / Food Service",
        description:
            "Table service with kitchen display. Order-to-table, split bills, waiter tips and kitchen ticket timing.",
        icon: "UtensilsCrossed",
        accent: "orange",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "tables", "menu", "services", "suppliers", "systemconfig"],
        features: ["tableOrders", "kitchenDisplay", "productionBatches", "perishable"],
        tax: STANDARD_TAX,
        units: { default: "serving", alternatives: ["serving", "plate", "piece", "litre", "kg"], allowFractional: false },
        terminology: { item: "Dish", outlet: "Table", staff: "Waiter", customer: "Guest" },
        sampleProducts: [
            { name: "Chicken Luwombo (1/2)", category: "Main", price: 22000, purchasePrice: 11000 },
            { name: "Rolex (Chapati + Egg)", category: "Snacks", price: 7000, purchasePrice: 3000 },
            { name: "Fresh Juice (Glass)", category: "Drinks", price: 4000, purchasePrice: 2000 },
            { name: "Special Chicken (Whole)", category: "Main", price: 42000, purchasePrice: 21000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "cafe",
        name: "Café / Coffee Shop",
        description: "Café with a focused drinks menu, table management, and daily consumable usage tracking.",
        icon: "Coffee",
        accent: "stone",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "tables", "menu", "services", "systemconfig"],
        features: ["tableOrders", "kitchenDisplay", "productionBatches"],
        tax: STANDARD_TAX,
        units: { default: "cup", alternatives: ["cup", "serving", "litre"], allowFractional: false },
        terminology: { item: "Drink", outlet: "Table", staff: "Barista", customer: "Guest" },
        sampleProducts: [
            { name: "Americano", category: "Coffee", price: 8000, purchasePrice: 3000 },
            { name: "Latte", category: "Coffee", price: 12000, purchasePrice: 4500 },
            { name: "Blueberry Muffin", category: "Bakery", price: 7000, purchasePrice: 3500 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "hotel",
        name: "Hotel / Guest House",
        description:
            "Accommodation management. Room availability, night stays, booking confirmations, room-service charges and city levy.",
        icon: "BedDouble",
        accent: "blue",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "rooms", "bookings", "services", "systemconfig"],
        features: ["roomBooking", "roomNights", "serviceTickets"],
        tax: STANDARD_TAX,
        units: { default: "night", alternatives: ["night", "room", "person"], allowFractional: false },
        terminology: { item: "Service", outlet: "Room", staff: "Receptionist", customer: "Guest" },
        sampleProducts: [
            { name: "Standard Room (per night)", category: "Accommodation", price: 80000, purchasePrice: 0 },
            { name: "Executive Room (per night)", category: "Accommodation", price: 150000, purchasePrice: 0 },
            { name: "Room Service Meal", category: "F&B", price: 25000, purchasePrice: 12000 },
            { name: "Laundry Service (per kg)", category: "Laundry", price: 8000, purchasePrice: 3000, unit: "kg" },
        ],
        walkIn: false,
        scheduled: true,
    },

    /* ───────────────────────── Health ───────────────────────── */
    {
        id: "pharmacy",
        name: "Pharmacy / Drugstore",
        description:
            "Pharmacy dispensing with expiry control, controlled-drug tracking, batch traceability and prescription capture.",
        icon: "Pill",
        accent: "rose",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "suppliers", "purchaseOrders", "batches", "expiry", "prescriptions", "systemconfig"],
        features: ["batchTracking", "expiryAlerts", "prescriptions", "controlledDrugs"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "strip", "box", "bottle"], allowFractional: false },
        terminology: { item: "Medicine", outlet: "Branch", staff: "Pharmacist", customer: "Patient" },
        sampleProducts: [
            { name: "Panadol 500mg (Strip of 20)", category: "Analgesic", price: 4000, purchasePrice: 2800 },
            { name: "Amoxil 500mg (Box of 21)", category: "Antibiotic", price: 25000, purchasePrice: 19000 },
            { name: "ORS Sachet", category: "Rehydration", price: 1000, purchasePrice: 600 },
            { name: "Vitamin C 100mg (Bottle of 100)", category: "Supplements", price: 18000, purchasePrice: 12000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "clinic",
        name: "Clinic / Health Centre",
        description:
            "Patient-centred clinic. Patient records, appointments, consultation billing, lab charges and controlled prescriptions.",
        icon: "Stethoscope",
        accent: "teal",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "appointments", "prescriptions", "services", "systemconfig"],
        features: ["appointmentBooking", "prescriptions", "controlledDrugs", "serviceTickets", "batchTracking", "expiryAlerts"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — healthcare services (URA)" },
        units: { default: "service", alternatives: ["service", "session", "pcs"], allowFractional: false },
        terminology: { item: "Service", outlet: "Branch", staff: "Practitioner", customer: "Patient" },
        sampleProducts: [
            { name: "General Consultation", category: "Consultation", price: 30000, purchasePrice: 0 },
            { name: "Malaria Test (RDT)", category: "Laboratory", price: 15000, purchasePrice: 8000 },
            { name: "Blood Pressure Check", category: "Vital Signs", price: 10000, purchasePrice: 0 },
            { name: "Dressing (Small)", category: "Procedure", price: 25000, purchasePrice: 5000 },
        ],
        walkIn: true,
        scheduled: true,
    },
    {
        id: "veterinary",
        name: "Veterinary / Agro-Clinic",
        description: "Livestock veterinary services with herd records, vaccination campaigns and feed supply.",
        icon: "Stethoscope",
        accent: "green",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "appointments", "services", "systemconfig"],
        features: ["appointmentBooking", "serviceTickets", "unitConversion"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — veterinary services (URA)" },
        units: { default: "service", alternatives: ["service", "dose", "kg", "head"], allowFractional: false },
        terminology: { item: "Service", outlet: "Branch", staff: "Vet", customer: "Farmer" },
        sampleProducts: [
            { name: "Cattle Deworming (per head)", category: "Treatment", price: 25000, purchasePrice: 8000 },
            { name: "Poultry Vaccination (per bird)", category: "Vaccination", price: 1000, purchasePrice: 400 },
            { name: "Broiler Grower Feed 50kg", category: "Feed", price: 95000, purchasePrice: 82000 },
        ],
        walkIn: true,
        scheduled: true,
    },

    /* ───────────────────────── Services ───────────────────────── */
    {
        id: "barber",
        name: "Barbershop",
        description: "Barber shop with chair-based service, stylist commission tracking, waiting list and daily service reconciliation.",
        icon: "Scissors",
        accent: "zinc",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "appointments", "services", "systemconfig"],
        features: ["appointmentBooking", "stylistCommission", "serviceTickets"],
        tax: STANDARD_TAX,
        units: { default: "service", alternatives: ["service", "session"], allowFractional: false },
        terminology: { item: "Service", outlet: "Chair", staff: "Barber", customer: "Client" },
        sampleProducts: [
            { name: "Haircut (Men)", category: "Hair", price: 15000, purchasePrice: 0 },
            { name: "Shave & Beard Trim", category: "Hair", price: 10000, purchasePrice: 0 },
            { name: "Haircut (Children)", category: "Hair", price: 12000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: true,
    },
    {
        id: "salon",
        name: "Hair Salon",
        description: "Full salon with braiding, weaving and treatment services, stylist commission and package deals.",
        icon: "Sparkle",
        accent: "purple",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "appointments", "services", "promotions", "systemconfig"],
        features: ["appointmentBooking", "stylistCommission", "serviceTickets", "layaway"],
        tax: STANDARD_TAX,
        units: { default: "service", alternatives: ["service", "session", "set"], allowFractional: false },
        terminology: { item: "Service", outlet: "Chair", staff: "Stylist", customer: "Client" },
        sampleProducts: [
            { name: "Simple Braids (Shoulder)", category: "Braids", price: 60000, purchasePrice: 0 },
            { name: "Wig Installation", category: "Weaves", price: 120000, purchasePrice: 0 },
            { name: "Hair Treatment (Treatment)", category: "Treatments", price: 80000, purchasePrice: 25000 },
        ],
        walkIn: true,
        scheduled: true,
    },
    {
        id: "salon_spa",
        name: "Beauty Spa & Wellness",
        description: "Spa and wellness studio with treatment rooms, package memberships, therapist commission and product retail.",
        icon: "Flower2",
        accent: "emerald",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "appointments", "services", "promotions", "systemconfig"],
        features: ["appointmentBooking", "stylistCommission", "serviceTickets", "layaway"],
        tax: STANDARD_TAX,
        units: { default: "session", alternatives: ["session", "service", "set"], allowFractional: false },
        terminology: { item: "Treatment", outlet: "Room", staff: "Therapist", customer: "Guest" },
        sampleProducts: [
            { name: "Deep Tissue Massage (60 min)", category: "Massage", price: 120000, purchasePrice: 0 },
            { name: "Facial Treatment", category: "Facial", price: 90000, purchasePrice: 15000 },
            { name: "Body Scrub", category: "Body", price: 150000, purchasePrice: 25000 },
        ],
        walkIn: true,
        scheduled: true,
    },
    {
        id: "fitness",
        name: "Gym & Fitness Centre",
        description: "Membership-driven gym with subscriptions, attendance tracking, lockers and personal-training packages.",
        icon: "Dumbbell",
        accent: "lime",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "members", "attendance", "services", "systemconfig"],
        features: ["memberAccounts", "attendance", "appointmentBooking", "serviceTickets"],
        tax: STANDARD_TAX,
        units: { default: "session", alternatives: ["session", "month", "visit"], allowFractional: false },
        terminology: { item: "Service", outlet: "Branch", staff: "Trainer", customer: "Member" },
        sampleProducts: [
            { name: "Monthly Membership", category: "Membership", price: 80000, purchasePrice: 0 },
            { name: "Personal Training (per session)", category: "Training", price: 50000, purchasePrice: 0 },
            { name: "Day Pass", category: "Membership", price: 15000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "laundry",
        name: "Laundry & Dry Cleaning",
        description: "Laundry with per-kilogram pricing, garment-level ticket tracking, turnaround SLA and collection delivery.",
        icon: "Shirt",
        accent: "cyan",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "services", "deliveries", "systemconfig"],
        features: ["serviceTickets", "weightBased", "unitConversion"],
        tax: STANDARD_TAX,
        units: { default: "kg", alternatives: ["kg", "piece", "load"], allowFractional: true },
        terminology: { item: "Service", outlet: "Branch", staff: "Attendant", customer: "Customer" },
        sampleProducts: [
            { name: "Wash & Fold (per kg)", category: "Laundry", price: 5000, purchasePrice: 2000, unit: "kg" },
            { name: "Suit Dry Clean (per piece)", category: "Dry Clean", price: 25000, purchasePrice: 8000 },
            { name: "Sneaker Cleaning (per pair)", category: "Special", price: 30000, purchasePrice: 10000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "tailor",
        name: "Tailoring & Fashion Design",
        description: "Bespoke tailoring with customer measurements, fabric stock, work-in-progress orders and delivery deadlines.",
        icon: "Scissors",
        accent: "fuchsia",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "services", "production", "deliveries", "systemconfig"],
        features: ["customMeasurements", "serviceTickets", "productionBatches"],
        tax: STANDARD_TAX,
        units: { default: "piece", alternatives: ["piece", "metre", "set"], allowFractional: false },
        terminology: { item: "Order", outlet: "Workshop", staff: "Tailor", customer: "Client" },
        sampleProducts: [
            { name: "Ladies Gown (per piece)", category: "Womenswear", price: 120000, purchasePrice: 0 },
            { name: "Mens Suit (per piece)", category: "Menswear", price: 250000, purchasePrice: 0 },
            { name: "Fabric (per metre)", category: "Fabric", price: 18000, purchasePrice: 12000, unit: "metre" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "carpentry",
        name: "Carpentry & Furniture",
        description: "Furniture making and repair with timber stock, work orders, custom dimensions and installation.",
        icon: "Hammer",
        accent: "amber",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "services", "production", "deliveries", "systemconfig"],
        features: ["customMeasurements", "productionBatches", "serviceTickets", "unitConversion"],
        tax: STANDARD_TAX,
        units: { default: "piece", alternatives: ["piece", "metre", "board", "sqm"], allowFractional: true },
        terminology: { item: "Item", outlet: "Workshop", staff: "Carpenter", customer: "Customer" },
        sampleProducts: [
            { name: "Office Desk (per piece)", category: "Furniture", price: 450000, purchasePrice: 0 },
            { name: "Hardwood Timber (per metre)", category: "Timber", price: 25000, purchasePrice: 18000, unit: "metre" },
            { name: "Door Repair (per job)", category: "Repair", price: 60000, purchasePrice: 15000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "welding",
        name: "Welding & Metal Fabrication",
        description: "Metal fabrication with job orders, metal stock by weight, custom dimensions and site installation.",
        icon: "Wrench",
        accent: "zinc",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "services", "production", "deliveries", "systemconfig"],
        features: ["customMeasurements", "productionBatches", "weightBased", "unitConversion"],
        tax: STANDARD_TAX,
        units: { default: "kg", alternatives: ["kg", "piece", "metre", "sheet"], allowFractional: true },
        terminology: { item: "Job", outlet: "Workshop", staff: "Welder", customer: "Customer" },
        sampleProducts: [
            { name: "Gate Fabrication (per sqm)", category: "Gates", price: 180000, purchasePrice: 90000, unit: "sqm" },
            { name: "Metal Sheet (per sheet)", category: "Materials", price: 75000, purchasePrice: 60000 },
            { name: "Window Grill (per sqm)", category: "Windows", price: 90000, purchasePrice: 45000, unit: "sqm" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "construction",
        name: "Construction & Hardware",
        description: "Hardware and building materials with site delivery, contractor credit, cement/steel unit handling and project costing.",
        icon: "HardHat",
        accent: "orange",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "assets", "systemconfig"],
        features: ["unitConversion", "tieredPricing", "hirePurchase", "rentalHire"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "bag", "tonne", "sqm", "metre", "litre", "box"], allowFractional: true },
        terminology: { item: "Material", outlet: "Branch", staff: "Sales Agent", customer: "Contractor" },
        sampleProducts: [
            { name: "Cement (Bag 50kg)", category: "Cement", price: 13500, purchasePrice: 11500, unit: "bag" },
            { name: "Ordinary Portland Cement 50kg", category: "Cement", price: 13500, purchasePrice: 11500 },
            { name: "Iron Bars 12mm (per length)", category: "Steel", price: 45000, purchasePrice: 38000 },
            { name: "Roofing Sheets (per sheet)", category: "Roofing", price: 55000, purchasePrice: 45000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "hardware",
        name: "Hardware & Tools",
        description: "Hardware and tool retail with unit conversion, hire of power tools, and contractor accounts.",
        icon: "Hammer",
        accent: "slate",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "suppliers", "purchaseOrders", "rentals", "deliveries", "systemconfig"],
        features: ["rentalHire", "unitConversion", "tieredPricing"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "box", "pack", "kg", "litre", "metre"], allowFractional: true },
        terminology: { item: "Item", outlet: "Branch", staff: "Sales Agent", customer: "Customer" },
        sampleProducts: [
            { name: "Claw Hammer", category: "Tools", price: 25000, purchasePrice: 16000 },
            { name: "Nails 4\" (per kg)", category: "Fixings", price: 12000, purchasePrice: 9000, unit: "kg" },
            { name: "Paint 5L (Emulsion)", category: "Paint", price: 180000, purchasePrice: 145000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "cleaning",
        name: "Cleaning Services",
        description: "Cleaning and fumigation contracts with recurring schedules, per-visit billing and staff assignment.",
        icon: "Sparkle",
        accent: "sky",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "appointments", "services", "deliveries", "systemconfig"],
        features: ["appointmentBooking", "serviceTickets", "recurringServices"],
        tax: STANDARD_TAX,
        units: { default: "visit", alternatives: ["visit", "session", "sqm", "hour"], allowFractional: false },
        terminology: { item: "Service", outlet: "Branch", staff: "Operator", customer: "Client" },
        sampleProducts: [
            { name: "House Cleaning (per visit)", category: "Cleaning", price: 60000, purchasePrice: 20000 },
            { name: "Office Deep Clean", category: "Cleaning", price: 250000, purchasePrice: 90000 },
            { name: "Fumigation (per room)", category: "Fumigation", price: 35000, purchasePrice: 12000 },
        ],
        walkIn: false,
        scheduled: true,
    },
    {
        id: "photography",
        name: "Photography & Studio",
        description: "Photo studio with session booking, package sales, prints upsell and shoot scheduling.",
        icon: "Camera",
        accent: "indigo",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "bookings", "services", "production", "systemconfig"],
        features: ["appointmentBooking", "serviceTickets", "productionBatches"],
        tax: STANDARD_TAX,
        units: { default: "session", alternatives: ["session", "print", "photo"], allowFractional: false },
        terminology: { item: "Service", outlet: "Studio", staff: "Photographer", customer: "Client" },
        sampleProducts: [
            { name: "Studio Portrait Session", category: "Sessions", price: 150000, purchasePrice: 0 },
            { name: "Photo Print (per copy)", category: "Prints", price: 5000, purchasePrice: 1500 },
            { name: "Wedding Photography (per day)", category: "Events", price: 1500000, purchasePrice: 0 },
        ],
        walkIn: false,
        scheduled: true,
    },
    {
        id: "event",
        name: "Events & Catering",
        description: "Event management and catering with per-guest pricing, deposits, venue hire and event scheduling.",
        icon: "PartyPopper",
        accent: "pink",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "loans", "bookings", "services", "deliveries", "systemconfig"],
        features: ["appointmentBooking", "serviceTickets", "unitConversion", "customMeasurements"],
        tax: STANDARD_TAX,
        units: { default: "guest", alternatives: ["guest", "plate", "table", "event"], allowFractional: false },
        terminology: { item: "Service", outlet: "Event", staff: "Coordinator", customer: "Client" },
        sampleProducts: [
            { name: "Wedding Catering (per guest)", category: "Catering", price: 45000, purchasePrice: 22000 },
            { name: "Venue Hire (per day)", category: "Venue", price: 500000, purchasePrice: 0 },
            { name: "Sound System (per event)", category: "Equipment", price: 350000, purchasePrice: 120000 },
        ],
        walkIn: false,
        scheduled: true,
    },

    /* ───────────────────────── Trade & Services ───────────────────────── */
    {
        id: "mobile",
        name: "Mobile Phone Shop",
        description: "Phone and accessory retailer with IMEI/serial tracking, device warranty register, trade-ins and carrier bundles.",
        icon: "Smartphone",
        accent: "blue",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "services", "systemconfig"],
        features: ["serialNumbers", "layaway", "tieredPricing", "hirePurchase"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "box", "set", "pack"], allowFractional: false },
        terminology: { item: "Device", outlet: "Branch", staff: "Agent", customer: "Customer" },
        sampleProducts: [
            { name: "Samsung Galaxy A15 (128GB)", category: "Smartphones", price: 550000, purchasePrice: 500000 },
            { name: "Tecno Spark 20", category: "Smartphones", price: 320000, purchasePrice: 290000 },
            { name: "Phone Case (Generic)", category: "Accessories", price: 15000, purchasePrice: 8000 },
            { name: "Charger 20W (Type-C)", category: "Accessories", price: 25000, purchasePrice: 14000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "electronics",
        name: "Electronics & Appliances",
        description: "TV, fridge and appliance sales with serial/warranty tracking, installation bookings and technician service tickets.",
        icon: "Tv",
        accent: "indigo",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "shops", "expenses", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "services", "deliveries", "systemconfig"],
        features: ["serialNumbers", "layaway", "serviceTickets", "hirePurchase", "assetRegister"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "box", "set"], allowFractional: false },
        terminology: { item: "Appliance", outlet: "Branch", staff: "Agent", customer: "Customer" },
        sampleProducts: [
            { name: "Hisense 43\" Smart TV", category: "TVs", price: 950000, purchasePrice: 860000 },
            { name: "Ramtons 250L Refrigerator", category: "Fridges", price: 850000, purchasePrice: 760000 },
            { name: "Midea 7kg Washing Machine", category: "Laundry Appliances", price: 780000, purchasePrice: 700000 },
        ],
        walkIn: true,
        scheduled: true,
    },
    {
        id: "electronics_repair",
        name: "Electronics Repair",
        description: "Repair workshop with job tickets, fault diagnosis, parts consumption and warranty periods.",
        icon: "Wrench",
        accent: "zinc",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "services", "systemconfig"],
        features: ["serviceTickets", "serialNumbers", "customMeasurements"],
        tax: STANDARD_TAX,
        units: { default: "job", alternatives: ["job", "part", "hour"], allowFractional: false },
        terminology: { item: "Repair", outlet: "Workshop", staff: "Technician", customer: "Customer" },
        sampleProducts: [
            { name: "Screen Replacement (Phone)", category: "Phone Repair", price: 120000, purchasePrice: 65000 },
            { name: "Battery Replacement", category: "Phone Repair", price: 45000, purchasePrice: 22000 },
            { name: "TV Board Repair (per hour)", category: "TV Repair", price: 50000, purchasePrice: 0, unit: "hour" },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "salvage",
        name: "Second-Hand / Salvage",
        description: "Used goods trading with condition grading, unique serial tracking and refurbishment cost tracking.",
        icon: "Recycle",
        accent: "stone",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "promotions", "suppliers", "systemconfig"],
        features: ["serialNumbers", "batchTracking", "layaway", "tieredPricing"],
        tax: STANDARD_TAX,
        units: { default: "pcs", alternatives: ["pcs", "set", "pair"], allowFractional: false },
        terminology: { item: "Item", outlet: "Branch", staff: "Agent", customer: "Customer" },
        sampleProducts: [
            { name: "Used Laptop (Grade B)", category: "Computers", price: 650000, purchasePrice: 450000 },
            { name: "Used Phone (Grade A)", category: "Phones", price: 280000, purchasePrice: 200000 },
            { name: "Used Fridge (Grade B)", category: "Appliances", price: 300000, purchasePrice: 190000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "fuel",
        name: "Fuel Station",
        description: "Petrol station with pump management, price per litre, attendant shift reconciliation and fuel-loss tracking.",
        icon: "Fuel",
        accent: "red",
        modules: ["dashboard", "sales", "pos", "stock", "inventory", "expenses", "reports", "customers", "fuelPump", "assets", "systemconfig"],
        features: ["fuelDispensing", "assetRegister", "attendance"],
        tax: STANDARD_TAX,
        units: { default: "litre", alternatives: ["litre", "unit", "jerrycan"], allowFractional: true },
        terminology: { item: "Fuel", outlet: "Pump", staff: "Attendant", customer: "Motorist" },
        sampleProducts: [
            { name: "Petrol (per litre)", category: "Fuel", price: 3200, purchasePrice: 2900, unit: "litre" },
            { name: "Diesel (per litre)", category: "Fuel", price: 3000, purchasePrice: 2700, unit: "litre" },
            { name: "Engine Oil 5L", category: "Lubricants", price: 65000, purchasePrice: 52000 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "transport",
        name: "Transport / Taxi",
        description: "Transport operator with per-route fares, vehicle records, driver assignment, trip revenue and vehicle servicing.",
        icon: "Bus",
        accent: "yellow",
        modules: ["dashboard", "sales", "pos", "expenses", "reports", "customers", "assets", "services", "maintenance", "systemconfig"],
        features: ["routeFares", "vehicleRegistrations", "assetRegister", "attendance"],
        tax: STANDARD_TAX,
        units: { default: "trip", alternatives: ["trip", "day", "route", "litre"], allowFractional: false },
        terminology: { item: "Trip", outlet: "Route", staff: "Driver", customer: "Passenger" },
        sampleProducts: [
            { name: "Kampala - Entebbe (per trip)", category: "Fares", price: 15000, purchasePrice: 0 },
            { name: "Kampala - Jinja (per trip)", category: "Fares", price: 30000, purchasePrice: 0 },
            { name: "Bodaboda Permit (per day)", category: "Permits", price: 5000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "driving_school",
        name: "Driving School",
        description: "Driving school with learner enrolment, lesson scheduling, vehicle fleet, instructor allocation and fee tracking.",
        icon: "Car",
        accent: "emerald",
        modules: ["dashboard", "sales", "pos", "stock", "expenses", "reports", "customers", "members", "bookings", "assets", "attendance", "systemconfig"],
        features: ["appointmentBooking", "memberAccounts", "attendance", "vehicleRegistrations"],
        tax: STANDARD_TAX,
        units: { default: "lesson", alternatives: ["lesson", "hour", "course"], allowFractional: false },
        terminology: { item: "Service", outlet: "Branch", staff: "Instructor", customer: "Learner" },
        sampleProducts: [
            { name: "Practical Lesson (per hour)", category: "Lessons", price: 50000, purchasePrice: 0 },
            { name: "Driving Course Package", category: "Courses", price: 1500000, purchasePrice: 0 },
            { name: "Theory Test Fee", category: "Exams", price: 100000, purchasePrice: 85000 },
        ],
        walkIn: true,
        scheduled: true,
    },

    /* ───────────────────────── Financial & Community ───────────────────────── */
    {
        id: "sacco",
        name: "SACCO / Microfinance",
        description: "Cooperative lending with member share accounts, savings deposits, loan disbursement and repayment schedules.",
        icon: "Landmark",
        accent: "green",
        modules: ["dashboard", "sales", "stock", "expenses", "reports", "customers", "members", "loans", "receivables", "systemconfig"],
        features: ["memberAccounts", "hirePurchase", "attendance"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — financial services (URA)" },
        units: { default: "unit", alternatives: ["unit", "share", "session"], allowFractional: false },
        terminology: { item: "Product", outlet: "Branch", staff: "Cashier", customer: "Member" },
        sampleProducts: [
            { name: "Share Purchase (per unit)", category: "Shares", price: 10000, purchasePrice: 10000 },
            { name: "Loan Application Fee", category: "Fees", price: 15000, purchasePrice: 0 },
            { name: "Passbook Charge", category: "Fees", price: 5000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "realestate",
        name: "Real Estate / Property Management",
        description: "Property management with rent collection, tenant records, arrears tracking, maintenance requests and deposits.",
        icon: "Building2",
        accent: "stone",
        modules: ["dashboard", "sales", "expenses", "reports", "customers", "members", "rooms", "rentals", "services", "maintenance", "assets", "systemconfig"],
        features: ["roomBooking", "roomNights", "memberAccounts", "assetRegister", "recurringServices"],
        tax: STANDARD_TAX,
        units: { default: "month", alternatives: ["month", "night", "year", "unit"], allowFractional: false },
        terminology: { item: "Service", outlet: "Property", staff: "Agent", customer: "Tenant" },
        sampleProducts: [
            { name: "Monthly Rent (per unit)", category: "Rent", price: 500000, purchasePrice: 0 },
            { name: "Water Bill (per month)", category: "Utilities", price: 40000, purchasePrice: 0 },
            { name: "Deposit (per unit)", category: "Deposits", price: 1000000, purchasePrice: 0 },
        ],
        walkIn: false,
        scheduled: false,
    },
    {
        id: "security",
        name: "Security Services",
        description: "Guarding and security company with guard shifts, client contracts, incident logs and payroll deductions.",
        icon: "ShieldCheck",
        accent: "slate",
        modules: ["dashboard", "sales", "stock", "expenses", "reports", "customers", "services", "attendance", "assets", "systemconfig"],
        features: ["attendance", "serviceTickets", "recurringServices", "assetRegister"],
        tax: STANDARD_TAX,
        units: { default: "guard", alternatives: ["guard", "shift", "day", "month"], allowFractional: false },
        terminology: { item: "Service", outlet: "Site", staff: "Guard", customer: "Client" },
        sampleProducts: [
            { name: "Guard Services (per guard per day)", category: "Guarding", price: 45000, purchasePrice: 0 },
            { name: "Night Watch (per night)", category: "Guarding", price: 60000, purchasePrice: 0 },
            { name: "Alarm Installation", category: "Installation", price: 800000, purchasePrice: 550000 },
        ],
        walkIn: false,
        scheduled: true,
    },

    /* ───────────────────────── Education & Non-Profit ───────────────────────── */
    {
        id: "education",
        name: "School / Institute",
        description: "Fee collection with class enrolment, term billing, school calendar, student arrears and receipting parents.",
        icon: "GraduationCap",
        accent: "blue",
        modules: ["dashboard", "sales", "stock", "inventory", "expenses", "reports", "customers", "members", "classes", "attendance", "systemconfig"],
        features: ["studentFees", "attendance", "classEnrolment", "memberAccounts"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — education services (URA)" },
        units: { default: "term", alternatives: ["term", "month", "course", "session"], allowFractional: false },
        terminology: { item: "Service", outlet: "Class", staff: "Teacher", customer: "Student" },
        sampleProducts: [
            { name: "Term Fees (P1)", category: "School Fees", price: 350000, purchasePrice: 0 },
            { name: "School Uniform (Shirt)", category: "Uniforms", price: 35000, purchasePrice: 20000 },
            { name: "Examination Fee", category: "Exams", price: 50000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "church",
        name: "Church / Religious Organisation",
        description: "House fellowship and church administration with tithes, offerings, member families, projects and member statements.",
        icon: "Church",
        accent: "amber",
        modules: ["dashboard", "sales", "stock", "expenses", "reports", "customers", "members", "classes", "receivables", "systemconfig"],
        features: ["donations", "memberAccounts", "attendance", "classEnrolment"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — religious organisation (URA)" },
        units: { default: "service", alternatives: ["service", "week", "project"], allowFractional: false },
        terminology: { item: "Contribution", outlet: "Branch", staff: "Treasurer", customer: "Member" },
        sampleProducts: [
            { name: "Tithe", category: "Tithes", price: 50000, purchasePrice: 0 },
            { name: "Offering", category: "Offerings", price: 20000, purchasePrice: 0 },
            { name: "Project Pledge", category: "Projects", price: 100000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
    {
        id: "ngo",
        name: "NGO / Development Programme",
        description: "Programme delivery with donor funds, beneficiary disbursements, activity budgets and per-activity cost tracking.",
        icon: "HeartHandshake",
        accent: "emerald",
        modules: ["dashboard", "sales", "stock", "inventory", "expenses", "reports", "customers", "members", "receivables", "services", "systemconfig"],
        features: ["donations", "memberAccounts", "recurringServices", "serviceTickets"],
        tax: { enabled: true, rate: 0, inclusive: true, note: "VAT exempt — exempt supplies (URA)" },
        units: { default: "beneficiary", alternatives: ["beneficiary", "household", "activity", "unit"], allowFractional: false },
        terminology: { item: "Programme", outlet: "Programme", staff: "Officer", customer: "Beneficiary" },
        sampleProducts: [
            { name: "Cash Transfer (per household)", category: "Transfers", price: 150000, purchasePrice: 0 },
            { name: "Seed Distribution (per kg)", category: "Inputs", price: 3000, purchasePrice: 2500, unit: "kg" },
            { name: "Training Support (per beneficiary)", category: "Training", price: 75000, purchasePrice: 0 },
        ],
        walkIn: true,
        scheduled: false,
    },
];

/** Fast lookup by id. */
export const CATEGORY_BY_ID: Record<string, BusinessCategory> = Object.fromEntries(
    BUSINESS_CATEGORIES.map((c) => [c.id, c])
);

/** Categories grouped by broad sector, for the setup wizard. */
export const CATEGORY_SECTORS: Array<{
    id: string;
    name: string;
    description: string;
    categories: CategoryId[];
}> = [
    {
        id: "trade",
        name: "Retail & Trade",
        description: "Shops selling goods — from mini-markets to wholesale depots.",
        categories: ["retail", "supermarket", "wholesale", "agro", "farming", "dairy", "butchery", "baker", "bookshop", "stationery", "printing", "shoes", "beauty"],
    },
    {
        id: "food",
        name: "Food & Hospitality",
        description: "Restaurants, cafés and accommodation.",
        categories: ["restaurant", "cafe", "hotel"],
    },
    {
        id: "health",
        name: "Health",
        description: "Pharmacies, clinics and veterinary services.",
        categories: ["pharmacy", "clinic", "veterinary"],
    },
    {
        id: "services",
        name: "Services & Workshops",
        description: "Trades where you sell time, skills and services.",
        categories: ["barber", "salon", "salon_spa", "fitness", "laundry", "tailor", "carpentry", "welding", "cleaning", "photography", "event", "construction", "hardware"],
    },
    {
        id: "industrial",
        name: "Industrial & Mobility",
        description: "Vehicle-related, fuel and heavy product sales.",
        categories: ["fuel", "transport", "driving_school", "mobile", "electronics", "electronics_repair", "salvage"],
    },
    {
        id: "finance",
        name: "Finance & Property",
        description: "Lending, savings and property management.",
        categories: ["sacco", "realestate", "security"],
    },
    {
        id: "community",
        name: "Education & Community",
        description: "Schools, churches and development programmes.",
        categories: ["education", "church", "ngo"],
    },
];

/** Default category used before an operator picks one. */
export const DEFAULT_CATEGORY_ID: CategoryId = "retail";

/**
 * Resolve the active category for a business profile, falling back to the
 * default retail profile when nothing has been configured.
 */
export function resolveCategory(profile?: {
    categoryId?: string;
    businessType?: string;
} | null): BusinessCategory {
    if (profile?.categoryId && CATEGORY_BY_ID[profile.categoryId]) {
        return CATEGORY_BY_ID[profile.categoryId];
    }
    if (profile?.businessType && CATEGORY_BY_ID[profile.businessType]) {
        return CATEGORY_BY_ID[profile.businessType];
    }
    return CATEGORY_BY_ID[DEFAULT_CATEGORY_ID];
}

/**
 * Map a legacy `businessType` string onto a modern category id where a
 * sensible match exists, so existing installations upgrade cleanly.
 */
export function inferCategoryFromBusinessType(businessType?: string): CategoryId | null {
    if (!businessType) return null;
    const t = businessType.toLowerCase();
    const table: Array<[RegExp, CategoryId]> = [
        [/super|market|shop|retail|store|mart/, "retail"],
        [/wholesale|distribut/, "wholesale"],
        [/pharma|drug|chemist/, "pharmacy"],
        [/clinic|hospital|health/, "clinic"],
        [/restaurant|hotel|kitchen|food/, "restaurant"],
        [/cafe|coffee/, "cafe"],
        [/salon|beauty|spa/, "salon"],
        [/barber/, "barber"],
        [/hardware|building|construction/, "hardware"],
        [/agro|fertili|seed|farm/, "agro"],
        [/fuel|petrol|station/, "fuel"],
        [/mobile|phone/, "mobile"],
        [/electronic|appliance/, "electronics"],
        [/book|stationery/, "bookshop"],
        [/print|graphic/, "printing"],
        [/bakery|baker/, "baker"],
        [/butcher|meat/, "butchery"],
        [/transport|taxi/, "transport"],
        [/tailor|fashion/, "tailor"],
        [/carpent|joinery|furniture/, "carpentry"],
        [/weld|fabricat|metal/, "welding"],
        [/laundry|dry clean/, "laundry"],
        [/fitness|gym/, "fitness"],
        [/school|education|college/, "education"],
        [/church|religious|parish/, "church"],
        [/ngo|development/, "ngo"],
        [/sacco|microfinance|cooperative/, "sacco"],
        [/real estate|property/, "realestate"],
        [/security|guard/, "security"],
        [/event|catering/, "event"],
        [/clean|janitor/, "cleaning"],
        [/photo|studio/, "photography"],
        [/veterin|livestock/, "veterinary"],
        [/driving school/, "driving_school"],
        [/salvage|second.hand/, "salvage"],
        [/shoe|footwear/, "shoes"],
        [/cosmetic|makeup/, "beauty"],
        [/dairy|milk/, "dairy"],
        [/printing|signage/, "printing"],
    ];
    for (const [re, id] of table) {
        if (re.test(t)) return id;
    }
    return null;
}
