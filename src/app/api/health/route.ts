import { NextResponse } from "next/server";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

/**
 * Health endpoint (BUG-028).
 *
 * There was no monitoring, no alerting and no error reporting: when the app
 * broke on 19 Nov 2026 nobody was told, and the first sign of trouble was a
 * customer report. This route is the smallest possible probe an uptime monitor
 * - or a human running `curl` - can hit.
 *
 * The security rule that shapes the whole file: the response describes
 * *whether* a dependency is reachable, never *what* it is. No environment
 * values, no connection strings, no stack traces, no upstream response
 * bodies. A health endpoint is normally unauthenticated, so everything it
 * returns is public.
 *
 * The one exception it makes is naming a *missing* configuration variable.
 * A name is not a secret, and "SMARTBUZ_JWT_PRIVATE_KEY is not set" is the
 * difference between a five-minute fix and the hour the 19 Nov outage cost.
 *
 * Status codes:
 *   200 - every required dependency answered and every required variable is set.
 *   503 - a required dependency is down, or a required variable is missing.
 *
 * The route is dynamic on purpose: the answer depends on live state, and a
 * cached 200 would defeat the point of a health check.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** A dependency probe must fail fast; a slow probe is worse than no probe. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * The variables the app cannot run without. Kept as a list of names only:
 * the route reports whether a name is set, never what it holds.
 */
const REQUIRED_VARIABLES = [
  "NEXT_PUBLIC_CONVEX_URL",
  "SMARTBUZ_JWT_PRIVATE_KEY",
  "SESSION_SECRET",
] as const;

type ProbeStatus =
  | "ok"
  | "not-configured"
  | "timeout"
  | "unreachable"
  | "unexpected-response";

interface HealthBody {
  status: "ok" | "error";
  timestamp: string;
  checks: Array<{
    name: string;
    status: ProbeStatus;
    required: boolean;
    latencyMs: number;
  }>;
  /** Names of the required variables that are not set. Names only. */
  missingVariables: string[];
}

/**
 * Probes the Convex deployment.
 *
 * `/version` is a public HTTP path every Convex deployment serves; it needs
 * no credentials, which matters because the probe must keep working during
 * exactly the incident this endpoint was written for, and at that moment the
 * credentials may well be what was broken. If the deployment does not answer
 * there, `/auth/jwks` is tried: it is public too, and it proves the piece the
 * browser actually depends on - the published signing keys - is being served.
 */
async function probeConvex(baseUrl: string): Promise<{
  status: ProbeStatus;
  latencyMs: number;
}> {
  const started = Date.now();
  const candidates = ["/version", "/auth/jwks"];
  let lastStatus: ProbeStatus = "unreachable";

  for (const path of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        // The body is consumed but never forwarded: it is deployment
        // metadata, and this endpoint is public.
        await response.json().catch(() => null);
        return { status: "ok", latencyMs: Date.now() - started };
      }
      lastStatus = "unexpected-response";
    } catch (error) {
      const aborted =
        (error as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted;
      lastStatus = aborted ? "timeout" : "unreachable";
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: lastStatus, latencyMs: Date.now() - started };
}

export async function GET() {
  const checks: HealthBody["checks"] = [];
  let healthy = true;

  // ---- configuration: names only, never values -----------------------
  const missingVariables: string[] = [];
  for (const name of REQUIRED_VARIABLES) {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
      missingVariables.push(name);
      healthy = false;
    }
  }

  // ---- the Convex deployment -----------------------------------------
  if (!IS_CONVEX_URL_CONFIGURED) {
    // convex-url.ts falls back to a placeholder URL when the variable is
    // absent, so the fallback is detected rather than probed: it would
    // answer a DNS error and look like an outage rather than a mistake.
    checks.push({
      name: "convex",
      status: "not-configured",
      required: true,
      latencyMs: 0,
    });
    healthy = false;
  } else {
    const result = await probeConvex(CONVEX_URL.replace(/\/+$/, ""));
    checks.push({
      name: "convex",
      status: result.status,
      required: true,
      latencyMs: result.latencyMs,
    });
    if (result.status !== "ok") healthy = false;
  }

  const body: HealthBody = {
    status: healthy ? "ok" : "error",
    timestamp: new Date().toISOString(),
    checks,
    missingVariables,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: {
      // Never let a proxy or CDN serve a stale health verdict.
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
