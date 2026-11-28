/**
 * REMOVED — this was a temporary development-only auto-login route.
 *
 * It existed so the app could be opened in a browser without typing
 * credentials into a sign-in form. It signed in through the ordinary
 * `users:login` + `users:startSession` path, and refused to run unless the
 * Convex deployment was a `dev:` deployment and the app was not in
 * production mode.
 *
 * It has been switched off: this file now answers 404 and does nothing
 * else. It is still on disk only because file deletion is not available in
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
