/**
 * SMARTBUZ — take a backup of a business.
 *
 *   GET /api/backup/export?businessId=...
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this is a server route and not a page
 *
 * A backup is the whole business: the catalogue, the customers, the debts
 * and the sales. It is read on the server, with the server secret, and
 * handed to the browser as a file. The browser never holds the secret, and
 * the permission to do this at all is the caller's role in the business,
 * checked on the server.
 *
 * ────────────────────────────────────────────────────────────────────────
 * How it is read
 *
 * One table at a time, a chunk at a time, through the table's
 * `by_businessId` index. The size of the business never decides whether
 * it can be backed up, and no read is wider than the rows that belong to
 * that business.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { signAccessToken } from "@/lib/convex-token";
import { CONVEX_URL } from "@/lib/convex-url";
import { BACKUP_FORMAT, backupFilename } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** How many rows are read at a time. */
const CHUNK = 200;

/** The shared secret that proves a call comes from this server. */
function serverSecret(): string | undefined {
    return (
        process.env.SMARTBUZ_SERVER_SECRET ||
        process.env.RESEND_API_KEY ||
        process.env.SESSION_SECRET
    );
}

/** Call a Convex function. */
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

export async function GET(request: NextRequest) {
    const session = await getSessionFromRequest(request);
    if (!session) {
        return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const businessId = request.nextUrl.searchParams.get("businessId");
    if (!businessId) {
        return NextResponse.json(
            { error: "Which business? Pass its id as businessId." },
            { status: 400 }
        );
    }

    // The token carries the caller's identity, so the backend decides what
    // they may read. The check is the ordinary tenancy check: only somebody
    // who may see the financial reports may take the whole business out.
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

    const listed = await convexCall("query", "backup:tables", { businessId }, token);
    if (!listed.ok) {
        return NextResponse.json({ error: listed.error }, { status: 403 });
    }
    const tables = (listed.value as { tables?: string[] } | undefined)?.tables ?? [];

    const secret = serverSecret();
    if (!secret) {
        return NextResponse.json(
            { error: "The server secret is not configured, so a backup cannot be taken." },
            { status: 503 }
        );
    }

    const business = await convexCall(
        "query",
        "backup:exportBusiness",
        { businessId, serverSecret: secret }
    );
    if (!business.ok) {
        return NextResponse.json({ error: business.error }, { status: 500 });
    }

    const tablesOut: Record<string, unknown[]> = {};
    let rows = 0;

    for (const table of tables) {
        const collected: unknown[] = [];
        let cursor: string | undefined;
        let done = false;

        while (!done) {
            const chunk = await convexCall("query", "backup:exportChunk", {
                businessId,
                table,
                cursor,
                numItems: CHUNK,
                serverSecret: secret,
            });
            if (!chunk.ok) {
                return NextResponse.json(
                    { error: `Could not read the ${table} table: ${chunk.error}` },
                    { status: 500 }
                );
            }
            const value = chunk.value as {
                page?: unknown[];
                isDone?: boolean;
                continueCursor?: string;
            };
            collected.push(...(value.page ?? []));
            rows += (value.page ?? []).length;
            done = value.isDone !== false;
            cursor = done ? undefined : value.continueCursor;
        }

        tablesOut[table] = collected;
    }

    const takenAt = new Date().toISOString();
    const document = {
        format: BACKUP_FORMAT,
        takenAt,
        businessId,
        business: business.value as Record<string, unknown> | undefined,
        tables: tablesOut,
    };

    return new NextResponse(JSON.stringify(document, null, 2), {
        status: 200,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${backupFilename(takenAt)}"`,
            "cache-control": "no-store",
            "x-smartbuz-backup-rows": String(rows),
        },
    });
}
