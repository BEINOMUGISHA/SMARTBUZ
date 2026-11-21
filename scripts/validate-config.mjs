#!/usr/bin/env node
/**
 * Production configuration validator (BUG-052).
 *
 * The 19 Nov 2026 outage was not a code bug. `SMARTBUZ_JWT_PRIVATE_KEY` had
 * never been added to the Vercel project, so `/api/auth/convex-token` answered
 * 503 for every signed-in browser and Convex treated every request as
 * anonymous. The configuration that makes the system work lived only in a
 * dashboard, was never versioned, and was never validated - so a build
 * succeeded and the breakage was discovered by a customer.
 *
 * This script turns that class of outage into a pre-flight failure. It checks
 * every environment variable the application actually reads, verifies it is
 * present, long enough and correctly formed, and exits non-zero with a list of
 * what is wrong.
 *
 * Rules this script deliberately obeys:
 *   - A secret's VALUE is never printed - only the variable's name, its
 *     length and the shape it must have. A build log is not a secret store.
 *   - Node standard library only; no new npm dependency.
 *   - It runs against a local `.env.local` and in CI with placeholder values,
 *     so every check is about SHAPE, never about a secret being live.
 *
 * Usage:
 *   node scripts/validate-config.mjs [--env-file .env.local] [--prod] [--quiet]
 *
 *   --env-file <path>  Also load values from a dotenv-style file. Defaults to
 *                      `.env.local` when it exists.
 *   --prod             Treat the environment as a production deployment:
 *                      optional integrations become required, and obvious
 *                      placeholder values are rejected.
 *   --quiet            Print only the summary line and any problems.
 *
 * Exit codes: 0 = every required variable is present and well formed,
 *              1 = at least one problem was found,
 *              2 = the script itself could not run.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPrivateKey } from "node:crypto";

/* ------------------------------------------------------------------ *
 * Minimal dotenv reader.
 *
 * We deliberately do not use dotenv: the script has to stay dependency free,
 * and the subset of the format this project actually uses (KEY=value, optional
 * quotes, optional `export ` prefix, `#` comments) is small enough to parse
 * correctly in a few lines.
 * ------------------------------------------------------------------ */
function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ")
      ? line.slice(7).trim()
      : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Check definitions.
 *
 * Each entry carries:
 *   required      - the application is broken without it
 *   prodRequired  - the application is degraded without it in production
 *   minLength     - the shortest plausible value; anything shorter is a
 *                   truncation or a paste error
 *   pattern       - the shape the value must match
 *   patternHint   - how to describe that shape in an error message
 *   describe      - what the value is used for, and what breaks without it
 * ------------------------------------------------------------------ */
const CHECKS = [
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    required: true,
    minLength: 12,
    pattern: /^https:\/\/[a-z0-9-]+\.convex\.cloud\/?$/i,
    patternHint: "must be https://<deployment>.convex.cloud",
    describe:
      "Convex deployment the browser talks to. Inlined into the client bundle at build time.",
  },
  {
    name: "NEXT_PUBLIC_CONVEX_SITE_URL",
    required: false,
    prodRequired: true,
    minLength: 12,
    pattern: /^https:\/\/[a-z0-9-]+\.convex\.site\/?$/i,
    patternHint: "must be https://<deployment>.convex.site",
    describe:
      "The deployment's site URL. The backend publishes its JWKS here and every access token claims this issuer.",
  },
  {
    name: "SMARTBUZ_JWT_PRIVATE_KEY",
    required: true,
    minLength: 256,
    pattern: /^[A-Za-z0-9_-]+$/,
    patternHint:
      "must be the PKCS#8 DER key, base64url encoded (see scripts/generate-auth-keys.mjs)",
    describe:
      "RSA private key that signs the short-lived access tokens. Missing => every request 503s. Missing on the Convex side => the tokens are rejected.",
  },
  {
    name: "SESSION_SECRET",
    required: true,
    minLength: 32,
    pattern: /^[\x21-\x7e]+$/,
    patternHint: "must be at least 32 printable, non-whitespace characters",
    describe:
      "Signs the session cookie. The session helpers throw outright when it is missing or shorter than 32 characters.",
  },
  {
    name: "SMARTBUZ_SERVER_SECRET",
    required: false,
    prodRequired: true,
    minLength: 16,
    pattern: /^[\x21-\x7e]+$/,
    patternHint: "must be at least 16 printable, non-whitespace characters",
    describe:
      "Shared secret between the Next.js server and the Convex deployment. Gates session opening, password-reset codes and verification emails.",
  },
  {
    name: "RESEND_API_KEY",
    required: false,
    minLength: 20,
    pattern: /^re_[A-Za-z0-9_-]+$/,
    patternHint: "must look like a Resend key (re_ followed by more characters)",
    describe:
      "Transactional email provider key. Without it, password reset and email verification are silently skipped.",
  },
  {
    name: "RESEND_FROM_EMAIL",
    required: false,
    minLength: 3,
    pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
    patternHint: "must be a sender address containing '@'",
    describe: "From: address on transactional email. Defaults to noreply@smartbuz.app.",
  },
  {
    name: "NEXT_PUBLIC_APP_VERSION",
    required: false,
    minLength: 1,
    describe:
      "Version stamped on offline devices, so a client can tell whether its cache is stale.",
  },
];

/**
 * The server secret is accepted from any of three variables, in this order
 * (see convex/serverSecret.ts). The group is satisfied by one of them; the
 * preferred one is named first because falling back to the email provider key
 * means rotating the email key silently rotates the server secret too.
 */
const SERVER_SECRET_GROUP = [
  "SMARTBUZ_SERVER_SECRET",
  "RESEND_API_KEY",
  "SESSION_SECRET",
];

function decodeBase64Url(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

/**
 * Checks that a base64url value really is a PKCS#8 private key.
 *
 * Only values that actually look like DER are put through Node's parser: a
 * CI placeholder is a plain string, not a key, and rejecting it would make the
 * script unusable in the one place it most needs to run unattended.
 */
function checkPrivateKeyShape(value) {
  let bytes;
  try {
    bytes = decodeBase64Url(value);
  } catch {
    return "is not valid base64url";
  }
  // A DER SEQUENCE starts with 0x30. Anything else is not a DER structure,
  // so there is nothing further to check.
  if (bytes.length === 0 || bytes[0] !== 0x30) return null;
  try {
    const key = createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "rsa") {
      return `decodes to a ${key.asymmetricKeyType} key, but the tokens are signed with RS256 (RSA)`;
    }
    return null;
  } catch {
    return "decodes to a DER structure but is not a readable PKCS#8 private key (truncated, or pasted the wrong half of the pair)";
  }
}

function run() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "env-file": { type: "string", default: "" },
        prod: { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    process.stderr.write(`validate-config: ${error.message}\n`);
    return 2;
  }

  const prodMode =
    parsed.values.prod ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  const quiet = Boolean(parsed.values.quiet);
  const envFilePath = parsed.values["env-file"]
    ? resolve(parsed.values["env-file"])
    : resolve(".env.local");

  const problems = [];
  const notes = [];
  const report = [];

  // Merge order: the process environment wins, because that is what actually
  // reaches the running app. The file only fills the gaps.
  const fromFile = {};
  if (existsSync(envFilePath)) {
    try {
      Object.assign(fromFile, parseEnvFile(readFileSync(envFilePath, "utf8")));
    } catch (error) {
      problems.push({
        name: envFilePath,
        reason: `could not be read: ${error.code || error.message}`,
      });
    }
  } else {
    notes.push(`No ${envFilePath} found; validating the process environment only.`);
  }

  const get = (name) => {
    const fromProcess = process.env[name];
    if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
    const fromFileValue = fromFile[name];
    if (fromFileValue !== undefined && fromFileValue !== "") return fromFileValue;
    return undefined;
  };

  for (const check of CHECKS) {
    const value = get(check.name);
    const required =
      check.required || (prodMode && check.prodRequired === true);

    if (value === undefined) {
      if (required) {
        problems.push({
          name: check.name,
          reason: "is not set (required)",
          hint: check.describe,
        });
        report.push({ name: check.name, status: "MISSING" });
      } else {
        report.push({ name: check.name, status: "skipped" });
      }
      continue;
    }

    const failures = [];

    if (value.length < check.minLength) {
      failures.push(
        `is too short (${value.length} characters, need at least ${check.minLength})`,
      );
    }

    if (check.pattern && !check.pattern.test(value)) {
      failures.push(check.patternHint);
    }

    if (check.name === "SMARTBUZ_JWT_PRIVATE_KEY" && value.length >= check.minLength) {
      const keyProblem = checkPrivateKeyShape(value);
      if (keyProblem) failures.push(keyProblem);
    }

    // A value that is present but is still an obvious placeholder is a
    // configuration failure in disguise; catching it here is the point.
    if (
      prodMode &&
      required &&
      /^(changeme|change_me|placeholder|your[-_ ]|xxx+|<.*>|\.\.\.)$/i.test(value)
    ) {
      failures.push("still contains a placeholder value");
    }

    if (failures.length > 0) {
      problems.push({ name: check.name, reason: failures.join("; "), hint: check.describe });
      report.push({ name: check.name, status: "INVALID" });
    } else {
      report.push({ name: check.name, status: "ok" });
    }
  }

  // ---- the server secret group -------------------------------------
  // convex/serverSecret.ts accepts three variables in order. The group as a
  // whole must resolve to something of at least 16 characters, otherwise every
  // server-to-backend operation stays closed.
  const secretCandidates = SERVER_SECRET_GROUP.map((name) => ({
    name,
    value: get(name),
  })).filter((candidate) => candidate.value && candidate.value.length >= 16);

  if (secretCandidates.length === 0) {
    problems.push({
      name: SERVER_SECRET_GROUP.join(" / "),
      reason: "none of them is set to a value of at least 16 characters",
      hint:
        "The shared secret between the Next.js server and the Convex deployment. Set SMARTBUZ_SERVER_SECRET explicitly; it must have the SAME value in the Convex dashboard.",
    });
    report.push({ name: "server secret", status: "MISSING" });
  } else {
    report.push({ name: "server secret", status: "ok" });
    notes.push(
      `Server secret resolved from ${secretCandidates[0].name}. The Convex deployment must hold the same value.`,
    );
  }

  // ---- cross-variable consistency -----------------------------------
  // The browser and the server must talk to the same deployment, and the
  // issuer must be the site twin of the client URL. A mismatch here is the
  // classic "it works in the browser but the token is rejected" failure.
  const clientUrl = get("NEXT_PUBLIC_CONVEX_URL");
  const siteUrl = get("NEXT_PUBLIC_CONVEX_SITE_URL");

  if (clientUrl && siteUrl) {
    const expectedSite = clientUrl
      .replace(/\/+$/, "")
      .replace(/\.convex\.cloud$/i, ".convex.site");
    const actualSite = siteUrl.replace(/\/+$/, "");
    if (expectedSite.toLowerCase() !== actualSite.toLowerCase()) {
      problems.push({
        name: "NEXT_PUBLIC_CONVEX_SITE_URL",
        reason: "is not the site URL of NEXT_PUBLIC_CONVEX_URL (the deployments do not match)",
        hint: "The issuer in every access token must be the site URL of the deployment that will verify it.",
      });
    }
  } else if (clientUrl && prodMode) {
    notes.push(
      "NEXT_PUBLIC_CONVEX_SITE_URL is not set; the issuer is derived from NEXT_PUBLIC_CONVEX_URL. Set it explicitly so a typo cannot silently change the issuer.",
    );
  }

  // ---- output --------------------------------------------------------
  const out = [];
  out.push("validate-config: production configuration check");
  out.push(`  mode           : ${prodMode ? "production" : "development"}`);
  out.push(`  env file       : ${envFilePath}${existsSync(envFilePath) ? "" : " (not found)"}`);
  if (!quiet) {
    out.push("");
    for (const entry of report) {
      const marker =
        entry.status === "ok"
          ? "ok      "
          : entry.status === "MISSING"
            ? "MISSING "
            : entry.status === "INVALID"
              ? "INVALID "
              : "skipped ";
      out.push(`  [${marker}] ${entry.name}`);
    }
    for (const note of notes) out.push(`  note: ${note}`);
    out.push("");
  }

  if (problems.length === 0) {
    out.push(
      `PASS: ${report.filter((entry) => entry.status === "ok").length} variable group(s) valid.`,
    );
    process.stdout.write(out.join("\n") + "\n");
    return 0;
  }

  out.push(`FAIL: ${problems.length} configuration problem(s) found:`);
  for (const problem of problems) {
    out.push(`  - ${problem.name} ${problem.reason}`);
    if (problem.hint) out.push(`      ${problem.hint}`);
  }
  out.push("");
  out.push(
    "Values are never printed. Fix the variables listed above in the deployment environment.",
  );
  process.stdout.write(out.join("\n") + "\n");
  return 1;
}

process.exit(run());
