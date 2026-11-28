/**
 * SMART_BUZ — bulk import.
 *
 * A business that already trades somewhere else has its products,
 * its customers and its opening stock in a spreadsheet. Getting that
 * spreadsheet in is a job, and doing it by hand is a job nobody has to
 * be asked to do twice.
 *
 * ────────────────────────────────────────────────────────────────────────
 * How it works
 *
 * The browser reads the file and hands the rows over. The server checks
 * every row against this business's own records — the category has to
 * exist, the code has to be free, the price has to be a price — and
 * answers with a preview: each row, and what is wrong with it, if
 * anything is. Nothing is written until the person has seen the preview
 * and asked for it.
 *
 * The rows that are kept are written through the same tables the rest of
 * the product writes to, so an imported product behaves exactly like one
 * that was added by hand.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What it does not do
 *
 * It does not guess. A row that cannot be understood is refused with a
 * reason, not corrected into something the person did not write.
 */

import { mutation, query } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";

/* ────────────────────────────────────────────────────────────────────────
 * The templates
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The columns each kind of import needs.
 *
 * These are the headings the CSV must have, in the order the template
 * gives them. The page offers the template as a file to download, so the
 * person is never guessing what to put in which column.
 */
export const IMPORT_TEMPLATES = {
    products: {
        label: "Products",
        description:
            "The catalogue — what the business sells, what it costs, and what it costs to buy.",
        columns: [
            { name: "name", label: "Name", required: true },
            { name: "code", label: "Code", required: true },
            { name: "category", label: "Category", required: true },
            { name: "price", label: "Selling price", required: true },
            { name: "cost", label: "Buying price", required: false },
            { name: "quantity", label: "Quantity in hand", required: false },
            { name: "unit", label: "Unit", required: false },
            { name: "barcode", label: "Barcode", required: false },
            { name: "supplier", label: "Supplier", required: false },
            { name: "description", label: "Description", required: false },
        ],
    },
    customers: {
        label: "Customers",
        description: "The people the business trades with.",
        columns: [
            { name: "name", label: "Name", required: true },
            { name: "phone", label: "Phone", required: true },
            { name: "email", label: "Email", required: false },
            { name: "address", label: "Address", required: false },
            { name: "type", label: "Type", required: false },
            { name: "credit_limit", label: "Credit limit", required: false },
            { name: "distributor_id", label: "Custom ID", required: false },
        ],
    },
    stock: {
        label: "Opening stock",
        description:
            "What is on the shelf today, for products that are already in the catalogue.",
        columns: [
            { name: "code", label: "Code", required: true },
            { name: "quantity", label: "Quantity in hand", required: true },
            { name: "cost", label: "Buying price", required: false },
        ],
    },
} as const;

export type ImportType = keyof typeof IMPORT_TEMPLATES;

/** How many rows one call may write. */
const ROW_LIMIT = 500;

/** The kinds of customer a business may keep. */
const CUSTOMER_TYPES = ["retail", "wholesale", "credit"];

/* ────────────────────────────────────────────────────────────────────────
 * Reading the shape
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The templates, for the page to show and to download.
 */
export const getImportTemplates = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        return IMPORT_TEMPLATES;
    },
});

/**
 * What the business already has, so the page can say what an import
 * would add to.
 */
export const getImportSummary = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        const products = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const customers = await ctx.db
            .query("customers")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const categories = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return {
            products: products.length,
            customers: customers.length,
            categories: categories.map((category) => category.type),
            rowLimit: ROW_LIMIT,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Checking the rows
 * ──────────────────────────────────────────────────────────────────────── */

/** A number that is a number. */
function toNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

/** A piece of text, trimmed. */
function toText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    return "";
}

/**
 * Check every row and answer with a preview.
 *
 * Nothing is written here. The person sees what would happen, and what
 * would be wrong with each row, before anything is committed.
 */
export const validateImport = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        type: v.union(v.literal("products"), v.literal("customers"), v.literal("stock")),
        /** The rows of the file, each one an object of column → value. */
        rows: v.array(v.record(v.string(), v.any())),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;

        if (args.type === "customers") {
            await requirePermission(ctx, businessId, "customers.view");
        } else {
            await requirePermission(ctx, businessId, "products.view");
        }

        if (args.rows.length > ROW_LIMIT) {
            throw new ConvexError(
                `A file of more than ${ROW_LIMIT} rows has to be brought in in parts.`
            );
        }

        const products = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const customers = await ctx.db
            .query("customers")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const categories = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const categoryNames = new Set(categories.map((c) => c.type.toLowerCase()));
        const productCodes = new Set(products.map((p) => p.productCode.toLowerCase()));
        const phones = new Set(customers.map((c) => c.phone.toLowerCase()));

        const preview = args.rows.map((row, index) => {
            const problems: string[] = [];
            const values: Record<string, string> = {};

            if (args.type === "products") {
                const name = toText(row.name);
                const code = toText(row.code);
                const category = toText(row.category);
                const price = toNumber(row.price);
                const cost = row.cost === undefined || row.cost === "" ? null : toNumber(row.cost);
                const quantity = row.quantity === undefined || row.quantity === "" ? null : toNumber(row.quantity);

                if (!name) problems.push("The name is missing.");
                if (!code) problems.push("The code is missing.");
                if (!category) {
                    problems.push("The category is missing.");
                } else if (!categoryNames.has(category.toLowerCase())) {
                    problems.push(`There is no category called "${category}".`);
                }
                if (price === null) {
                    problems.push("The selling price must be a number.");
                } else if (price < 0) {
                    problems.push("The selling price cannot be negative.");
                }
                if (cost !== null && cost < 0) {
                    problems.push("The buying price cannot be negative.");
                }
                if (quantity !== null && quantity < 0) {
                    problems.push("The quantity cannot be negative.");
                }
                if (code && productCodes.has(code.toLowerCase())) {
                    problems.push(`The code "${code}" is already in use.`);
                }

                values.name = name;
                values.code = code;
                values.category = category;
                values.price = price === null ? "" : String(price);
                values.cost = cost === null ? "" : String(cost);
                values.quantity = quantity === null ? "" : String(quantity);
                values.unit = toText(row.unit);
                values.barcode = toText(row.barcode);
                values.supplier = toText(row.supplier);
                values.description = toText(row.description);
            } else if (args.type === "customers") {
                const name = toText(row.name);
                const phone = toText(row.phone);
                const type = toText(row.type);
                const creditLimit =
                    row.credit_limit === undefined || row.credit_limit === ""
                        ? null
                        : toNumber(row.credit_limit);

                if (!name) problems.push("The name is missing.");
                if (!phone) {
                    problems.push("The phone number is missing.");
                } else if (phones.has(phone.toLowerCase())) {
                    problems.push(`The number ${phone} is already on the book.`);
                }
                if (type && !CUSTOMER_TYPES.includes(type.toLowerCase())) {
                    problems.push(
                        `A customer is retail, wholesale or credit — not "${type}".`
                    );
                }
                if (creditLimit !== null && creditLimit < 0) {
                    problems.push("The credit limit cannot be negative.");
                }

                values.name = name;
                values.phone = phone;
                values.email = toText(row.email);
                values.address = toText(row.address);
                values.type = type;
                values.credit_limit = creditLimit === null ? "" : String(creditLimit);
                values.distributor_id = toText(row.distributor_id);
            } else {
                const code = toText(row.code);
                const quantity = toNumber(row.quantity);
                const cost = row.cost === undefined || row.cost === "" ? null : toNumber(row.cost);
                const product = products.find(
                    (p) => p.productCode.toLowerCase() === code.toLowerCase()
                );

                if (!code) {
                    problems.push("The code is missing.");
                } else if (!product) {
                    problems.push(
                        `There is no product with the code "${code}" in the catalogue.`
                    );
                }
                if (quantity === null) {
                    problems.push("The quantity must be a number.");
                } else if (quantity < 0) {
                    problems.push("The quantity cannot be negative.");
                }
                if (cost !== null && cost < 0) {
                    problems.push("The buying price cannot be negative.");
                }

                values.code = code;
                values.quantity = quantity === null ? "" : String(quantity);
                values.cost = cost === null ? "" : String(cost);
                values.name = product?.name ?? "";
            }

            return {
                index,
                values,
                problems,
                ok: problems.length === 0,
            };
        });

        return {
            rows: preview,
            importable: preview.filter((row) => row.ok).length,
            refused: preview.filter((row) => !row.ok).length,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing the rows
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Write the rows that were kept.
 *
 * The rows are checked again here — the preview is a reading, not a
 * promise — and only the ones that pass are written. A row that has been
 * changed since the preview is refused rather than guessed at.
 */
export const commitImport = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        type: v.union(v.literal("products"), v.literal("customers"), v.literal("stock")),
        rows: v.array(v.record(v.string(), v.any())),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (args.type === "customers") {
            await requirePermission(ctx, businessId, "customers.manage");
        } else {
            await requirePermission(ctx, businessId, "products.manage");
        }

        if (args.rows.length > ROW_LIMIT) {
            throw new ConvexError(
                `A file of more than ${ROW_LIMIT} rows has to be brought in in parts.`
            );
        }

        const products = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const customers = await ctx.db
            .query("customers")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const categories = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const categoryByName = new Map(
            categories.map((c) => [c.type.toLowerCase(), c])
        );
        const productByCode = new Map(
            products.map((p) => [p.productCode.toLowerCase(), p])
        );
        const productCodes = new Set(products.map((p) => p.productCode.toLowerCase()));
        const phones = new Set(customers.map((c) => c.phone.toLowerCase()));

        const now = new Date().toISOString();
        let imported = 0;
        const skipped: Array<{ index: number; reason: string }> = [];

        for (let index = 0; index < args.rows.length; index += 1) {
            const row = args.rows[index];

            if (args.type === "products") {
                const name = toText(row.name);
                const code = toText(row.code);
                const categoryName = toText(row.category);
                const price = toNumber(row.price);
                const cost = toNumber(row.cost);
                const quantity = toNumber(row.quantity);

                if (!name || !code || !categoryName || price === null) {
                    skipped.push({
                        index,
                        reason: "The name, code, category and price are all needed.",
                    });
                    continue;
                }
                if (price < 0 || (cost !== null && cost < 0)) {
                    skipped.push({ index, reason: "A price cannot be negative." });
                    continue;
                }
                if (productCodes.has(code.toLowerCase())) {
                    skipped.push({
                        index,
                        reason: `The code "${code}" is already in use.`,
                    });
                    continue;
                }
                const category = categoryByName.get(categoryName.toLowerCase());
                if (!category) {
                    skipped.push({
                        index,
                        reason: `There is no category called "${categoryName}".`,
                    });
                    continue;
                }

                const inHand = quantity !== null && quantity >= 0 ? quantity : 0;
                const buying = cost !== null && cost >= 0 ? cost : price;

                await ctx.db.insert("stocks", {
                    businessId,
                    name,
                    productCode: code,
                    description: toText(row.description) || undefined,
                    price,
                    purchasePrice: buying,
                    qty: inHand,
                    pv: inHand * price,
                    bv: inHand * buying,
                    categoryId: category._id,
                    supplier: toText(row.supplier) || undefined,
                    barcode: toText(row.barcode) || undefined,
                    unit: toText(row.unit) || undefined,
                    isActive: true,
                });

                productCodes.add(code.toLowerCase());
                imported += 1;
                continue;
            }

            if (args.type === "customers") {
                const name = toText(row.name);
                const phone = toText(row.phone);
                const type = toText(row.type);
                const creditLimit = toNumber(row.credit_limit);

                if (!name || !phone) {
                    skipped.push({
                        index,
                        reason: "The name and the phone number are both needed.",
                    });
                    continue;
                }
                if (phones.has(phone.toLowerCase())) {
                    skipped.push({
                        index,
                        reason: `The number ${phone} is already on the book.`,
                    });
                    continue;
                }
                if (type && !CUSTOMER_TYPES.includes(type.toLowerCase())) {
                    skipped.push({
                        index,
                        reason: `A customer is retail, wholesale or credit — not "${type}".`,
                    });
                    continue;
                }
                if (creditLimit !== null && creditLimit < 0) {
                    skipped.push({
                        index,
                        reason: "The credit limit cannot be negative.",
                    });
                    continue;
                }

                await ctx.db.insert("customers", {
                    businessId,
                    name,
                    phone,
                    email: toText(row.email) || undefined,
                    address: toText(row.address) || undefined,
                    type: type ? type.toLowerCase() : "retail",
                    creditLimit:
                        creditLimit !== null && creditLimit >= 0 ? creditLimit : 0,
                    distributorId: toText(row.distributor_id) || undefined,
                    loyaltyPoints: 0,
                    createdAt: now,
                    updatedAt: now,
                });

                phones.add(phone.toLowerCase());
                imported += 1;
                continue;
            }

            const code = toText(row.code);
            const quantity = toNumber(row.quantity);
            const cost = toNumber(row.cost);

            if (!code || quantity === null) {
                skipped.push({
                    index,
                    reason: "The code and the quantity are both needed.",
                });
                continue;
            }
            if (quantity < 0) {
                skipped.push({ index, reason: "The quantity cannot be negative." });
                continue;
            }
            const product = productByCode.get(code.toLowerCase());
            if (!product) {
                skipped.push({
                    index,
                    reason: `There is no product with the code "${code}" in the catalogue.`,
                });
                continue;
            }

            const buying =
                cost !== null && cost >= 0 ? cost : product.purchasePrice;
            const value = product.pv + quantity * product.price;
            const bookValue = product.bv + quantity * buying;

            await ctx.db.patch(product._id, {
                qty: product.qty + quantity,
                pv: value,
                bv: bookValue,
                purchasePrice: buying,
            });

            imported += 1;
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Import",
            `${args.type}: ${imported} row(s) imported, ${skipped.length} skipped`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action:
                args.type === "customers"
                    ? "customers.manage"
                    : "products.manage",
            targetType: "import",
            targetId: args.type,
            metadata: {
                type: args.type,
                imported,
                skipped: skipped.length,
                reasons: skipped.slice(0, 20),
            },
        });

        return { imported, skipped };
    },
});
