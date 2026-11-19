/**
 * SMARTBUZ — the integration catalogue, as the interface sees it.
 *
 * One query returns every adapter, whether the business has configured it,
 * how far it has been tested, and what is still missing.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this query deliberately does not return
 * ────────────────────────────────────────────────────────────────────────
 *
 * Secrets. Not redacted, not masked, not truncated — absent.
 *
 * The browser is told *which* secrets are present, because an owner has to
 * know that a key was saved, and it is told nothing about their value. A
 * credential that reaches the browser has left the place where it was
 * supposed to stay.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { loadIntegration, writeIntegrationConfig } from "./config";
import { ADAPTERS, HARDWARE, findAdapter } from "./registry";
import { verificationLabel, type VerificationStatus } from "./types";

/**
 * One adapter, as the interface sees it.
 */
export interface AdapterView {
    key: string;
    category: string;
    label: string;
    vendor: string;
    summary: string;
    capabilities: string[];
    /** The configuration fields, with the shape the form needs. */
    fields: {
        key: string;
        label: string;
        type: string;
        required: boolean;
        placeholder?: string;
        help?: string;
        options?: { value: string; label: string }[];
        default?: string | number | boolean;
        /** The current value — never present for a secret. */
        value?: string | number | boolean;
        /** For a secret: whether one is saved. */
        hasValue?: boolean;
    }[];
    /** Whether the business has switched it on. */
    enabled: boolean;
    /** How far it has been proved. */
    verificationStatus: VerificationStatus;
    /** The words under the badge. */
    verificationLabel: string;
    verifiedAt?: string;
    lastTestedAt?: string;
    lastTestResult?: string;
    lastTestPassed?: boolean;
    /** Whether the built-in live test can be run. */
    supportsLiveTest: boolean;
    /** What has to happen before it works. */
    verification: {
        method: string;
        requires: string[];
        docs?: string;
        testDescription: string;
    };
    /** The limits, stated up front. */
    limitations?: string[];
    /** Which required fields are still missing. */
    missing: string[];
}

/**
 * Every adapter, with the business's configuration folded in.
 */
export const listAdapters = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "integrations.view");

        const views: AdapterView[] = [];

        for (const adapter of ADAPTERS) {
            const loaded = await loadIntegration(ctx, businessId, adapter.key);

            const missing: string[] = [];
            const fields = adapter.configFields.map((field) => {
                const secretValue =
                    field.type === "secret" ? loaded.secrets[field.key] : undefined;
                const current = loaded.config[field.key];

                const present =
                    current !== undefined &&
                    current !== null &&
                    String(current).trim() !== "" &&
                    String(current) !== "false";

                if (field.required && !present && !secretValue) {
                    missing.push(field.label);
                }

                if (field.type === "secret") {
                    return {
                        key: field.key,
                        label: field.label,
                        type: field.type,
                        required: Boolean(field.required),
                        placeholder: field.placeholder,
                        help: field.help,
                        default: field.default,
                        hasValue: Boolean(secretValue),
                    };
                }

                return {
                    key: field.key,
                    label: field.label,
                    type: field.type,
                    required: Boolean(field.required),
                    placeholder: field.placeholder,
                    help: field.help,
                    options: field.options,
                    default: field.default,
                    value:
                        current === undefined || current === null
                            ? field.default
                            : (current as string | number | boolean),
                };
            });

            views.push({
                key: adapter.key,
                category: adapter.category,
                label: adapter.label,
                vendor: adapter.vendor,
                summary: adapter.summary,
                capabilities: adapter.capabilities,
                fields,
                enabled: loaded.enabled,
                verificationStatus: loaded.verificationStatus,
                verificationLabel: verificationLabel(loaded.verificationStatus),
                verifiedAt: loaded.row?.verifiedAt,
                lastTestedAt: loaded.row?.lastTestedAt,
                lastTestResult: loaded.row?.lastTestResult,
                lastTestPassed: loaded.row?.lastTestPassed,
                supportsLiveTest: adapter.supportsLiveTest,
                verification: adapter.verification,
                limitations: adapter.limitations,
                missing,
            });
        }

        return views;
    },
});

/**
 * The hardware catalogue.
 *
 * The hardware lives in the browser, but the catalogue has to be visible
 * from the server too, so the owner can see what a till is supposed to
 * have.
 */
export const listHardwareCatalogue = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "integrations.view");

        return HARDWARE.map((hardware) => ({
            key: hardware.key,
            kind: hardware.kind,
            label: hardware.label,
            vendor: hardware.vendor,
            summary: hardware.summary,
            transport: hardware.transport,
            requirements: hardware.requirements,
            limitations: hardware.limitations,
            verification: hardware.verification,
        }));
    },
});

/**
 * Save an adapter's configuration.
 *
 * Secrets are encrypted on the way in and are never read back. Leaving a
 * secret field blank keeps whatever was saved before, so an owner can
 * change one setting without re-typing every key.
 */
export const saveAdapterConfig = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        enabled: v.optional(v.boolean()),
        config: v.optional(v.record(v.string(), v.any())),
        secrets: v.optional(v.record(v.string(), v.string())),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "integrations.manage"
        );

        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }

        // Only the fields the adapter actually declares may be set.
        const declared = new Set(adapter.configFields.map((f) => f.key));
        const config: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(args.config ?? {})) {
            if (!declared.has(key)) continue;
            config[key] = value;
        }

        const secretKeys = new Set(
            adapter.configFields.filter((f) => f.type === "secret").map((f) => f.key)
        );
        const secrets: Record<string, string> = {};
        for (const [key, value] of Object.entries(args.secrets ?? {})) {
            if (!secretKeys.has(key)) continue;
            if (!value) continue;
            secrets[key] = value;
        }

        await writeIntegrationConfig(ctx, {
            businessId,
            adapterKey: args.adapterKey,
            enabled: args.enabled,
            config,
            secrets,
            userId: membership.userId,
        });

        return null;
    },
});

/**
 * Switch an adapter on or off.
 *
 * Turning an adapter off does not delete its configuration, and it does
 * not delete anything it has already done. It only stops it being used.
 */
export const setAdapterEnabled = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "integrations.manage"
        );

        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }

        await writeIntegrationConfig(ctx, {
            businessId,
            adapterKey: args.adapterKey,
            enabled: args.enabled,
            userId: membership.userId,
        });

        return null;
    },
});

/**
 * The integration audit trail.
 *
 * Every call that was made and every callback that arrived, newest first.
 */
export const listIntegrationEvents = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "integrations.view");

        const limit = Math.min(args.limit ?? 100, 500);

        let rows = await ctx.db
            .query("integrationEvents")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.adapterKey) {
            rows = rows.filter((r) => r.adapterKey === args.adapterKey);
        }

        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return rows.slice(0, limit).map((row) => ({
            id: row._id,
            adapterKey: row.adapterKey,
            direction: row.direction,
            kind: row.kind,
            status: row.status,
            reference: row.reference,
            summary: row.summary,
            error: row.error,
            createdAt: row.createdAt,
        }));
    },
});

/**
 * Forget an adapter's configuration.
 *
 * The credentials are removed; the payments, messages and events it
 * produced are **not**. Nothing an integration did is ever deleted —
 * it is part of the business's history.
 */
export const clearAdapterConfig = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "integrations.manage"
        );

        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }

        const existing = await ctx.db
            .query("integrationConfigs")
            .withIndex("by_businessId_adapterKey", (q) =>
                q.eq("businessId", businessId).eq("adapterKey", args.adapterKey)
            )
            .unique();

        if (!existing) return null;

        await ctx.db.patch(existing._id, {
            enabled: false,
            config: {},
            secrets: {},
            verificationStatus: "unverified",
            verifiedAt: undefined,
            lastTestedAt: undefined,
            lastTestResult: undefined,
            lastTestPassed: undefined,
            updatedBy: membership.userId,
            updatedAt: new Date().toISOString(),
        });

        return null;
    },
});

/** The Id type is used in the argument shapes above. */
export type BusinessIdArg = Id<"businesses">;
