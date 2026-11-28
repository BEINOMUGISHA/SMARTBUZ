/**
 * REMOVED — this was a temporary development-only auto-login route.
 *
 * It was superseded by `src/app/api/auth/dev-autologin/route.ts`, which sits
 * under the already-public `/api/auth` prefix so the session middleware did
 * not need to be changed. Both are now switched off and answer 404.
 *
 * This file is still on disk only because file deletion is not available in
 * this environment — please delete this directory before the branch is
 * merged.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function POST() {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
}
