/**
 * SMARTBUZ — put a backup back.
 *
 *   POST /api/backup/restore
 *   body: { businessId: "...", backup: { ...the backup file... } }
 *
 * ────────────────────────────────────────────────────────────────────────
 * What a restore does
 *
 * The rows are put back into a business, and every reference between them
 * is rewritten so that the restored data hangs together: a restored sale
 * points at the restored customer, the restored payment at the restored
 * loan.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two passes, and why
 *
 * Convex gives every row a new id, so a row cannot be written with its
 * references already pointing at the right place — the new ids do not
 * exist yet when the row is inserted.
 *
 * So the restore is done in two passes:
 *
 *   1. Every row is inserted, and the old id is paired with the new one.
 *   2. Every row is rewritten, with the references replaced by the ids the
 *      rows were actually restored as.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What it will not do
 *
 * It will not overwrite. A row whose id is already in the database is
 * left alone and counted, because a restore that half-overwrites a
 * business that is still running is worse than one that does not.
 *
 * It will not restore the accounts, the sessions or the licence: those
 * belong to the platform, not to the business, and a restored database
 * that could grant itself a licence would be a hole rather than a
 * backup.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { signAccessToken } from "@/lib/convex-token";
import { CONVEX_URL } from "@/lib/convex-url";
import { isBackupFile, remapDocument, type IdMap } from "@/lib/backup";
import { BACKUP_TABLES } from "../../../../../convex/backupTables";

export const dynamic = "force-dynamic";

/** How many rows are written at a time. */
const CHUNK = 200;

/** The shared secret that proves a call comes from this server. */
function serverSecret(): string | undefined {
    return (
        process.env.SMARTBUZ_SERVER_SECRET ||
        process.env.RESEND_API_KEY ||
        process.env.SESSION_SECRET
    );
}

async function convexCall(
    kind: "query" | "mutation",
    path: string,
    args: Record<string, unknown>,
    token?: string
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
        const response = await fetch(`${CONVEX_URL}/api/${kind}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ path, args, format: "json" }),
            cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as
            | { status?: string; value?: unknown; errorMessage?: string }
            | null;
        if (data?.status === "success") return { ok: true, value: data.value };
        return { ok: false, error: data?.errorMessage ?? "The backend refused the call." };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "The backend could not be reached.",
        };
    }
}

function chunked<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export async function POST(request: NextRequest) {
    const session = await getSessionFromRequest(request);
    if (!session) {
        return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    let body: { businessId?: string; backup?: unknown };
    try {
        body = (await request.json()) as { businessId?: string; backup?: unknown };
    } catch {
        return NextResponse.json({ error: "The request was not readable." }, { status: 400 });
    }

    const businessId = body.businessId;
    if (!businessId) {
        return NextResponse.json(
            { error: "Which business is this being restored into? Pass its id as businessId." },
            { status: 400 }
        );
    }

    if (!isBackupFile(body.backup)) {
        return NextResponse.json(
            { error: "That file is not a SMARTBUZ backup." },
            { status: 400 }
        );
    }
    const backup = body.backup;

    // Only the tables a backup covers are restored. A file that names
    // anything else is refused rather than half-restored.
    const unknown = Object.keys(backup.tables).filter(
        (table) => !(BACKUP_TABLES as readonly string[]).includes(table)
    );
    if (unknown.length > 0) {
        return NextResponse.json(
            {
                error: "That backup names tables this version does not know about, so it was not restored.",
                tables: unknown,
            },
            { status: 400 }
        );
    }

    let token: string;
    try {
        token = await signAccessToken({
            userId: session.userId,
            email: session.email,
            sessionId: session.sessionId,
            sessionSecret: session.sessionSecret,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    "The server cannot issue an access token, so it cannot ask the backend who you are.",
                detail: error instanceof Error ? error.message : undefined,
            },
            { status: 503 }
        );
    }

    const permitted = await convexCall("query", "backup:tables", { businessId }, token);
    if (!permitted.ok) {
        return NextResponse.json({ error: permitted.error }, { status: 403 });
    }

    const secret = serverSecret();
    if (!secret) {
        return NextResponse.json(
            { error: "The server secret is not configured, so a restore cannot be run." },
            { status: 503 }
        );
    }

    // ---- pass 1: insert every row, and remember what it became -------
    const map: IdMap = new Map();
    let inserted = 0;
    let failed = 0;

    for (const table of Object.keys(backup.tables)) {
        const rows = backup.tables[table] ?? [];
        for (const chunk of chunked(rows, CHUNK)) {
            const result = await convexCall(
                "mutation",
                "backup:restoreChunk",
                { table, rows: chunk, serverSecret: secret }
            );
            if (!result.ok) {
                return NextResponse.json(
                    { error: `Could not write the ${table} table: ${result.error}` },
                    { status: 500 }
                );
            }
            const value = result.value as {
                inserted?: Array<[string, string]>;
                failed?: number;
            };
            for (const [oldId, newId] of value.inserted ?? []) {
                map.set(oldId, newId);
            }
            inserted += (value.inserted ?? []).length;
            failed += value.failed ?? 0;
        }
    }

    // The business the data came from is not the business it is going
    // into — that is the point of a restore.
    map.set(backup.businessId, businessId);

    // ---- pass 2: rewrite the references -------------------------------
    let rewritten = 0;
    let rewriteFailures = 0;

    for (const table of Object.keys(backup.tables)) {
        const rows = backup.tables[table] ?? [];
        const withIds = rows
            .map((row) => {
                const oldId = row._id;
                if (typeof oldId !== "string") return null;
                const newId = map.get(oldId);
                if (!newId) return null;
                const { _id, _creationTime, ...rest } = row;
                void _id;
                void _creationTime;
                return { id: newId, doc: remapDocument(rest, map) };
            })
            .filter((entry): entry is { id: string; doc: unknown } => entry !== null);

        for (const chunk of chunked(withIds, CHUNK)) {
            const result = await convexCall(
                "mutation",
                "backup:applyRemap",
                { table, rows: chunk, serverSecret: secret }
            );
            if (!result.ok) {
                return NextResponse.json(
                    { error: `Could not rewrite the ${table} table: ${result.error}` },
                    { status: 500 }
                );
            }
            const value = result.value as { written?: number; failed?: number };
            rewritten += value.written ?? 0;
            rewriteFailures += value.failed ?? 0;
        }
    }

    return NextResponse.json(
        {
            ok: true,
            inserted,
            rewritten,
            failed,
            rewriteFailures,
            tables: Object.keys(backup.tables).length,
            takenAt: backup.takenAt,
        },
        { status: 200 }
    );
}
