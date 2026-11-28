/**
 * SMART_BUZ — the mock catalogue used by the development seeder.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this file is
 * ────────────────────────────────────────────────────────────────────────────
 *
 * These are **real products, at real Ugandan prices**, for every trade the
 * product supports. They are not "Product 1", "Product 2" — they are the
 * things a shop in Kampala actually sells on its shelves: a tin of Blue Band,
 * a carton of Colgate, a bag of DAP, a plate of chicken luwombo.
 *
 * The point of that is not decoration. A demo database full of placeholders
 * hides every bug a real catalogue exposes:
 *
 *   • a product priced at 1,500 and one priced at 450,000 behave differently
 *     in a receipt, a margin report and a low-stock alert;
 *   • a service ("Photocopy, per page", 200) behaves differently from a
 *     good that sits on a shelf and can run out;
 *   • a product sold by the kilogram behaves differently from one sold by
 *     the piece.
 *
 * So the demo data has to be shaped like the real thing, or the demo proves
 * nothing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where this data may be used
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Only by the development seeder** (`convex/devMockData.ts`), which is
 * guarded by the server secret and refuses to run anywhere but a `dev:`
 * deployment. Nothing in the production UI reads this file, and a real
 * business never sees a row from it.
 *
 * The catalogue is plain data — no imports, no functions, no side effects —
 * so it can be read by the seeder, by the tests and by anybody reviewing the
 * change without running anything.
 */

/**
 * One product, written as a row.
 *
 * `price` is the selling price, `purchasePrice` is what the business pays
 * for it, and the margin between them is the shop's gross margin. The unit
 * is the unit the business actually trades in — `kg` for maize, `litre` for
 * milk, `pcs` for a bar of soap.
 */
export type MockRow = readonly [
    name: string,
    category: string,
    price: number,
    purchasePrice: number,
    unit?: string,
];

/**
 * The catalogue of one trade.
 *
 * Every trade SMART_BUZ supports has an entry, so a business of any
 * vertical gets a demo catalogue that belongs to its trade rather than a
 * generic one.
 */
export const MOCK_CATALOGUES: Record<string, MockRow[]> = {
    /* ─────────────────────────── Retail & Trade ─────────────────────────── */
    retail: [
        ["Sensorex Beauty Soap 400g", "Soap", 3500, 2500],
        ["Colgate Toothpaste 100ml", "Personal Care", 8000, 5500],
        ["Nivea Men Creme 100ml", "Cosmetics", 12000, 8500],
        ["Rwenzori Water 500ml", "Beverages", 1500, 900],
        ["Coca-Cola 350ml", "Beverages", 2000, 1500],
        ["Mukwano Cooking Oil 1L", "Groceries", 28000, 24000],
        ["Nokidezi Sugar 1kg", "Groceries", 7000, 6000],
        ["Blue Band 250g", "Groceries", 9500, 7000],
        ["Bread (Tastoz) 500g", "Bakery", 3500, 2600],
        ["Eggs (Tray of 30)", "Dairy", 15000, 12000],
        ["Fries (Safi) 100g", "Snacks", 1000, 700],
        ["Good Biscuits 100g", "Snacks", 1500, 1000],
        ["Rwenzori Black Tea 100g", "Beverages", 12000, 8500],
        ["Airtel Airtime (UGX 1000)", "Airtime", 1000, 1000],
        ["MTN Airtime (UGX 2000)", "Airtime", 2000, 2000],
        ["Sugar Packet (Sachet)", "Groceries", 200, 150],
        ["Note Book (40 pages)", "Stationery", 3500, 2500],
        ["Bic Pen (per piece)", "Stationery", 1000, 600],
        ["Toilet Roll (2 pieces)", "Household", 6000, 4200],
        ["Dish Washing Liquid 1L", "Household", 7500, 5200],
    ],

    supermarket: [
        ["Mukwano Cooking Oil 5L", "Cooking Oil", 145000, 128000],
        ["Nokidezi Sugar 1kg", "Groceries", 7000, 6000],
        ["Fresh Milk 1L", "Dairy", 3500, 2800, "litre"],
        ["Kim-Fay Cigarettes (Packet)", "Tobacco", 20000, 19500],
        ["Rwenzori Water 500ml (Pack of 24)", "Beverages", 32000, 26000],
        ["Colgate Toothpaste 100ml (Box of 12)", "Personal Care", 90000, 72000],
        ["Blue Band 250g", "Groceries", 9500, 7000],
        ["Rice (Oryza Long Grain) 1kg", "Grains", 9000, 7500],
        ["Beans (Red Speckled) 1kg", "Grains", 7500, 6200],
        ["Maize Flour (Posho) 1kg", "Groceries", 3500, 2800],
        ["Bread (Tastoz) 500g", "Bakery", 3500, 2600],
        ["Eggs (Tray of 30)", "Dairy", 15000, 12000],
        ["Chicken (Whole) 1kg", "Meat & Poultry", 9000, 7200, "kg"],
        ["Beef (Minced) 1kg", "Meat & Poultry", 14000, 11000, "kg"],
        ["Tomatoes 1kg", "Vegetables", 3500, 2500, "kg"],
        ["Onions 1kg", "Vegetables", 4000, 3000, "kg"],
        ["Irish Potatoes 1kg", "Vegetables", 3000, 2000, "kg"],
        ["Bananas (Bunch)", "Fruits", 8000, 5000, "bunch"],
        ["Apples 1kg", "Fruits", 6000, 4500, "kg"],
        ["Salt 1kg", "Groceries", 2000, 1500],
        ["Toilet Tissue (2 rolls)", "Household", 6000, 4200],
        ["Bathing Soap (Multipack of 4)", "Personal Care", 14000, 10000],
        ["Washing Powder 1kg", "Household", 18000, 13000],
        ["Laundry Liquid 1L", "Household", 22000, 16000],
        ["Dish Washer 1L", "Household", 7500, 5200],
        ["Floor Cleaner 1L", "Household", 9000, 6500],
        ["Tissue Paper (100 sheets)", "Household", 3000, 2000],
        ["Ballpoint Pen (Box of 12)", "Stationery", 6000, 4000],
    ],

    wholesale: [
        ["Colgate Toothpaste 100ml (Carton of 48)", "Personal Care", 340000, 300000],
        ["Rwenzori Water 500ml (Carton of 24)", "Beverages", 32000, 26000],
        ["Nokidezi Sugar 1kg (Bag of 50kg)", "Groceries", 330000, 295000],
        ["Blue Band 250g (Carton of 24)", "Groceries", 210000, 180000],
        ["Mukwano Cooking Oil 5L (Carton of 4)", "Cooking Oil", 560000, 500000],
        ["Mukwano Cooking Oil 1L (Carton of 12)", "Cooking Oil", 320000, 285000],
        ["Rice 1kg (Bag of 50kg)", "Grains", 430000, 385000],
        ["Tissues (Carton of 48)", "Household", 130000, 110000],
        ["Beauty Soap (Carton of 72)", "Personal Care", 240000, 200000],
        ["Milk Powder (Carton of 12)", "Dairy", 420000, 375000],
        ["Milk 1L (Carton of 12)", "Dairy", 42000, 36000],
        ["Biscuits (Carton of 48)", "Snacks", 90000, 78000],
        ["Washing Powder 1kg (Carton of 10)", "Household", 170000, 145000],
        ["Salt 1kg (Bag of 50kg)", "Groceries", 95000, 85000],
    ],

    /* ─────────────────────────── Health & Beauty ────────────────────────── */
    pharmacy: [
        ["Panadol 500mg (Box of 24 Tablets)", "Analgesics", 12000, 8000],
        ["Amoxil 500mg (Box of 21 Capsules)", "Antibiotics", 45000, 32000],
        ["Metronidazole 400mg (Box of 20)", "Antibiotics", 20000, 14000],
        ["Ibuprofen 400mg (Box of 20)", "Analgesics", 16000, 11000],
        ["Paracetamol Syrup 100ml", "Paediatrics", 15000, 10000],
        ["Cough Syrup 100ml", "Paediatrics", 14000, 9500],
        ["ORS Sachet (Box of 100)", "Rehydration", 45000, 32000],
        ["Vitamin C 100mg (Bottle of 100)", "Vitamins", 18000, 12000],
        ["Multivitamin Complex (Bottle of 60)", "Vitamins", 45000, 30000],
        ["Iron + Folic Acid (Bottle of 100)", "Vitamins", 25000, 17000],
        ["Cetirizine 10mg (Box of 30)", "Antihistamine", 14000, 9000],
        ["Chlorpheniramine (Box of 20)", "Antihistamine", 8000, 5000],
        ["Gentamicin Eye Ointment 5g", "Eye Care", 12000, 8000],
        ["Hydrocortisone Cream 30g", "Dermatology", 22000, 15000],
        ["Dettol Antiseptic 250ml", "Antiseptic", 35000, 25000],
        ["Medical Gloves (Box of 100)", "Consumables", 45000, 32000],
        ["Face Mask (Box of 50)", "Consumables", 20000, 14000],
        ["Sanitary Pads (Packet of 10)", "Hygiene", 12000, 8500],
        ["Pregnancy Test Kit", "Diagnostics", 15000, 10000],
        ["HIV Test Kit", "Diagnostics", 35000, 25000],
        ["Malaria Rapid Test (Box of 25)", "Diagnostics", 62500, 45000],
        ["BP Machine (Automatic)", "Devices", 180000, 135000],
        ["Digital Thermometer", "Devices", 25000, 17000],
        ["Blood Glucose Strips (50)", "Diagnostics", 90000, 65000],
        ["Herbal Cough Syrup (Bottle of 200ml)", "Herbal", 20000, 13000],
    ],

    clinic: [
        ["General Consultation", "Consultation", 30000, 0],
        ["Specialist Consultation", "Consultation", 60000, 0],
        ["Family Planning Consultation", "Consultation", 25000, 8000],
        ["Antenatal Care Visit", "Consultation", 40000, 12000],
        ["Child Immunisation", "Vaccination", 15000, 5000],
        ["Malaria Test (Rapid)", "Diagnostics", 15000, 8000],
        ["HIV Screening Test", "Diagnostics", 35000, 25000],
        ["Pregnancy Test", "Diagnostics", 15000, 10000],
        ["Blood Sugar Test", "Diagnostics", 8000, 3000],
        ["Urinalysis", "Diagnostics", 12000, 5000],
        ["Minor Wound Dressing", "Procedure", 25000, 8000],
        ["Dental Scaling", "Procedure", 80000, 25000],
        ["Removal of Sutures", "Procedure", 15000, 5000],
        ["Syringe 5ml", "Consumables", 1500, 800],
        ["Gloves (Pair)", "Consumables", 800, 400],
        ["Cotton Wool 100g", "Consumables", 3000, 1800],
        ["Strapping Bandage", "Consumables", 6000, 3500],
    ],

    beauty: [
        ["Foundation 30ml", "Makeup", 45000, 32000],
        ["Shea Butter Lotion 300ml", "Skincare", 28000, 19000],
        ["Body Cream 400ml", "Skincare", 22000, 14000],
        ["Lip Gloss", "Makeup", 15000, 8000],
        ["Matte Lipstick", "Makeup", 18000, 10000],
        ["Eyeliner Pencil", "Makeup", 12000, 6000],
        ["Mascara", "Makeup", 20000, 11000],
        ["Face Powder", "Makeup", 20000, 12000],
        ["Concealer", "Makeup", 25000, 15000],
        ["Beauty Brush Set", "Tools", 45000, 28000],
        ["Hair Spray 250ml", "Hair", 25000, 15000],
        ["Hair Serum 100ml", "Hair", 20000, 12000],
        ["Nail Polish", "Nails", 8000, 4500],
        ["Nail Tip (Box of 100)", "Nails", 12000, 7000],
        ["Facial Treatment", "Skincare", 35000, 12000],
        ["Waxing (Arms)", "Beauty", 20000, 7000],
    ],

    salon: [
        ["Hair Wash & Blow Dry", "Hair", 25000, 8000],
        ["Hair Braids (per head)", "Hair", 45000, 15000],
        ["Weave Installation", "Hair", 90000, 35000],
        ["Wig Fixing", "Hair", 60000, 22000],
        ["Hair Treatment (Aloe)", "Treatment", 20000, 8000],
        ["Hair Colour (Full Head)", "Colour", 45000, 20000],
        ["Haircut (Ladies)", "Haircut", 20000, 7000],
        ["Manicure", "Nails", 15000, 5000],
        ["Pedicure", "Nails", 20000, 7000],
        ["Gel Manicure", "Nails", 25000, 9000],
        ["Facial Treatment", "Skincare", 35000, 12000],
        ["Body Scrub", "Skincare", 40000, 15000],
        ["Waxing (Arms)", "Beauty", 20000, 7000],
        ["Waxing (Full Body)", "Beauty", 55000, 20000],
        ["Eyebrow Trimming", "Beauty", 10000, 3000],
        ["Foundation 30ml", "Makeup", 45000, 32000],
        ["Shea Butter Lotion 300ml", "Skincare", 28000, 19000],
    ],

    salon_spa: [
        ["Swedish Massage (60 min)", "Massage", 80000, 25000],
        ["Deep Tissue Massage (60 min)", "Massage", 100000, 35000],
        ["Hot Stone Massage (60 min)", "Massage", 120000, 40000],
        ["Aromatherapy Massage (60 min)", "Massage", 110000, 38000],
        ["Massage (30 min)", "Massage", 45000, 15000],
        ["Body Scrub", "Body", 60000, 20000],
        ["Facial (Deep Clean)", "Facial", 70000, 25000],
        ["Manicure & Pedicure (Combo)", "Nails", 45000, 15000],
        ["Waxing (Full Body)", "Beauty", 55000, 20000],
        ["Manicure", "Nails", 25000, 8000],
        ["Pedicure", "Nails", 35000, 12000],
        ["Gel Manicure", "Nails", 40000, 14000],
        ["Hair Treatment (Aloe)", "Hair", 30000, 10000],
        ["Sauna Session", "Recreation", 40000, 12000],
    ],

    barber: [
        ["Haircut (Men)", "Haircut", 15000, 5000],
        ["Haircut (Children)", "Haircut", 10000, 3500],
        ["Haircut (Ladies)", "Haircut", 20000, 7000],
        ["Shave (Clean)", "Shave", 10000, 3000],
        ["Beard Trim", "Beard", 8000, 2500],
        ["Hair Wash & Blow Dry", "Treatment", 15000, 5000],
        ["Hair Colour (Full Head)", "Colour", 45000, 20000],
        ["Dreadlocks Retwist (per inch)", "Hair", 5000, 1500, "inch"],
        ["Haircut + Shave (Combo)", "Combo", 20000, 7000],
        ["Hair Treatment (Aloe)", "Treatment", 20000, 8000],
        ["Neck Shave", "Shave", 5000, 1500],
        ["Ear Trimming", "Grooming", 5000, 1000],
    ],

    /* ────────────────────────────── Food & Drink ────────────────────────── */
    restaurant: [
        ["Chicken Luwombo (1/2)", "Main", 22000, 11000],
        ["Special Chicken (Whole)", "Main", 42000, 21000],
        ["Beef Luwombo", "Main", 24000, 12000],
        ["Goat Meat Luwombo", "Main", 26000, 13000],
        ["Fish Tilapia (Fried)", "Main", 18000, 9000],
        ["Chips (Large)", "Sides", 5000, 2000],
        ["Chapati (per piece)", "Bread", 1500, 900],
        ["Rice & Beans (Plate)", "Main", 8000, 3500],
        ["Rolex (Chapati + Egg)", "Snacks", 7000, 3000],
        ["Fried Egg (per piece)", "Snacks", 2000, 800],
        ["Fresh Juice (Glass)", "Drinks", 4000, 2000],
        ["Fresh Juice (1 Litre)", "Drinks", 9000, 4000, "litre"],
        ["Mango Smoothie", "Drinks", 8000, 3500],
        ["Rwenzori Water 500ml", "Drinks", 1500, 900],
        ["Coca-Cola 350ml", "Drinks", 2000, 1500],
        ["Coffee (Cup)", "Drinks", 4000, 1500],
        ["Mandazi (per piece)", "Snacks", 1000, 600],
        ["Meat Pie", "Snacks", 3000, 1500],
        ["Chapati + Beef (Combo)", "Main", 18000, 8000],
    ],

    cafe: [
        ["Americano", "Coffee", 8000, 3000],
        ["Latte", "Coffee", 12000, 4500],
        ["Cappuccino", "Coffee", 12000, 4500],
        ["Espresso (Single)", "Coffee", 5000, 2000],
        ["Mocha", "Coffee", 14000, 5500],
        ["Chai Latte", "Coffee", 11000, 4200],
        ["Iced Latte", "Coffee", 13000, 5000],
        ["Iced Coffee", "Coffee", 13000, 5000],
        ["Tea (Cup)", "Tea", 4000, 1500],
        ["Blueberry Muffin", "Bakery", 7000, 3500],
        ["Chocolate Cake (Slice)", "Bakery", 8000, 4000],
        ["Samosa", "Snacks", 3000, 1500],
        ["Fresh Orange Juice (Glass)", "Drinks", 6000, 3000],
        ["Fruit Salad (Bowl)", "Snacks", 7000, 3500],
    ],

    baker: [
        ["Chapati (per piece)", "Bread", 1500, 900],
        ["Mandazi (per piece)", "Snacks", 1000, 600],
        ["Cake Slices (per piece)", "Cake", 5000, 3000],
        ["Bread (Tastoz) 500g", "Bread", 3500, 2600],
        ["Sugar Bun", "Bread", 1500, 900],
        ["Samosa", "Snacks", 3000, 1500],
        ["Meat Pie", "Snacks", 3000, 1500],
        ["Doughnut", "Snacks", 2000, 1100],
        ["Baguette", "Bread", 2500, 1600],
        ["Cookies (per piece)", "Bakery", 1500, 800],
        ["Chocolate Muffin", "Bakery", 7000, 3500],
        ["Vanilla Sponge (1kg)", "Cake", 30000, 18000],
        ["Birthday Cake 2kg (Vanilla)", "Cake", 80000, 50000],
        ["Cupcakes (Box of 12)", "Cake", 36000, 22000],
    ],

    butchery: [
        ["Beef Cuts (per kg)", "Beef", 14000, 11000, "kg"],
        ["Beef Minced (per kg)", "Beef", 13500, 10500, "kg"],
        ["Goat Meat (per kg)", "Goat", 13000, 10000, "kg"],
        ["Pork Ribs (per kg)", "Pork", 12000, 9500, "kg"],
        ["Rack of Ribs (per kg)", "Pork", 13500, 10500, "kg"],
        ["Chicken (Dressed, per kg)", "Poultry", 9000, 7200, "kg"],
        ["Chicken Whole (per kg)", "Poultry", 9500, 7500, "kg"],
        ["Chicken Legs (per kg)", "Poultry", 10500, 8200, "kg"],
        ["Sausages (per kg)", "Processed", 12000, 8500, "kg"],
        ["Bacon (per kg)", "Processed", 15000, 11000, "kg"],
        ["Liver (Beef, per kg)", "Offal", 9000, 7000, "kg"],
        ["Fish Tilapia (Fresh, per kg)", "Fish", 8000, 6000, "kg"],
        ["Fish Nile Perch (per kg)", "Fish", 11000, 8500, "kg"],
    ],

    dairy: [
        ["Fresh Cow Milk", "Milk", 1200, 950, "litre"],
        ["Milk 1L (Pouch)", "Milk", 3000, 2400, "litre"],
        ["UHT Milk 1L (Carton)", "Long Life Milk", 3500, 2800],
        ["Powdered Milk 1kg", "Milk Powder", 28000, 22000],
        ["Yoghurt 500g", "Value Added", 4000, 3000],
        ["Flavoured Yoghurt 500ml", "Value Added", 4500, 3200],
        ["Cheese Block 1kg", "Value Added", 18000, 14000],
        ["Cottage Cheese 500g", "Value Added", 8000, 6000],
        ["Butter 250g", "Dairy Fat", 6000, 4500],
        ["Ghee 1kg", "Dairy Fat", 22000, 17000],
        ["Cream 500ml", "Dairy Fat", 9000, 6500],
        ["Saturated Oil 5L", "Fats", 90000, 78000],
    ],

    /* ──────────────────────────── Agriculture ───────────────────────────── */
    agro: [
        ["DAP Fertiliser 50kg", "Fertiliser", 110000, 96000, "sack"],
        ["Urea Fertiliser 50kg", "Fertiliser", 98000, 85000, "sack"],
        ["NPK 17-17-17 50kg", "Fertiliser", 105000, 92000, "sack"],
        ["Maize Seed (KERNEL) 10kg", "Seed", 85000, 72000, "packet"],
        ["Groundnut Seed 5kg", "Seed", 45000, 38000, "packet"],
        ["Beans Seed (KITYO) 5kg", "Seed", 35000, 29000, "packet"],
        ["Roundup Herbicide 1L", "Crop Protection", 45000, 38000, "litre"],
        ["Fungicide (Ridomil) 250g", "Crop Protection", 35000, 28000],
        ["Insecticide (Bushido) 250ml", "Crop Protection", 25000, 19000],
        ["Sprayer Knapsack 16L", "Equipment", 95000, 70000],
        ["Watering Can 20L", "Equipment", 45000, 32000],
        ["Hoe", "Equipment", 25000, 17000],
        ["Machete", "Equipment", 20000, 13000],
        ["Fishing Net (per roll)", "Equipment", 85000, 65000],
        ["Feed Pellets 50kg", "Animal Feed", 55000, 45000, "bag"],
        ["Layer Mash 50kg", "Animal Feed", 65000, 54000, "bag"],
        ["Poultry Grower 50kg", "Animal Feed", 62000, 51000, "bag"],
        ["Mulch Plastic (per roll)", "Inputs", 85000, 65000, "roll"],
    ],

    farming: [
        ["Maize Grain (Grade 1)", "Cereals", 3200, 2900, "kg"],
        ["Rice Grain (Paddy)", "Cereals", 3800, 3400, "kg"],
        ["Millet Grain", "Cereals", 4500, 3900, "kg"],
        ["Sorghum Grain", "Cereals", 4200, 3600, "kg"],
        ["Coffee Cherry (Dry)", "Coffee", 12000, 10500, "kg"],
        ["Groundnuts (Shelled)", "Oil Seeds", 7500, 6500, "kg"],
        ["Soybeans", "Oil Seeds", 5000, 4300, "kg"],
        ["Irish Potatoes", "Vegetables", 2500, 1800, "kg"],
        ["Sweet Potatoes", "Vegetables", 2200, 1500, "kg"],
        ["Cassava", "Vegetables", 1800, 1200, "kg"],
        ["Onions", "Vegetables", 3500, 2800, "kg"],
        ["Tomatoes", "Vegetables", 3000, 2200, "kg"],
        ["Cabbage", "Vegetables", 2500, 1700, "kg"],
        ["Carrots", "Vegetables", 3000, 2200, "kg"],
        ["Bananas (Bunch)", "Fruits", 8000, 5000, "bunch"],
        ["Watermelon", "Fruits", 6000, 4000, "piece"],
        ["Avocado", "Fruits", 5000, 3500, "kg"],
        ["Pineapple", "Fruits", 5000, 3500, "piece"],
        ["Wool (per kg)", "Livestock", 12000, 9000, "kg"],
        ["Mutton (per kg)", "Livestock", 15000, 12000, "kg"],
    ],

    veterinary: [
        ["Cattle Deworming (per Head)", "Treatment", 15000, 7000, "head"],
        ["Brucellosis Test (per Head)", "Diagnostics", 20000, 10000, "head"],
        ["Footrot Treatment (per Head)", "Treatment", 12000, 6000, "head"],
        ["FMD Vaccination (per Head)", "Vaccination", 10000, 5000, "head"],
        ["Poultry Deworming (per Bird)", "Treatment", 500, 200, "bird"],
        ["Poultry Vaccination (per Bird)", "Vaccination", 800, 350, "bird"],
        ["Veterinary Consultation", "Consultation", 20000, 0],
        ["Artificial Insemination", "Procedure", 75000, 25000, "head"],
        ["Calf Delivery Assistance", "Procedure", 50000, 15000, "head"],
        ["Poultry House Cleaning", "Services", 35000, 12000],
        ["Disinfectant 5L", "Supplies", 25000, 16000],
        ["Syringe & Needle 5ml", "Supplies", 1500, 800],
        ["Animal Feed 50kg", "Feed", 55000, 45000, "bag"],
        ["Milk Testing (per Sample)", "Diagnostics", 8000, 3000],
        ["Ear Tag (per piece)", "Supplies", 5000, 2500, "piece"],
    ],

    /* ───────────────────────────── Trade & Industry ─────────────────────── */
    hardware: [
        ["Cement (Bag of 50kg)", "Building Materials", 95000, 82000, "bag"],
        ["Sand (Bag of 50kg)", "Building Materials", 8000, 6000, "bag"],
        ["Cement Blocks (per piece)", "Building Materials", 2500, 1800],
        ["Iron Bars 6mm (per piece)", "Reinforcement", 35000, 28000],
        ["Roofing Sheets (per piece)", "Roofing", 45000, 36000],
        ["Ordinary Wire (per roll)", "Electrical", 55000, 44000],
        ["Electric Cable 2.5mm (100m)", "Electrical", 145000, 120000, "roll"],
        ["Breaker 32A", "Electrical", 35000, 27000],
        ["Switch Socket", "Electrical", 12000, 8000],
        ["LED Bulb 9W", "Electrical", 8000, 5000],
        ["Water Pipe 1/2 inch (6m)", "Plumbing", 18000, 13000],
        ["Water Tap (Chrome)", "Plumbing", 22000, 15000],
        ["PVC Elbow 1 inch", "Plumbing", 3000, 2000],
        ["Paint (5 litres)", "Painting", 95000, 72000],
        ["Paint Brush (2 inch)", "Painting", 7000, 4500],
        ["Nails 1kg", "Hardware", 15000, 11000, "kg"],
        ["Bolts & Nuts 1kg", "Hardware", 20000, 14000, "kg"],
        ["Hinges (Set of 3)", "Hardware", 12000, 8000],
        ["Padlock 50mm", "Hardware", 18000, 12000],
        ["Saw Blade", "Tools", 25000, 17000],
    ],

    construction: [
        ["Cement (Bag of 50kg)", "Materials", 95000, 82000, "bag"],
        ["Sand (Bag of 50kg)", "Materials", 8000, 6000, "bag"],
        ["Murram (per truck)", "Materials", 350000, 250000, "truck"],
        ["Land Fill (per truck)", "Materials", 250000, 180000, "truck"],
        ["Block (per piece)", "Materials", 2500, 1800],
        ["Iron Bars 6mm (per piece)", "Materials", 35000, 28000],
        ["Roofing Sheets (per piece)", "Materials", 45000, 36000],
        ["Ordinary Wire (per roll)", "Materials", 55000, 44000],
        ["Electric Cable 2.5mm (100m)", "Materials", 145000, 120000, "roll"],
        ["Paint (5 litres)", "Materials", 95000, 72000],
        ["Plumbing Pipe 1/2 inch (6m)", "Materials", 18000, 13000],
        ["Labour (per day, unskilled)", "Labour", 35000, 0, "day"],
        ["Labour (per day, skilled)", "Labour", 60000, 0, "day"],
        ["Site Visit / Supervision", "Services", 250000, 0, "visit"],
    ],

    fuel: [
        ["Diesel (per Litre)", "Fuel", 3800, 3400, "litre"],
        ["Petrol (per Litre)", "Fuel", 4200, 3800, "litre"],
        ["Kerosene (per Litre)", "Fuel", 3500, 3000, "litre"],
        ["Engine Oil 5L", "Lubricants", 65000, 50000],
        ["Engine Oil 1L", "Lubricants", 15000, 11000],
        ["Brake Fluid 1L", "Lubricants", 18000, 13000],
        ["Coolant 1L", "Lubricants", 22000, 16000],
        ["Air Filter (Universal)", "Spares", 35000, 24000],
        ["Oil Filter (Toyota Vitz)", "Spares", 28000, 19000],
        ["Spark Plugs (Set of 4)", "Spares", 40000, 28000],
        ["Wiper Blades (Pair)", "Spares", 25000, 17000],
        ["Battery 70Ah", "Spares", 320000, 250000],
        ["Tyre 175/65 R14", "Spares", 185000, 140000],
        ["Fire Extinguisher 6kg", "Safety", 95000, 70000],
    ],

    electronics: [
        ["Samsung Galaxy A15 (128GB)", "Handsets", 450000, 380000],
        ["Tecno Spark 20 (128GB)", "Handsets", 320000, 265000],
        ["Infinix Hot 40 (64GB)", "Handsets", 285000, 235000],
        ["itel A70 (64GB)", "Handsets", 195000, 160000],
        ["Realme C55 (64GB)", "Handsets", 250000, 205000],
        ["iPhone 13 (128GB, Used)", "Handsets", 650000, 550000],
        ["Bluetooth Speaker", "Accessories", 45000, 30000],
        ["Wired Headset", "Accessories", 12000, 7000],
        ["Phone Charger (Type C)", "Accessories", 15000, 9000],
        ["Power Bank 20000mAh", "Accessories", 75000, 55000],
        ["Phone Case (Samsung A15)", "Accessories", 12000, 6500],
        ["Screen Protector (Tempered)", "Accessories", 8000, 3000],
        ["Memory Card 128GB", "Accessories", 25000, 17000],
        ["LED TV 32 inch", "Appliances", 550000, 460000],
        ["Electric Kettle 1.5L", "Appliances", 45000, 30000],
        ["Standing Fan (Rechargeable)", "Appliances", 95000, 70000],
        ["Laptop Charger 65W", "Accessories", 45000, 32000],
    ],

    electronics_repair: [
        ["Screen Replacement (Smartphone)", "Repairs", 150000, 90000],
        ["Battery Replacement", "Repairs", 70000, 40000],
        ["Charging Port Repair", "Repairs", 55000, 30000],
        ["Speaker Repair", "Repairs", 45000, 25000],
        ["Water Damage Treatment", "Repairs", 85000, 50000],
        ["Software Flashing", "Repairs", 30000, 10000],
        ["Virus / Malware Cleanup", "Repairs", 40000, 15000],
        ["Keyboard Replacement (Laptop)", "Repairs", 120000, 70000],
        ["Screen Replacement (Laptop)", "Repairs", 250000, 160000],
        ["Hard Drive Replacement", "Repairs", 180000, 120000],
        ["Fan Replacement (Laptop)", "Repairs", 60000, 35000],
        ["Diagnostics Fee", "Services", 20000, 5000],
        ["House Call (within Kampala)", "Services", 30000, 10000],
    ],

    mobile: [
        ["Airtel Airtime (UGX 1000)", "Airtime", 1000, 1000],
        ["Airtel Airtime (UGX 5000)", "Airtime", 5000, 5000],
        ["MTN Airtime (UGX 1000)", "Airtime", 1000, 1000],
        ["MTN Airtime (UGX 2000)", "Airtime", 2000, 2000],
        ["Africell Airtime (UGX 1000)", "Airtime", 1000, 1000],
        ["UTL Airtime (UGX 1000)", "Airtime", 1000, 1000],
        ["MTN Data Bundle 1GB (30 days)", "Data", 15000, 12000],
        ["Airtel Data Bundle 1GB (30 days)", "Data", 15000, 12000],
        ["Phone Charger (Type C)", "Accessories", 15000, 9000],
        ["Phone Charger (Lightning)", "Accessories", 15000, 9000],
        ["Earphones (Generic)", "Accessories", 8000, 4500],
        ["Phone Case (Universal)", "Accessories", 8000, 4000],
        ["Screen Protector", "Accessories", 5000, 2000],
        ["Power Bank 10000mAh", "Accessories", 55000, 38000],
        ["USB Cable 1m", "Accessories", 6000, 3000],
        ["SIM Card", "Accessories", 2000, 1000],
    ],

    salvage: [
        ["Used Engine (Toyota Vitz)", "Spares", 350000, 280000],
        ["Used Gearbox", "Spares", 280000, 220000],
        ["Used Tyres (Set of 4)", "Spares", 220000, 160000],
        ["Used Starter Motor", "Spares", 90000, 65000],
        ["Used Alternator", "Spares", 85000, 60000],
        ["Used Door Panel", "Spares", 60000, 40000],
        ["Used Bumper", "Spares", 55000, 35000],
        ["Used Side Mirror", "Spares", 35000, 22000],
        ["Used Headlight (Pair)", "Spares", 45000, 30000],
        ["Used Windscreen", "Spares", 70000, 50000],
    ],

    transport: [
        ["Taxi (Kampala - Entebbe)", "Fare", 25000, 0],
        ["Taxi (Kampala - Mbarara)", "Fare", 45000, 0],
        ["Taxi (Kampala - Jinja)", "Fare", 35000, 0],
        ["Bus Ticket (Kampala - Jinja)", "Fare", 12000, 0],
        ["Bus Ticket (Kampala - Mbarara)", "Fare", 15000, 0],
        ["Boda Boda (Short Distance)", "Fare", 5000, 0],
        ["Boda Boda (Up to 5 km)", "Fare", 8000, 0],
        ["Airport Transfer (Entebbe)", "Transfer", 120000, 30000],
        ["Car Hire (per day)", "Hire", 350000, 0, "day"],
        ["Courier (Within Kampala)", "Courier", 8000, 2000],
        ["Courier (Up Country)", "Courier", 20000, 5000],
        ["Luggage Handling", "Extra", 3000, 0],
        ["Parking (per hour)", "Extra", 2000, 0],
        ["Vehicle Wash (Full Exterior)", "Service", 15000, 4000],
        ["Vehicle Wash (Interior + Exterior)", "Service", 25000, 7000],
        ["Diesel (per Litre)", "Fuel", 3800, 3400, "litre"],
    ],

    /* ───────────────────────── Services & Bookings ──────────────────────── */
    hotel: [
        ["Standard Room (per night)", "Accommodation", 80000, 0, "night"],
        ["Executive Room (per night)", "Accommodation", 150000, 0, "night"],
        ["Twin Room (per night)", "Accommodation", 120000, 0, "night"],
        ["Family Suite (per night)", "Accommodation", 220000, 0, "night"],
        ["Day Use Room (4 hours)", "Accommodation", 60000, 0],
        ["Room Service Meal", "F&B", 25000, 12000],
        ["Continental Breakfast", "F&B", 18000, 8000],
        ["Laundry Service (per kg)", "Laundry", 8000, 3000, "kg"],
        ["Ironing (per item)", "Laundry", 5000, 1500],
        ["Airport Transfer", "Transport", 60000, 20000],
        ["Swimming Pool (Day Pass)", "Recreation", 25000, 8000],
        ["Conference Hall (per hour)", "Events", 80000, 25000, "hour"],
    ],

    laundry: [
        ["Wash & Fold (per kg)", "Laundry", 5000, 2000, "kg"],
        ["Wash & Iron (per kg)", "Laundry", 7000, 3000, "kg"],
        ["Wash & Press (per item)", "Laundry", 8000, 3500],
        ["Curtain Cleaning (per kg)", "Laundry", 6000, 2500, "kg"],
        ["Dry Cleaning (Jacket)", "Dry Cleaning", 18000, 8000],
        ["Dry Cleaning (Suit)", "Dry Cleaning", 25000, 12000],
        ["Shoe Cleaning", "Service", 10000, 4000],
        ["Handbag Cleaning", "Service", 20000, 9000],
        ["Mattress Cleaning (Single)", "Service", 35000, 15000],
        ["Sofa Cleaning (per seat)", "Service", 25000, 10000],
        ["Ironing Only (per item)", "Service", 3000, 1000],
        ["Duvet (Single)", "Bedding", 25000, 14000],
        ["Towel (Large)", "Bedding", 15000, 8000],
        ["Bedsheet (Double)", "Bedding", 30000, 18000],
    ],

    tailor: [
        ["Men's Suit (2 Piece)", "Tailoring", 250000, 120000],
        ["Ladies Gown", "Tailoring", 180000, 85000],
        ["Wrapped Gown (Traditional)", "Tailoring", 150000, 70000],
        ["Shirt (Custom)", "Tailoring", 45000, 20000],
        ["Trousers (Custom)", "Tailoring", 40000, 18000],
        ["Uniform (2 Pieces)", "Tailoring", 65000, 30000],
        ["Kente Fabric (per yard)", "Fabric", 45000, 30000, "yard"],
        ["Cotton Fabric (per yard)", "Fabric", 12000, 7500, "yard"],
        ["Alterations (Hem)", "Service", 8000, 2000],
        ["Zipper Replacement", "Service", 7000, 2500],
        ["Button Replacement", "Service", 3000, 1000],
        ["Embroidery (per item)", "Service", 10000, 4000],
        ["Repair (Simple)", "Service", 12000, 4000],
    ],

    carpentry: [
        ["Made-to-Measure Wardrobe", "Furniture", 850000, 450000],
        ["Made-to-Measure Kitchen Unit", "Furniture", 1200000, 650000],
        ["Office Desk", "Furniture", 350000, 180000],
        ["Bookshelf (4 Shelves)", "Furniture", 250000, 130000],
        ["Dining Table (6 Seats)", "Furniture", 550000, 300000],
        ["TV Stand", "Furniture", 180000, 95000],
        ["Door (Solid Wood, 3x7)", "Doors", 350000, 190000],
        ["Window Frame", "Doors", 180000, 95000],
        ["Custom Shelf", "Furniture", 90000, 45000],
        ["Kitchen Countertop (per metre)", "Furniture", 180000, 95000, "metre"],
        ["Partition Wall (per sqm)", "Partitions", 85000, 45000, "sqm"],
        ["Ceiling (PVC, per sqm)", "Partitions", 45000, 25000, "sqm"],
        ["Repair of Broken Chair", "Service", 25000, 8000],
        ["Furniture Assembly (per item)", "Service", 15000, 5000],
    ],

    welding: [
        ["Custom Steel Window", "Fabrication", 350000, 200000],
        ["Steel Gate (3x4 ft)", "Fabrication", 450000, 260000],
        ["Fence (per metre)", "Fabrication", 85000, 50000, "metre"],
        ["Tank Stand", "Fabrication", 280000, 160000],
        ["Metal Shelf (4 Shelves)", "Fabrication", 220000, 120000],
        ["Trailer Chassis", "Fabrication", 1200000, 750000],
        ["Steel Table Frame", "Fabrication", 180000, 100000],
        ["Grill (BBQ Stand)", "Fabrication", 250000, 140000],
        ["Welding (per hour)", "Service", 45000, 15000, "hour"],
        ["Cutting (per metre)", "Service", 25000, 8000, "metre"],
        ["Gas Refill (LPG)", "Service", 70000, 55000],
        ["Repair of Broken Frame", "Service", 45000, 15000],
    ],

    cleaning: [
        ["House Cleaning (per visit)", "Residential", 35000, 12000, "visit"],
        ["Deep Cleaning (per visit)", "Residential", 70000, 25000, "visit"],
        ["Office Cleaning (per visit)", "Commercial", 60000, 20000, "visit"],
        ["Window Cleaning (per floor)", "Residential", 15000, 5000, "floor"],
        ["Carpet Shampooing (per room)", "Specialist", 40000, 15000, "room"],
        ["Sofa Shampooing (per seat)", "Specialist", 25000, 10000, "seat"],
        ["Mattress Cleaning (Single)", "Specialist", 35000, 15000],
        ["Bathroom Deep Clean", "Specialist", 30000, 10000, "room"],
        ["Kitchen Deep Clean", "Specialist", 35000, 12000, "room"],
        ["Lawn Mowing (per visit)", "Outdoor", 30000, 10000, "visit"],
        ["Hedge Trimming (per visit)", "Outdoor", 35000, 12000, "visit"],
        ["Waste Disposal (per trip)", "Outdoor", 30000, 12000, "trip"],
        ["Hand Wash 500ml", "Supplies", 3500, 2200],
        ["Disinfectant 1L", "Supplies", 12000, 7000],
        ["Bleach 1L", "Supplies", 8000, 4500],
        ["Cleaning Gloves (Pair)", "Supplies", 5000, 2500, "pair"],
        ["Vacuum Cleaner 20L", "Equipment", 150000, 100000],
    ],

    fitness: [
        ["Gym Membership (Monthly)", "Membership", 100000, 0, "month"],
        ["Gym Membership (Quarterly)", "Membership", 270000, 0, "quarter"],
        ["Gym Membership (Annual)", "Membership", 950000, 0, "year"],
        ["Locker Rental (Monthly)", "Membership", 30000, 0, "month"],
        ["Personal Training (per session)", "Training", 60000, 15000, "session"],
        ["Aerobics Class (per session)", "Classes", 20000, 5000, "session"],
        ["Yoga Class (per session)", "Classes", 25000, 7000, "session"],
        ["Spin Class (per session)", "Classes", 22000, 6000, "session"],
        ["Kickboxing Class (per session)", "Classes", 28000, 8000, "session"],
        ["Sauna Session", "Recreation", 30000, 8000, "session"],
        ["Massage (30 min)", "Massage", 50000, 15000],
        ["Sportswear T-Shirt", "Retail", 35000, 20000],
        ["Gym Towel", "Retail", 20000, 10000],
        ["Water Bottle 1L", "Retail", 12000, 6000],
    ],

    /* ───────────────────────── Education & Books ─────────────────────────── */
    bookshop: [
        ["Primary 4 Learner's Book", "Textbooks", 28000, 22000],
        ["Senior 2 Learner's Book", "Textbooks", 32000, 25000],
        ["Exercise Book (40 pages)", "Stationery", 3500, 2500],
        ["Exercise Book (80 pages)", "Stationery", 5500, 4000],
        ["Ballpoint Pen (Box of 12)", "Stationery", 6000, 4000],
        ["HB Pencil (Box of 12)", "Stationery", 5000, 3200],
        ["Ruler 30cm", "Stationery", 2500, 1500],
        ["Geometry Set", "Stationery", 12000, 8000],
        ["A4 Notebook (100 pages)", "Stationery", 8000, 5500],
        ["The River and the Source", "Novels", 45000, 32000],
        ["Animal Farm", "Novels", 25000, 17000],
        ["Atlas (Secondary)", "Reference", 55000, 40000],
        ["Dictionary (English)", "Reference", 45000, 32000],
        ["Past Paper (Primary 7)", "Revision", 15000, 10000],
    ],

    stationery: [
        ["Exercise Book (40 pages)", "Exercise Books", 3500, 2500],
        ["Exercise Book (80 pages)", "Exercise Books", 5500, 4000],
        ["A4 Notebook (100 pages)", "Notebooks", 8000, 5500],
        ["Ballpoint Pen (Box of 12)", "Pens", 6000, 4000],
        ["HB Pencil (Box of 12)", "Pencils", 5000, 3200],
        ["Highlighters (Box of 4)", "Pens", 9000, 6000],
        ["Crayons (Box of 12)", "Art", 8000, 5500],
        ["Coloured Pencils (Box of 12)", "Art", 12000, 8000],
        ["Eraser (Box of 10)", "Stationery", 4000, 2500],
        ["Sharpener (Box of 5)", "Stationery", 4500, 2800],
        ["Ruler 30cm", "Stationery", 2500, 1500],
        ["Glue Stick", "Stationery", 3500, 2200],
        ["Scissors (School)", "Stationery", 5000, 3200],
        ["File Folder", "Stationery", 4500, 2800],
        ["Stapler", "Stationery", 9000, 6000],
        ["Pencil Case", "School Bags", 12000, 8000],
        ["School Bag (16 inch)", "School Bags", 45000, 32000],
        ["Backpack (Laptop)", "School Bags", 85000, 62000],
    ],

    printing: [
        ["A4 Paper Ream (500 sheets)", "Paper", 32000, 26000, "ream"],
        ["Photocopy (per page)", "Copying", 200, 50],
        ["Printing B&W (per page)", "Printing", 500, 150],
        ["Printing Colour (per page)", "Printing", 1500, 600],
        ["Business Card Printing (100 pcs)", "Cards", 35000, 12000],
        ["Banner Printing (per sqm)", "Banners", 15000, 6000, "sqm"],
        ["T-Shirt Printing (per shirt)", "Apparel", 15000, 5000],
        ["Mug Sublimation (per piece)", "Gifts", 15000, 6000],
        ["Cap Embroidery (per cap)", "Apparel", 12000, 5000],
        ["Poster Printing (A2)", "Posters", 8000, 3000],
        ["Photo Lamination (A4)", "Finishing", 3000, 1000],
        ["Spiral Binding (per copy)", "Finishing", 4000, 1500],
        ["Graphic Design (per hour)", "Design", 50000, 20000, "hour"],
        ["HP Toner Cartridge", "Printing Supplies", 185000, 150000],
        ["Ink Cartridge (Colour)", "Printing Supplies", 220000, 180000],
    ],

    education: [
        ["Primary 4 Learner's Book", "Textbooks", 28000, 22000],
        ["Senior 2 Learner's Book", "Textbooks", 32000, 25000],
        ["Exercise Book (40 pages)", "Stationery", 3500, 2500],
        ["Ballpoint Pen (Box of 12)", "Stationery", 6000, 4000],
        ["Geometrical Set", "Stationery", 15000, 10000],
        ["Past Paper (Primary 7)", "Revision", 15000, 10000],
        ["Printed Notes (per course)", "Printing", 25000, 8000],
        ["Student ID Card", "Admin", 5000, 1500],
        ["School Fees Receipt", "Admin", 1000, 200],
        ["Registration Form", "Admin", 2000, 500],
        ["Online Course (Certificate)", "Programmes", 150000, 60000],
        ["Tuition (Monthly)", "Tuition", 200000, 0, "month"],
    ],

    driving_school: [
        ["Theory Course", "Courses", 150000, 0],
        ["Practical Course (10 Lessons)", "Courses", 600000, 0],
        ["Beginner Package (Theory + 10 Lessons)", "Packages", 700000, 0],
        ["Advanced Course (Reverse Parking)", "Courses", 350000, 0],
        ["Motorway Training", "Courses", 300000, 0],
        ["Simulator Session", "Courses", 50000, 0, "session"],
        ["Instructor (Extra Lesson)", "Courses", 80000, 0, "lesson"],
        ["Driving Permit (3 Months)", "Admin", 50000, 0],
        ["ID Card Printing", "Admin", 10000, 3000],
        ["Theory Workbook", "Materials", 15000, 8000],
        ["Road Signs Manual", "Materials", 20000, 10000],
        ["Student T-Shirt", "Merchandise", 30000, 15000],
        ["Test Car Fuel (per lesson)", "Costs", 20000, 0, "lesson"],
        ["Certificate Printing", "Admin", 5000, 1000],
    ],

    /* ─────────────────────────────── Events ──────────────────────────────── */
    event: [
        ["Marquee (per 100 sqm)", "Venue", 900000, 400000, "sqm"],
        ["Tent 6x6m", "Venue", 450000, 220000],
        ["Plastic Chairs (per piece)", "Furniture", 5000, 2500],
        ["Round Tables (per piece)", "Furniture", 45000, 22000],
        ["Tent Decoration", "Decoration", 450000, 200000],
        ["Balloon Arch", "Decoration", 250000, 100000],
        ["Catering (per plate)", "Catering", 25000, 12000],
        ["Stage 12x12 ft", "Equipment", 750000, 350000],
        ["Sound System (DJ)", "Equipment", 500000, 250000],
        ["Generator (per day)", "Equipment", 250000, 150000, "day"],
        ["Lighting (per set)", "Equipment", 300000, 150000],
        ["Photography (per event)", "Services", 650000, 250000],
        ["MC Services", "Services", 350000, 150000],
        ["Invitation Cards (per 100)", "Printing", 45000, 20000],
        ["Flower Bouquet", "Decoration", 40000, 20000],
    ],

    photography: [
        ["Studio Portrait Session", "Sessions", 150000, 50000],
        ["Family Photography (Outdoor)", "Sessions", 350000, 120000],
        ["Pre-wedding Shoot", "Sessions", 500000, 180000],
        ["Wedding Photography (per day)", "Weddings", 1500000, 500000, "day"],
        ["Video Shoot (per hour)", "Video", 250000, 90000, "hour"],
        ["Photo Album (20 pages)", "Products", 150000, 80000],
        ["Canvas Print (A2)", "Products", 75000, 35000],
        ["Photo Frame (A3)", "Products", 45000, 22000],
        ["Photo Print (per copy)", "Printing", 2000, 600],
        ["Passport Photo (per set)", "Studio", 25000, 8000],
        ["Banner Print (per sqm)", "Printing", 15000, 6000, "sqm"],
        ["Roll of Film (36)", "Consumables", 25000, 15000],
        ["SD Card 64GB", "Equipment", 22000, 14000],
        ["Tripod", "Equipment", 85000, 55000],
        ["Studio Lighting Kit", "Equipment", 250000, 160000],
    ],

    /* ──────────────────────────── Property & Money ──────────────────────── */
    realestate: [
        ["Residential Plot (50x100)", "Land", 45000000, 0, "plot"],
        ["Residential House (2 Bedroom)", "Property", 120000000, 0, "house"],
        ["Commercial Land (1 Acre)", "Land", 90000000, 0, "acre"],
        ["Agricultural Land (2 Acres)", "Land", 60000000, 0, "acre"],
        ["Industrial Land (1/2 Acre)", "Land", 75000000, 0, "acre"],
        ["Rental House (1 Bedroom)", "Property", 45000000, 0, "house"],
        ["Rent: 1 Bedroom (Monthly)", "Rental", 700000, 0, "month"],
        ["Rent: 2 Bedroom (Monthly)", "Rental", 1200000, 0, "month"],
        ["Rent: Commercial Shop (Monthly)", "Rental", 2500000, 0, "month"],
        ["Rent: Office Space (Monthly)", "Rental", 3500000, 0, "month"],
        ["Legal / Valuation Fee", "Fees", 1500000, 0],
        ["Title Search Fee", "Fees", 350000, 0],
        ["Plot Survey Fee", "Fees", 500000, 0],
        ["Transfer Fee", "Fees", 1000000, 0],
    ],

    sacco: [
        ["Savings Deposit (per member)", "Savings", 50000, 0],
        ["Monthly Savings Plan", "Savings", 50000, 0, "month"],
        ["Withdrawal (per member)", "Savings", 50000, 0],
        ["Share Capital (per member)", "Shares", 100000, 0],
        ["Loan (Term 12 months)", "Lending", 3000000, 0],
        ["Emergency Loan (Term 6 months)", "Lending", 1200000, 0],
        ["Group Loan", "Lending", 5000000, 0],
        ["Loan Processing Fee", "Fees", 50000, 0],
        ["Passbook", "Admin", 5000, 1500],
        ["Statement of Account", "Admin", 3000, 800],
        ["Mobile Money Deposit", "Payments", 50000, 0],
        ["Interest on Savings", "Interest", 50000, 0],
    ],

    ngo: [
        ["Emergency Water (per 20L)", "Relief", 12000, 8000, "jerrycan"],
        ["Blanket (Fleece)", "Relief", 35000, 20000],
        ["Cooking Oil 5L", "Relief", 145000, 128000],
        ["Maize Flour 50kg (Bag)", "Relief", 165000, 140000, "bag"],
        ["Sanitary Pads (Packet of 10)", "Relief", 12000, 8500],
        ["Soap (Bar)", "Relief", 3500, 2500],
        ["School Bag", "Relief", 45000, 32000],
        ["School Shoe (Pair)", "Relief", 55000, 38000, "pair"],
        ["Mosquito Net", "Relief", 25000, 15000],
        ["Nutrition Pack (30 days)", "Relief", 180000, 120000],
        ["Medicine (Essential Pack)", "Health", 85000, 55000],
        ["Solar Lantern", "Relief", 45000, 28000],
        ["Tarp 4x6m", "Shelter", 60000, 40000],
        ["Cash Transfer (per household)", "Cash", 150000, 0, "household"],
    ],

    church: [
        ["Tithe (per envelope)", "Giving", 50000, 0],
        ["Offering (per envelope)", "Giving", 20000, 0],
        ["Church Bible", "Books", 45000, 30000],
        ["Hymn Book", "Books", 12000, 8000],
        ["Prayer Notebook", "Books", 6000, 3500],
        ["Sunday School Book", "Books", 8000, 4500],
        ["T-Shirt (Branded)", "Merchandise", 30000, 15000],
        ["Cap (Branded)", "Merchandise", 20000, 9000],
        ["Water Bottle (Branded)", "Merchandise", 12000, 6000],
        ["Candles (Box of 12)", "Supplies", 10000, 6000],
        ["Communion Cups (Box of 100)", "Supplies", 8000, 4500],
        ["Baptism Robe (White)", "Supplies", 35000, 18000],
    ],

    security: [
        ["Guard Post (24 hours)", "Services", 450000, 0, "day"],
        ["Guard Post (12 hours)", "Services", 280000, 0, "day"],
        ["Static Guard (Monthly)", "Services", 700000, 0, "month"],
        ["Armed Guard (Monthly)", "Services", 1200000, 0, "month"],
        ["Dog Handler (Monthly)", "Services", 900000, 0, "month"],
        ["CCTV Installation (4 Cameras)", "Installation", 2500000, 1500000],
        ["CCTV Installation (8 Cameras)", "Installation", 4500000, 2700000],
        ["CCTV Maintenance (Monthly)", "Maintenance", 250000, 0, "month"],
        ["Alarm System Installation", "Installation", 1200000, 700000],
        ["Electric Fence Installation (per metre)", "Installation", 35000, 20000, "metre"],
        ["Electric Fence Repair (per metre)", "Maintenance", 25000, 12000, "metre"],
        ["Access Control Installation", "Installation", 1800000, 1000000],
        ["Security Camera (Single)", "Equipment", 250000, 150000],
        ["Backup Battery (for Alarm)", "Equipment", 350000, 220000],
        ["Radio Walkie Talkie", "Equipment", 150000, 95000],
    ],

    shoes: [
        ["Mens Leather Shoes (Size 42)", "Shoes", 145000, 105000, "pair"],
        ["Ladies Sandals", "Shoes", 55000, 38000, "pair"],
        ["Ladies Heels", "Shoes", 85000, 60000, "pair"],
        ["Ladies Flat Shoes", "Shoes", 65000, 45000, "pair"],
        ["Mens Sports Shoes", "Shoes", 120000, 85000, "pair"],
        ["Kids Sneakers", "Shoes", 45000, 32000, "pair"],
        ["School Shoes (Pair)", "Shoes", 55000, 38000, "pair"],
        ["Boots (Pair)", "Shoes", 135000, 95000, "pair"],
        ["Slippers (Pair)", "Shoes", 22000, 13000, "pair"],
        ["Shoe Polish", "Care", 6000, 3000],
        ["Shoe Brush", "Care", 5000, 2500],
        ["Shoe Rack (Metal)", "Care", 85000, 55000],
        ["Socks (Pair)", "Accessories", 6000, 3000, "pair"],
        ["Shoe Bag", "Accessories", 15000, 8000],
    ],
};

/**
 * The catalogue a trade gets when it has no catalogue of its own.
 *
 * A trade SMART_BUZ does not know yet still gets a shop full of real goods
 * rather than an empty one — the demo is never a blank screen.
 */
export const MOCK_FALLBACK_CATALOGUE: MockRow[] = [
    ["Rwenzori Water 500ml", "Beverages", 1500, 900],
    ["Coca-Cola 350ml", "Beverages", 2000, 1500],
    ["Colgate Toothpaste 100ml", "Personal Care", 8000, 5500],
    ["Beauty Soap 400g", "Soap", 3500, 2500],
    ["Nokidezi Sugar 1kg", "Groceries", 7000, 6000],
    ["Mukwano Cooking Oil 1L", "Groceries", 28000, 24000],
    ["Bread (Tastoz) 500g", "Bakery", 3500, 2600],
    ["Eggs (Tray of 30)", "Dairy", 15000, 12000],
    ["Rice 1kg", "Grains", 9000, 7500],
    ["Onions 1kg", "Vegetables", 4000, 3000],
    ["Note Book (40 pages)", "Stationery", 3500, 2500],
    ["Ballpoint Pen (Box of 12)", "Stationery", 6000, 4000],
    ["Toilet Roll (2 pieces)", "Household", 6000, 4200],
    ["Dish Washing Liquid 1L", "Household", 7500, 5200],
    ["Airtel Airtime (UGX 1000)", "Airtime", 1000, 1000],
    ["Phone Charger (Type C)", "Accessories", 15000, 9000],
];

/**
 * The catalogue for one trade, as plain products.
 *
 * An unknown trade gets the fallback catalogue; a known trade gets its own.
 */
export function mockCatalogueFor(categoryId: string | undefined): MockProduct[] {
    const rows = (categoryId && MOCK_CATALOGUES[categoryId]) || MOCK_FALLBACK_CATALOGUE;
    return rows.map(([name, category, price, purchasePrice, unit]) => ({
        name,
        category,
        price,
        purchasePrice,
        unit,
    }));
}

/** A product of the mock catalogue, in the shape the seeder works with. */
export interface MockProduct {
    name: string;
    category: string;
    price: number;
    purchasePrice: number;
    unit?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The rest of the mock world
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The customers the demo shop has served.
 *
 * A shop's customers are people, not rows: a name a Ugandan would answer
 * to, a number in the 07xx/07xxxxxxxx form Uganda actually uses, and a
 * place they live.
 */
export const MOCK_CUSTOMERS: Array<{
    name: string;
    phone: string;
    email?: string;
    address?: string;
    type?: string;
    creditLimit?: number;
}> = [
    { name: "Nakato Sarah", phone: "0772103344", address: "Kisubi, Wakiso", type: "retail" },
    { name: "Mwangi Peter", phone: "0703345566", address: "Ntinda, Kampala", type: "retail" },
    { name: "Namukasa Grace", phone: "0781234567", address: "Kawempe, Kampala", type: "retail" },
    { name: "Okello James", phone: "0755443322", address: "Makindye, Kampala", type: "retail" },
    { name: "Nakintu Brenda", phone: "0709988776", address: "Gulu Town", type: "retail" },
    { name: "Ssekandi David", phone: "0776655443", address: "Jinja Main Street", type: "retail" },
    { name: "Nakimera Alice", phone: "0752110099", address: "Mbarara Town", type: "retail" },
    { name: "Waiswa Joseph", phone: "0783344556", address: "Entebbe", type: "retail" },
    { name: "Nakato Kenneth", phone: "0702233445", address: "Kololo, Kampala", type: "retail" },
    { name: "Mukiibi Rose", phone: "0774455667", address: "Buikwe, Wakiso", type: "retail" },
    { name: "Kirunda Daniel", phone: "0758877665", address: "Masaka Town", type: "retail" },
    { name: "Namusoke Faith", phone: "0701122334", address: "Nansana, Wakiso", type: "retail" },
];

/**
 * The distributors a trading business buys from and sells to.
 *
 * These carry a custom receipt number, because that is what a distributor's
 * receipt is matched on.
 */
export const MOCK_DISTRIBUTORS: Array<{
    name: string;
    phone: string;
    email: string;
    distributorId: string;
    address: string;
}> = [
    {
        name: "Kato Joseph",
        phone: "0771112233",
        email: "kato@harbourdistributors.example",
        distributorId: "UG00112233",
        address: "Katwe, Kampala",
    },
    {
        name: "Nabaasa Sarah",
        phone: "0755443322",
        email: "sarah@harbourdistributors.example",
        distributorId: "UG44556677",
        address: "High Street, Mbarara",
    },
    {
        name: "Mukasa David",
        phone: "0700112233",
        email: "david@harbourdistributors.example",
        distributorId: "UG99887766",
        address: "Abayita Ababiri, Entebbe",
    },
    {
        name: "Atuhaire Peace",
        phone: "0788990011",
        email: "peace@harbourdistributors.example",
        distributorId: "UG11224455",
        address: "Gulu Main Street",
    },
];

/**
 * The suppliers the demo business buys from.
 *
 * `paymentTerms` is what makes a purchase order mean something: "Net 30"
 * says the invoice is due in a month's time.
 */
export const MOCK_SUPPLIERS: Array<{
    name: string;
    contact: string;
    phone: string;
    email: string;
    address: string;
    paymentTerms: string;
    paymentTermsDays: number;
}> = [
    {
        name: "Harbour Distributors Ltd",
        contact: "Samuel Okello",
        phone: "0414000111",
        email: "sales@harbourdistributors.example",
        address: "Plot 4, Industrial Area, Kampala",
        paymentTerms: "Net 30",
        paymentTermsDays: 30,
    },
    {
        name: "Kampala Wholesale Supplies",
        contact: "Betty Nakato",
        phone: "0772110099",
        email: "info@kampalawholesale.example",
        address: "Nakivubo, Kampala",
        paymentTerms: "Net 14",
        paymentTermsDays: 14,
    },
    {
        name: "Rwenzori Traders",
        contact: "Patrick Mugisha",
        phone: "0755443322",
        email: "orders@rwenzoritraders.example",
        address: "Plot 12, Mbarara",
        paymentTerms: "Net 30",
        paymentTermsDays: 30,
    },
    {
        name: "BrightChem Uganda",
        contact: "Dr. Anita Kizito",
        phone: "0781234567",
        email: "sales@brightchem.example",
        address: "Ntinda Industrial Park, Kampala",
        paymentTerms: "Net 14",
        paymentTermsDays: 14,
    },
    {
        name: "Metro Hardware Depot",
        contact: "Joseph Kiwanuka",
        phone: "0758877665",
        email: "depot@metrohardware.example",
        address: "Kira Road, Wakiso",
        paymentTerms: "Net 30",
        paymentTermsDays: 30,
    },
];

/**
 * The kinds of expense a business actually has.
 *
 * These are the categories the expenditures screen offers, so the demo
 * expenses sort and filter the way a real book does.
 */
export const MOCK_EXPENSE_TYPES = [
    "Rent",
    "Utilities",
    "Salaries",
    "Office Supplies",
    "Transportation",
    "Marketing",
    "Maintenance",
    "Training",
    "Miscellaneous",
    "Others",
] as const;

/**
 * A plausible expense of each kind, in Ugandan shillings.
 *
 * These are the fixed monthly costs of a Kampala shop — rent, power, the
 * staff on the floor — so the profit figures the demo shows are the shape a
 * real month has.
 */
export const MOCK_EXPENSE_AMOUNTS: Record<string, number[]> = {
    Rent: [450000, 450000, 450000],
    Utilities: [85000, 62000, 98000],
    Salaries: [1200000, 1200000, 1200000],
    "Office Supplies": [35000, 22000, 48000],
    Transportation: [60000, 45000, 75000],
    Marketing: [150000, 90000, 220000],
    Maintenance: [75000, 40000, 95000],
    Training: [200000, 150000],
    Miscellaneous: [25000, 18000, 40000],
    Others: [30000, 12000],
};

/**
 * The payments a Kampala shop actually takes.
 *
 * Mobile money is the commonest, because in Uganda it is — the phone is not
 * far behind the cash. A card is rare, and a bank transfer rarer still.
 */
export const MOCK_PAYMENT_MODES = [
    "Cash",
    "Mobile Money",
    "Mobile Money",
    "Cash",
    "Mobile Money",
    "Cash",
    "Bank Transfer",
    "Mobile Money",
    "Cash",
    "Card",
];

/**
 * The trades that sell to distributors rather than to the public.
 */
const WHOLESALE_TRADES = new Set(["wholesale", "agro", "farming", "sacco"]);

/**
 * The client types a sale is recorded under.
 *
 * A retail shop sells to retail; a wholesaler sells to distributors. The
 * pool follows the trade, so the demo's books read the way that trade's
 * books read.
 */
export function mockClientTypesFor(categoryId: string | undefined): string[] {
    if (categoryId && WHOLESALE_TRADES.has(categoryId)) {
        return ["Distributor", "Distributor", "Wholesale", "Retail"];
    }
    return ["Retail", "Retail", "Retail", "Retail", "Wholesale"];
}
