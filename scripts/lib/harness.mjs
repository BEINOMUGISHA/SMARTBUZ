/**
 * SMART_BUZ — shared helpers for the verification scripts.
 *
 * Loads .env.local, mints the same RS256 access tokens the Next.js server
 * mints, and talks to the Convex HTTP API the same way the browser does —
 * including the `Authorization: Bearer` header that carries the caller's
 * identity.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

/** Parse a .env file into a plain object (no interpolation, no quoting magic). */
export function loadEnv(file = path.join(ROOT, ".env.local")) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export const ENV = { ...loadEnv(), ...process.env };

export const CONVEX_URL = (ENV.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210").replace(/\/+$/, "");
export const SITE_URL = (
  ENV.NEXT_PUBLIC_CONVEX_SITE_URL || CONVEX_URL.replace(/\.convex\.cloud$/, ".convex.site")
).replace(/\/+$/, "");

const AUDIENCE = "smartbuz";

/** Base64url encode a JSON-serialisable value. */
function b64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

/**
 * Mint an RS256 access token exactly the way `src/lib/convex-token.ts` does.
 */
export function signAccessToken({ userId, email, name, ttlSeconds = 900, issuer = SITE_URL }) {
  const secret = ENV.SMARTBUZ_JWT_PRIVATE_KEY;
  if (!secret) {
    throw new Error(
      "SMARTBUZ_JWT_PRIVATE_KEY is not set. Run `node scripts/generate-auth-keys.mjs` and " +
        "add the printed value to .env.local."
    );
  }
  const der = Buffer.from(secret.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const privateKey = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "bfaad149116db910" };
  const payload = {
    iss: issuer,
    aud: AUDIENCE,
    sub: userId,
    email,
    name,
    iat: now,
    exp: now + ttlSeconds,
  };

  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Call the Convex HTTP API.
 *
 * `token` is the caller's access token. Without it the request is anonymous —
 * which is exactly what an attacker looks like, and what the tenant guards
 * must reject.
 *
 * Transient network failures (DNS hiccups, connect timeouts) are retried: a
 * flaky connection must not be reported as a failed assertion.
 */
export async function convex(kind, fnPath, args = {}, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = JSON.stringify({ path: fnPath, args, format: "json" });

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
        method: "POST",
        headers,
        body,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { status: "error", errorMessage: text.slice(0, 400) };
      }
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** True when a Convex response reports a successful call. */
export function ok(response) {
  return response?.status === "success";
}

/** Short, human-readable error for a failed Convex response. */
export function errText(response) {
  if (!response) return "(no response)";
  if (response.status === "error") {
    // A ConvexError carries its message in `errorData`.
    if (typeof response.errorData === "string" && response.errorData) {
      return response.errorData.slice(0, 200);
    }
    const message = String(response.errorMessage ?? "");
    // Otherwise Convex masks the message: "[Request ID: …] Server Error\nUncaught ConvexError: …".
    const uncaught = /Uncaught ConvexError: ([^\n]+)/.exec(message);
    if (uncaught) return uncaught[1].slice(0, 200);
    if (response.error) return String(response.error).slice(0, 200);
    const firstLine = message.split("\n").pop() ?? message;
    return firstLine.slice(0, 200) || "unknown error";
  }
  return JSON.stringify(response).slice(0, 200);
}

/* ── tiny test harness ──────────────────────────────────────────────── */

export function createRunner(title) {
  let pass = 0;
  const failures = [];
  console.log(`\n${title}\n${"-".repeat(title.length)}`);

  function check(name, condition, detail = "") {
    if (condition) {
      pass++;
      console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
    } else {
      failures.push({ name, detail });
      console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    }
  }

  function summary() {
    console.log(`\n${"-".repeat(46)}`);
    console.log(`  ${pass} passed, ${failures.length} failed`);
    console.log(`${"-".repeat(46)}`);
    for (const f of failures) console.log(`  ! ${f.name} ${f.detail}`);
    return failures.length === 0;
  }

  return { check, summary, get passed() { return pass; } };
}
