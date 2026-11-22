import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { serverSecretMatches } from "./serverSecret";
import { hasPermission, requireTenant } from "./tenancy";
import { BACKUP_CHUNK_SIZE, BACKUP_TABLES } from "./backupTables";

/**
 * SMARTBUZ — backing a business up, and putting it back.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * There was no way to take a business's data out of SMARTBUZ, and no way
 * to put it back. That made every other guarantee conditional: the ledger
 * is truthful *as long as nobody loses the database*; the reconciliations
 * balance *as long as the history is still there*. A business that cannot
 * take its own data with it is a business that cannot leave.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The shape of it
 *
 * A backup is a JSON document:
 *
 *   {
 *     "format": "smartbuz-backup/1",
 *     "takenAt": "2026-11-21T18:00:00.000Z",
 *     "businessId": "...",
 *     "business": { ...the business's own settings... },
 *     "tables": { "stocks": [ ... ], "sales": [ ... ], ... }
 *   }
 *
 * It is read and written a chunk at a time, so the size of a business
 * never decides whether it can be backed up.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two rules about who may do this
 *
 *  1. The bulk reading and writing is done server-to-server, guarded by
 *     the server secret. A browser never holds that secret, so the whole
 *     of a business's data cannot be pulled out by a page.
 *
 *  2. The *permission* to take a business out of the system is the
 *     caller's business role, checked through the ordinary tenancy rules.
 *     A backup is the whole business: the catalogue, the customers, the
 *     sales and the debts. It is not something a till operator may do.
 */

const CHUNK = BACKUP_CHUNK_SIZE;

/**
 * A table this module will read and write.
 *
 * The tables are named by a string in the arguments, so they arrive as
 * strings. They are checked against the list of backed-up tables before
 * they are used, and only then treated as a table name.
 */
type BackedUpTable = (typeof BACKUP_TABLES)[number];

/** Is this one of the tables a backup covers? */
function isBackedUpTable(table: string): table is BackedUpTable {
    return (BACKUP_TABLES as readonly string[]).includes(table);
}

/**
 * A query, with the table's own type erased.
 *
 * The table is named by a string in the arguments, so the compiler cannot
 * know which table it is and cannot check the index name against it. The
 * table is checked against the list of backed-up tables instead, and every
 * table on that list has a `by_businessId` index — which is what makes
 * the read bounded by the business rather than by the size of the table.
 */
type ErasedQuery = {
    withIndex: (
        name: string,
        build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown
    ) => {
        paginate: (options: {
            numItems: number;
            cursor: string | null;
        }) => Promise<{
            page: unknown[];
            isDone: boolean;
            continueCursor: string;
        }>;
    };
};

/**
 * May this caller take the whole business out of the system?
 *
 * A backup is everything: the catalogue, the customers, the debts and the
 * sales. It is the owner's business, so the permission that says so is
 * the one that governs the financial reports — the people who may read
 * the books may take them with them.
 */
async function requireBackupPermission(
    ctx: Parameters<typeof hasPermission>[0],
    businessId: Id<"businesses">
): Promise<void> {
    const allowed = await hasPermission(ctx, businessId, "finance.reports.export");
    if (!allowed) {
        throw new ConvexError(
            "Forbidden: only somebody who may see the financial reports can back the business up."
        );
    }
}

/** The tables a backup covers. */
export const tables = query({
    args: {
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requireBackupPermission(ctx, tenant.businessId);
        return { tables: BACKUP_TABLES };
    },
});

/**
 * One chunk of one table.
 *
 * The rows are read with the table's `by_businessId` index, so the read
 * is bounded by the rows that belong to the business rather than by the
 * size of the table.
 */
export const exportChunk = query({
    args: {
        businessId: v.id("businesses"),
        table: v.string(),
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: a backup can only be taken by the SMARTBUZ server."
            );
        }
        if (!isBackedUpTable(args.table)) {
            throw new ConvexError(`Refused: "${args.table}" is not a table a backup covers.`);
        }

        const table = args.table as Parameters<typeof ctx.db.query>[0];
        const result = await (ctx.db.query(table) as unknown as ErasedQuery)
            .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
            .paginate({
                numItems: Math.min(args.numItems ?? CHUNK, 500),
                cursor: args.cursor ?? null,
            });

        return {
            page: result.page,
            isDone: result.isDone,
            continueCursor: result.continueCursor,
        };
    },
});

/**
 * The business's own settings, for the header of the backup file.
 *
 * Not the membership, not the people: what the business *is* — its name,
 * its kind of business, its currency and its tax settings.
 */
export const exportBusiness = query({
    args: {
        businessId: v.id("businesses"),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: a backup can only be taken by the SMARTBUZ server."
            );
        }
        const business = await ctx.db.get(args.businessId);
        if (!business) throw new ConvexError("That business does not exist.");
        return { business };
    },
});

/**
 * Write a chunk of rows back.
 *
 * The rows are inserted *without* their old ids: Convex does not let a
 * document keep an id it was given elsewhere, so every row gets a new one
 * and the pairs are returned, for the references to be rewritten.
 */
export const restoreChunk = mutation({
    args: {
        table: v.string(),
        rows: v.array(v.any()),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: a restore can only be run by the SMARTBUZ server."
            );
        }
        if (!isBackedUpTable(args.table)) {
            throw new ConvexError(`Refused: "${args.table}" is not a table a backup covers.`);
        }

        const table = args.table as Parameters<typeof ctx.db.query>[0];
        const inserted: Array<[string, string]> = [];
        let failed = 0;

        for (const row of args.rows) {
            if (!row || typeof row !== "object") {
                failed += 1;
                continue;
            }
            // The system fields belong to the deployment the row came from.
            const { _id, _creationTime, ...rest } = row as Record<string, unknown>;
            void _creationTime;
            try {
                const newId = await ctx.db.insert(table, rest as never);
                if (typeof _id === "string") inserted.push([_id, newId]);
            } catch {
                // A row the current schema will not accept is reported
                // rather than stopping the whole restore: one bad row must
                // not cost the business the other ten thousand.
                failed += 1;
            }
        }

        return { inserted, failed };
    },
});

/**
 * Put the references back.
 *
 * The rows were inserted with the *old* ids in their reference fields,
 * because the new ids did not exist yet when they were written. Now that
 * every row has been restored and every old-to-new pair is known, each
 * row is replaced with a document whose references point at the rows that
 * were actually restored.
 */
export const applyRemap = mutation({
    args: {
        table: v.string(),
        rows: v.array(v.object({ id: v.string(), doc: v.any() })),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: a restore can only be run by the SMARTBUZ server."
            );
        }
        if (!isBackedUpTable(args.table)) {
            throw new ConvexError(`Refused: "${args.table}" is not a table a backup covers.`);
        }

        const table = args.table as Parameters<typeof ctx.db.query>[0];
        let written = 0;
        let failed = 0;

        for (const row of args.rows) {
            try {
                await ctx.db.replace(table, row.id as never, row.doc as never);
                written += 1;
            } catch {
                failed += 1;
            }
        }

        return { written, failed };
    },
});
