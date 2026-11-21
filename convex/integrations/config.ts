/**
 * SMARTBUZ — integration configuration.
 *
 * Where an adapter's settings and credentials live, and the rules about
 * when an adapter may be used.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Secrets
 * ────────────────────────────────────────────────────────────────────────
 *
 * A provider's API key is encrypted with AES-GCM before it is stored, and
 * the key that opens it is derived from the server secret — which lives in
 * the environment and never reaches the database. A copy of the database
 * therefore does not contain anybody's provider credentials in a readable
 * form.
 *
 * The secrets are decrypted only for the duration of one call, and are
 * never returned to the browser. The interface can tell an owner that a
 * key is present; it can never read one back.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Verification is not a checkbox
 * ────────────────────────────────────────────────────────────────────────
 *
 * Saving credentials does not make an adapter work, and this module does
 * not pretend otherwise. Saving a *secret* puts the adapter back to
 * `configured`, never to `verified`: a changed key has not been tested, so
 * the adapter has not been proved. Only the live test in
 * `convex/integrations/engine.ts` can do that, and only against the real
 * provider.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { decryptSecret, encryptSecret, type SealedSecret } from "../crypto";
import { serverSecretValue } from "../serverSecret";
import { findAdapter, secretFieldKeys } from "./registry";
import type { VerificationStatus } from "./types";

export type Ctx = MutationCtx | QueryCtx;

/** How an adapter's configuration came back. */
export interface LoadedIntegration {
    /** The stored row, when the business has configured this adapter. */
    row: Doc<"integrationConfigs"> | null;
    /** The adapter's key. */
    adapterKey: string;
    /** The non-secret configuration. */
    config: Record<string, unknown>;
    /** The decrypted secrets. */
    secrets: Record<string, string>;
    /** Whether the business has switched the adapter on. */
    enabled: boolean;
    /** How far the adapter has been proved. */
    verificationStatus: VerificationStatus;
    /** True when the adapter is pointed at a sandbox. */
    sandbox: boolean;
}

/**
 * The passphrase the credentials are encrypted with.
 *
 * In development this falls back to a public constant, so a developer
 * installation is not safe to put real credentials into. A deployment that
 * matters must set `SMARTBUZ_SERVER_SECRET`.
 */
function passphrase(): string {
    return serverSecretValue();
}

/**
 * Load an adapter's configuration for a business.
 *
 * Never throws for a missing configuration — a business that has not set
 * up MTN simply gets an adapter that is off and unverified. The caller
 * decides whether that is an error.
 */
export async function loadIntegration(
    ctx: Ctx,
    businessId: Id<"businesses">,
    adapterKey: string
): Promise<LoadedIntegration> {
    const row = await ctx.db
        .query("integrationConfigs")
        .withIndex("by_businessId_adapterKey", (q) =>
            q.eq("businessId", businessId).eq("adapterKey", adapterKey)
        )
        .unique();

    if (!row) {
        return {
            row: null,
            adapterKey,
            config: {},
            secrets: {},
            enabled: false,
            verificationStatus: "unverified",
            sandbox: true,
        };
    }

    const secrets: Record<string, string> = {};
    const stored = (row.secrets ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(stored)) {
        const plaintext = await decryptSecret(value as SealedSecret, passphrase());
        if (plaintext !== null) secrets[key] = plaintext;
    }

    const config = (row.config ?? {}) as Record<string, unknown>;

    return {
        row,
        adapterKey,
        config,
        secrets,
        enabled: row.enabled,
        verificationStatus: (row.verificationStatus ?? "unverified") as VerificationStatus,
        sandbox: String(config.environment ?? "sandbox") !== "live",
    };
}

/**
 * Load an adapter's configuration and insist that it may be used.
 *
 * This is what a call that moves money or sends a message goes through.
 * It refuses an adapter that is switched off, one whose required fields
 * are missing, and — importantly — one that has never passed a live test.
 *
 * The last check is the one that matters. It means SMARTBUZ will not take
 * a customer's money through a provider the business has never actually
 * reached, because "configured" and "works" are not the same thing.
 */
export async function requireUsableIntegration(
    ctx: Ctx,
    businessId: Id<"businesses">,
    adapterKey: string,
    options: { requireVerified?: boolean } = {}
): Promise<LoadedIntegration> {
    const adapter = findAdapter(adapterKey);
    if (!adapter) {
        throw new ConvexError(`Unknown integration adapter: ${adapterKey}`);
    }

    const loaded = await loadIntegration(ctx, businessId, adapterKey);

    if (!loaded.row || !loaded.enabled) {
        throw new ConvexError(
            `${adapter.label} is not switched on for this business. Turn it on in Integrations before using it.`
        );
    }

    const missing: string[] = [];
    for (const field of adapter.configFields) {
        if (!field.required) continue;
        const value = loaded.config[field.key];
        const present =
            value !== undefined &&
            value !== null &&
            String(value).trim() !== "" &&
            String(value) !== "false";
        const secretValue =
            field.type === "secret" ? loaded.secrets[field.key] : undefined;
        if (!present && !secretValue) missing.push(field.label);
    }

    if (missing.length > 0) {
        throw new ConvexError(
            `${adapter.label} is not fully configured. Still needed: ${missing.join(", ")}.`
        );
    }

    if (options.requireVerified !== false) {
        if (loaded.verificationStatus !== "verified") {
            throw new ConvexError(
                `${adapter.label} has not been verified against the live provider, so it cannot be used to move money or send messages. Run the live test in Integrations first.`
            );
        }
    }

    return loaded;
}

/**
 * Store an adapter's configuration.
 *
 * Secrets are encrypted on the way in. A secret that is not supplied is
 * left as it was — so the interface can save the non-secret settings
 * without making the owner re-type every key.
 */
export async function writeIntegrationConfig(
    ctx: MutationCtx,
    args: {
        businessId: Id<"businesses">;
        adapterKey: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
        /** Only the secrets that are being changed. */
        secrets?: Record<string, string>;
        userId?: Id<"users">;
    }
): Promise<void> {
    const adapter = findAdapter(args.adapterKey);
    if (!adapter) {
        throw new ConvexError(`Unknown integration adapter: ${args.adapterKey}`);
    }

    const existing = await ctx.db
        .query("integrationConfigs")
        .withIndex("by_businessId_adapterKey", (q) =>
            q.eq("businessId", args.businessId).eq("adapterKey", args.adapterKey)
        )
        .unique();

    const now = new Date().toISOString();

    // Secrets are merged, not replaced: the interface never receives the
    // old value, so it cannot send it back.
    const storedSecrets: Record<string, SealedSecret> = {
        ...((existing?.secrets ?? {}) as Record<string, SealedSecret>),
    };

    const secretKeys = secretFieldKeys(args.adapterKey);
    const changedSecretKeys: string[] = [];

    for (const [key, value] of Object.entries(args.secrets ?? {})) {
        if (!secretKeys.includes(key)) continue;
        if (value === "" || value === null || value === undefined) continue;
        storedSecrets[key] = await encryptSecret(String(value), passphrase());
        changedSecretKeys.push(key);
    }

    const mergedConfig = {
        ...((existing?.config ?? {}) as Record<string, unknown>),
        ...(args.config ?? {}),
    };

    // ──────────────────────────────────────────────────────────────────────
    // A callback adapter must have a webhook secret before it is switched on
    // ──────────────────────────────────────────────────────────────────────
    //
    // A callback that arrives with no secret to check it against cannot be
    // told apart from a forged one, so it is refused. That refusal is
    // correct — but it would leave the owner with a payment provider that
    // silently never confirms anything, which is worse than the problem it
    // fixes.
    //
    // So the secret is required at the moment the adapter is enabled: the
    // owner is told to set it before the provider is pointed at SMARTBUZ,
    // rather than after the first payment goes missing.
    if (args.enabled && adapter.capabilities.includes("status_callback")) {
        const webhookSecret =
            (args.secrets?.webhookSecret ??
                ((existing?.secrets ?? {}) as Record<string, SealedSecret>)
                    .webhookSecret) as SealedSecret | undefined;

        const hasWebhookSecret =
            typeof webhookSecret === "object" &&
            webhookSecret !== null &&
            typeof webhookSecret.ciphertext === "string" &&
            webhookSecret.ciphertext.length > 0;

        if (!hasWebhookSecret) {
            throw new ConvexError(
                "Set a webhook secret for this adapter before switching it on. Without it the provider's callback cannot be checked, and SMARTBUZ will refuse it — which would leave the payment unconfirmed."
            );
        }
    }

    // A changed secret invalidates the proof: the adapter has not been
    // tested with the new credential, so it has not been verified.
    const secretChanged =
        changedSecretKeys.length > 0 ||
        secretKeys.some(
            (key) =>
                args.secrets !== undefined &&
                Object.prototype.hasOwnProperty.call(args.secrets, key) &&
                args.secrets[key] === ""
        );

    let verificationStatus: string = existing?.verificationStatus ?? "unverified";

    if (!existing) {
        verificationStatus = "unverified";
    } else if (secretChanged) {
        verificationStatus = "configured";
    } else if (existing.verificationStatus === "unverified" && args.enabled) {
        verificationStatus = "configured";
    }

    const patch = {
        category: adapter.category,
        enabled: args.enabled ?? existing?.enabled ?? false,
        config: mergedConfig,
        secrets: storedSecrets,
        verificationStatus,
        verifiedAt: secretChanged ? undefined : existing?.verifiedAt,
        lastTestedAt: existing?.lastTestedAt,
        lastTestResult: existing?.lastTestResult,
        lastTestPassed: existing?.lastTestPassed,
        updatedBy: args.userId,
        updatedAt: now,
    };

    if (existing) {
        await ctx.db.patch(existing._id, patch);
    } else {
        await ctx.db.insert("integrationConfigs", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            category: adapter.category,
            enabled: patch.enabled,
            config: patch.config,
            secrets: patch.secrets,
            verificationStatus,
            verifiedAt: undefined,
            lastTestedAt: undefined,
            lastTestResult: undefined,
            lastTestPassed: undefined,
            updatedBy: args.userId,
            createdAt: now,
            updatedAt: now,
        });
    }
}

/**
 * Whether a secret has been saved, without revealing it.
 *
 * The interface uses this to show "configured" beside a field it is not
 * allowed to read back.
 */
export function hasSecret(
    loaded: LoadedIntegration,
    key: string
): boolean {
    return Boolean(loaded.secrets[key]);
}
