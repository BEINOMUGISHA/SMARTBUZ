/**
 * SMART_BUZ — registration with a trade and branches, and the personalisation
 * that follows from it.
 *
 * Two things are checked here, and they are the two halves of the same idea:
 *
 *   1. When somebody registers, they choose the trade they are in and where
 *      they trade from. The server builds the whole thing from that choice:
 *      the account, the business, the branches, a warehouse for each branch,
 *      the vertical's own package, the trial, and the new owner's workspace.
 *      The VAT is the server's to decide, not the browser's.
 *
 *   2. After that, the workspace is the *person's* — their screens, their
 *      colour, their landing screen, their spacing, their language — and it
 *      is remembered per business, so the same person in a pharmacy and a
 *      hardware shop gets two different workplaces.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import * as businesses from "../convex/businesses";
import * as preferences from "../convex/userPreferences";
import { hashCode, verifyCode } from "../convex/authCodes";
import { resolveTax } from "../convex/verticals/tax";
import { buildNavigation } from "../src/lib/category-nav";

import {
    FakeContext,
    FakeRow,
    makeBusiness,
    makeMembership,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const CALLER = "users_1";
const BUSINESS = "businesses_1";

/** The shape a Convex handler is registered with. */
type Registered = {
    _handler: (
        ctx: unknown,
        args: Record<string, unknown>
    ) => Promise<unknown> | unknown;
};

/**
 * What a handler returns.
 *
 * The shape depends on the handler, so it is left open here and read at the
 * call site.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type HandlerResult = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Invoke a Convex handler directly, the way the server does.
 */
async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<HandlerResult> {
    const handler = (registered as Registered)._handler;
    return handler(ctx, args);
}

/** The arguments a registration sends. The trade is the important one. */
function registrationArgs(overrides: Record<string, unknown> = {}) {
    return {
        ownerFirstName: "Amina",
        ownerLastName: "Nakato",
        ownerEmail: "amina@example.com",
        password: "Password123!",
        businessName: "Nakato Pharmacy",
        categoryId: "pharmacy",
        currency: "UGX",
        timezone: "Africa/Kampala",
        country: "UG",
        branches: [
            { name: "Main Branch", isDefault: true },
            { name: "Kampala Road Branch" },
        ],
        ...overrides,
    };
}

describe("registering with a trade and branches", () => {
    it("builds the account, the business and the trade in one go", async () => {
        const ctx = new FakeContext();

        const result = await call(businesses.registerWithSetup, ctx, registrationArgs());

        assert.equal(result.branchIds.length, 2);
        assert.equal(result.warehouseIds.length, 2);

        const users = ctx.tables.users;
        assert.equal(users.length, 1);
        assert.equal(users[0].email, "amina@example.com");
        assert.equal(users[0].first_name, "Amina");
        // The account cannot sign in until the address is proved.
        assert.equal(users[0].status, "pending_verification");
        assert.equal(users[0].emailVerified, false);

        const business = ctx.tables.businesses[0];
        assert.equal(business.name, "Nakato Pharmacy");
        assert.equal(business.categoryId, "pharmacy");
        assert.equal(business.businessType, "pharmacy");
        assert.equal(business.currency, "UGX");
        assert.equal(business.timezone, "Africa/Kampala");
        assert.equal(business.onboardingComplete, true);
        assert.equal(business.ownerId, result.userId);
    });

    it("makes the owner the owner of the business", async () => {
        const ctx = new FakeContext();

        const result = await call(businesses.registerWithSetup, ctx, registrationArgs());

        const memberships = ctx.tables.memberships;
        assert.equal(memberships.length, 1);
        assert.equal(memberships[0].userId, result.userId);
        assert.equal(memberships[0].businessId, result.businessId);
        assert.equal(memberships[0].role, "owner");
        assert.equal(memberships[0].status, "active");

        // The owner is also on the staff roll, at the head office.
        const employees = ctx.tables.employees;
        assert.equal(employees.length, 1);
        assert.equal(employees[0].jobTitle, "Owner");
        assert.equal(employees[0].branchId, result.branchIds[0]);
    });

    it("gives every branch its own warehouse and links the two", async () => {
        const ctx = new FakeContext();

        const result = await call(businesses.registerWithSetup, ctx, registrationArgs());

        const branches = ctx.tables.branches;
        assert.equal(branches.length, 2);
        assert.equal(ctx.tables.warehouses.length, 2);

        for (const branch of branches) {
            assert.ok(branch.warehouseId, "a branch must have somewhere to keep stock");
            const warehouse = ctx.tables.warehouses.find(
                (w) => w._id === branch.warehouseId
            );
            assert.ok(warehouse, "the branch's warehouse must exist");
            assert.equal(warehouse.businessId, result.businessId);
        }

        // The warehouses are not shared between the branches.
        assert.notEqual(branches[0].warehouseId, branches[1].warehouseId);
    });

    it("makes the marked branch the head office, and the first one otherwise", async () => {
        const ctx = new FakeContext();

        const result = await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs({
                branches: [
                    { name: "Kampala Road Branch" },
                    { name: "Nakasero Branch", isDefault: true },
                ],
            })
        );

        const branches = ctx.tables.branches;
        assert.equal(branches[0].isDefault, false);
        assert.equal(branches[1].isDefault, true);
        assert.equal(branches[1]._id, result.branchIds[1]);

        // Exactly one branch is the head office, whichever one it is.
        assert.equal(branches.filter((b) => b.isDefault === true).length, 1);
    });

    it("falls back to one branch when the person names none", async () => {
        const ctx = new FakeContext();

        const result = await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs({ branches: [] })
        );

        assert.equal(result.branchIds.length, 1);
        assert.equal(ctx.tables.branches[0].name, "Main Branch");
        assert.equal(ctx.tables.branches[0].isDefault, true);
    });

    it("ignores branches that were left blank", async () => {
        const ctx = new FakeContext();

        const result = await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs({
                branches: [
                    { name: "Main Branch", isDefault: true },
                    { name: "   " },
                ],
            })
        );

        assert.equal(result.branchIds.length, 1);
    });

    it("takes the VAT from the trade, not from the browser", async () => {
        const ctx = new FakeContext();

        await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs({ categoryId: "pharmacy" })
        );

        const business = ctx.tables.businesses[0];
        const expected = resolveTax("pharmacy", { enabled: false, rate: 0 });
        assert.equal(business.taxRate, expected.rate);
        assert.equal(business.taxEnabled, expected.enabled);
        assert.equal(business.taxInclusive, expected.inclusive);
    });

    it("zero-rates a trade that Uganda zero-rates", async () => {
        const ctx = new FakeContext();

        await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs({ categoryId: "agro", businessName: "Nakato Farm" })
        );

        const business = ctx.tables.businesses[0];
        assert.equal(business.taxRate, 0);
        assert.equal(business.taxEnabled, true);
    });

    it("switches the vertical's own package on", async () => {
        const ctx = new FakeContext();

        await call(businesses.registerWithSetup, ctx, registrationArgs());

        const packages = ctx.tables.industryPackages;
        assert.equal(packages.length, 1);
        assert.equal(packages[0].enabled, true);
        assert.equal(packages[0].packageKey, "pharmacy");
    });

    it("starts the trial on a real plan", async () => {
        const ctx = new FakeContext();

        await call(businesses.registerWithSetup, ctx, registrationArgs());

        const subscriptions = ctx.tables.subscriptions;
        assert.equal(subscriptions.length, 1);
        assert.equal(subscriptions[0].status, "trial");
        assert.ok(subscriptions[0].trialEndsAt, "a trial needs an end date");
    });

    it("writes the owner's own workspace, stamped with the trade", async () => {
        const ctx = new FakeContext();

        const result = await call(businesses.registerWithSetup, ctx, registrationArgs());

        const prefs = ctx.tables.userPreferences;
        assert.equal(prefs.length, 1);
        assert.equal(prefs[0].userId, result.userId);
        assert.equal(prefs[0].businessId, result.businessId);
        assert.equal(prefs[0].categoryId, "pharmacy");
        assert.equal(prefs[0].landingModule, "dashboard");
        assert.ok((prefs[0].modules as string[]).includes("dashboard"));
    });

    it("records what happened, for the activity log and the audit trail", async () => {
        const ctx = new FakeContext();

        await call(businesses.registerWithSetup, ctx, registrationArgs());

        assert.equal(ctx.tables.activityLogs.length, 1);
        assert.equal(ctx.tables.auditLogs.length, 1);
        assert.equal(ctx.tables.auditLogs[0].action, "business.register");
    });

    it("keeps the verification code away from the browser", async () => {
        const ctx = new FakeContext();

        const withoutSecret = await call(
            businesses.registerWithSetup,
            ctx,
            registrationArgs()
        );
        assert.equal(
            (withoutSecret as Record<string, unknown>).verificationCode,
            undefined
        );

        const withSecret = await call(
            businesses.registerWithSetup,
            new FakeContext(),
            registrationArgs({ serverSecret: "not-the-secret" })
        );
        assert.equal(
            (withSecret as Record<string, unknown>).verificationCode,
            undefined
        );
    });

    it("refuses an email that already has an account", async () => {
        const ctx = new FakeContext({
            users: [makeUser({ _id: "users_old", email: "amina@example.com" })],
        });

        await assert.rejects(
            () => call(businesses.registerWithSetup, ctx, registrationArgs()),
            /already exists/
        );
    });

    it("refuses a registration that is missing the things it needs", async () => {
        const ctx = new FakeContext();

        await assert.rejects(
            () =>
                call(
                    businesses.registerWithSetup,
                    ctx,
                    registrationArgs({ businessName: "  " })
                ),
            /name of your business/
        );

        await assert.rejects(
            () =>
                call(
                    businesses.registerWithSetup,
                    ctx,
                    registrationArgs({ categoryId: "" })
                ),
            /trade you are in/
        );

        await assert.rejects(
            () =>
                call(
                    businesses.registerWithSetup,
                    ctx,
                    registrationArgs({ password: "short" })
                ),
            /8 characters/
        );

        await assert.rejects(
            () =>
                call(
                    businesses.registerWithSetup,
                    ctx,
                    registrationArgs({ ownerEmail: "not-an-email" })
                ),
            /valid email/
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The personalisation
 * ──────────────────────────────────────────────────────────────────────────── */

/** A signed-in owner of a business that trades in `categoryId`. */
function ownerContext(
    categoryId: string,
    extra: Record<string, FakeRow[]> = {},
    businessOverrides: Record<string, unknown> = {}
): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [
            makeBusiness({
                _id: BUSINESS,
                ownerId: CALLER,
                categoryId,
                modules: ["dashboard", "sales", "inventory"],
                ...businessOverrides,
            }),
        ],
        memberships: [
            makeMembership({
                userId: CALLER,
                businessId: BUSINESS,
                role: "business_owner",
            }),
        ],
        ...extra,
    });
}

describe("a person's own workspace", () => {
    it("offers the screens the business has, and the packages it switched on", async () => {
        const ctx = ownerContext("pharmacy", {
            industryPackages: [
                {
                    _id: "industryPackages_1",
                    businessId: BUSINESS,
                    packageKey: "pharmacy",
                    enabled: true,
                },
            ],
        });

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.ok(result.allowedModules.includes("dashboard"));
        assert.ok(result.allowedModules.includes("sales"));
        // A pharmacy's package brings its own screens.
        assert.ok(
            result.allowedModules.length > 3,
            "the package's screens should be on offer"
        );
        assert.equal(result.categoryId, "pharmacy");
    });

    it("starts with nothing chosen, so the business's own screens are used", async () => {
        const ctx = ownerContext("retail");

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.equal(result.preferences, null);
        assert.equal(result.tradeChanged, false);
    });

    it("remembers the screens, colour and landing screen a person picks", async () => {
        const ctx = ownerContext("retail");

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            modules: ["dashboard", "sales"],
            accent: "teal",
            landingModule: "sales",
            density: "compact",
            locale: "sw",
            showCategoryWidgets: false,
        });

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.ok(result.preferences);
        assert.deepEqual(result.preferences.modules.sort(), ["dashboard", "sales"]);
        assert.equal(result.preferences.accent, "teal");
        assert.equal(result.preferences.landingModule, "sales");
        assert.equal(result.preferences.density, "compact");
        assert.equal(result.preferences.locale, "sw");
        assert.equal(result.preferences.showCategoryWidgets, false);
        // The stamp is the trade the choice was made for.
        assert.equal(result.preferences.categoryId, "retail");
        assert.equal(result.tradeChanged, false);
    });

    it("will not put a screen on the menu that this business does not have", async () => {
        const ctx = ownerContext("retail");

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            modules: ["dashboard", "not-a-screen"],
        });

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.deepEqual(result.preferences.modules, ["dashboard"]);
    });

    it("keeps the dashboard on the menu", async () => {
        const ctx = ownerContext("retail");

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            modules: ["sales"],
        });

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.ok(result.preferences.modules.includes("dashboard"));
        assert.ok(result.preferences.modules.includes("sales"));
    });

    it("refuses a colour, a spacing or a language the product does not have", async () => {
        const ctx = ownerContext("retail");

        await assert.rejects(
            () =>
                call(preferences.update, ctx, {
                    businessId: BUSINESS,
                    accent: "chartreuse",
                }),
            /colour the workspace knows/
        );

        await assert.rejects(
            () =>
                call(preferences.update, ctx, {
                    businessId: BUSINESS,
                    density: "enormous",
                }),
            /spacing the workspace knows/
        );

        await assert.rejects(
            () =>
                call(preferences.update, ctx, {
                    businessId: BUSINESS,
                    locale: "de",
                }),
            /language the product speaks/
        );
    });

    it("refuses to land on a screen the business does not have", async () => {
        const ctx = ownerContext("retail");

        await assert.rejects(
            () =>
                call(preferences.update, ctx, {
                    businessId: BUSINESS,
                    landingModule: "payroll",
                }),
            /screen this business has/
        );
    });

    it("says so when the trade changed under the person's choices", async () => {
        const ctx = ownerContext("retail");

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            modules: ["dashboard", "sales"],
        });

        // The business changed trade after the choice was made.
        await ctx.db.patch(BUSINESS, { categoryId: "hardware" });

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });

        assert.equal(result.tradeChanged, true);
        assert.equal(result.categoryId, "hardware");
        // The old choice is kept, so the person can see what they had.
        assert.equal(result.preferences.categoryId, "retail");
    });

    it("goes back to the default workspace when the person asks", async () => {
        const ctx = ownerContext("retail");

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            accent: "teal",
            density: "compact",
        });
        assert.equal(ctx.tables.userPreferences.length, 1);

        await call(preferences.reset, ctx, { businessId: BUSINESS });

        assert.equal(ctx.tables.userPreferences.length, 0);

        const result = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(result.preferences, null);
    });

    it("keeps one person's workspaces apart, one per business", async () => {
        const ctx = signedInContext({
            users: [makeUser({ _id: CALLER, activeBusinessId: BUSINESS })],
            businesses: [
                makeBusiness({
                    _id: BUSINESS,
                    ownerId: CALLER,
                    categoryId: "retail",
                    modules: ["dashboard", "sales"],
                }),
            ],
            memberships: [
                makeMembership({
                    userId: CALLER,
                    businessId: BUSINESS,
                    role: "business_owner",
                }),
            ],
        });

        await call(preferences.update, ctx, {
            businessId: BUSINESS,
            accent: "amber",
        });

        // A second business, in another trade, for the same person.
        const other = "businesses_2";
        ctx.tables.businesses.push({
            _id: other,
            name: "Second Shop",
            slug: "second-shop",
            ownerId: CALLER,
            status: "active",
            categoryId: "hardware",
            modules: ["dashboard", "sales"],
            currency: "UGX",
            timezone: "Africa/Kampala",
        });
        ctx.tables.memberships.push({
            _id: "memberships_2",
            userId: CALLER,
            businessId: other,
            role: "business_owner",
            status: "active",
        });

        await call(preferences.update, ctx, {
            businessId: other,
            accent: "violet",
            modules: ["dashboard", "inventory"],
        });

        const first = await call(preferences.getMine, ctx, {
            businessId: BUSINESS,
        });
        const second = await call(preferences.getMine, ctx, {
            businessId: other,
        });

        assert.equal(first.preferences.accent, "amber");
        assert.equal(second.preferences.accent, "violet");
        assert.equal(first.preferences.categoryId, "retail");
        assert.equal(second.preferences.categoryId, "hardware");
    });

    it("only lets a member of the business change it", async () => {
        const ctx = signedInContext({
            users: [makeUser({ _id: CALLER })],
            businesses: [
                makeBusiness({ _id: BUSINESS, ownerId: "someone_else" }),
            ],
            memberships: [],
        });

        await assert.rejects(
            () => call(preferences.getMine, ctx, { businessId: BUSINESS }),
            /Forbidden|not a member|belong/i
        );
    });
});

describe("the menu", () => {
    it("is the screens the person chose, and nothing else", () => {
        const menu = buildNavigation(["business_owner"], ["dashboard", "sales"]);

        assert.deepEqual(
            menu.map((item) => item.id).sort(),
            ["dashboard", "sales"]
        );
    });

    it("keeps the dashboard even when it was not chosen", () => {
        const menu = buildNavigation(["business_owner"], ["sales"]);

        assert.ok(menu.some((item) => item.id === "dashboard"));
    });

    it("leaves out a screen the person switched off", () => {
        const withIt = buildNavigation(["business_owner"], [
            "dashboard",
            "sales",
            "inventory",
        ]);
        const withoutIt = buildNavigation(["business_owner"], ["dashboard", "sales"]);

        assert.ok(withIt.some((item) => item.id === "inventory"));
        assert.ok(!withoutIt.some((item) => item.id === "inventory"));
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The codes
 * ──────────────────────────────────────────────────────────────────────────── */
/** Every TypeScript file under `convex/`. */
function convexSources(dir = join(process.cwd(), "convex")): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...convexSources(path));
        else if (name.endsWith(".ts")) out.push(path);
    }
    return out;
}

describe("the verification codes", () => {
    it("hashes a code so the plain code is never stored", () => {
        const hash = hashCode("123456");

        assert.notEqual(hash, "123456");
        assert.ok(verifyCode("123456", hash));
        assert.ok(!verifyCode("654321", hash));
    });

    it("gives two codes of the same value different hashes", () => {
        assert.notEqual(hashCode("123456"), hashCode("123456"));
    });

    /**
     * Convex refuses timers inside a mutation, and bcryptjs's asynchronous
     * API schedules its work with one. The synchronous API is the only one
     * that runs in a mutation, so the asynchronous one must not appear.
     *
     * This was a live bug: registration and email verification both failed
     * on the deployed backend with "Can't use setTimeout in queries and
     * mutations", because the code hash was taken with `await bcrypt.hash`.
     */
    it("never asks bcrypt to work asynchronously inside a mutation", () => {
        const offenders: string[] = [];

        for (const file of convexSources()) {
            const text = readFileSync(file, "utf8");
            if (/bcrypt\.(hash|compare|genSalt)\s*\(/.test(text)) {
                offenders.push(file);
            }
        }

        assert.deepEqual(
            offenders,
            [],
            "use bcrypt.hashSync / bcrypt.compareSync inside a Convex mutation"
        );
    });
});
