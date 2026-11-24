#!/usr/bin/env node
/**
 * SMARTBUZ — check that the live application is answering.
 *
 * The application returned 503 for most of a day on 23–24 Nov 2026. The
 * Vercel Production environment had lost every variable but one, so each
 * deployment built from that point started without a Convex URL and without a
 * session secret. The failure was visible to anyone who asked for
 * `/api/health` — and nobody asked, because nothing in this repository
 * watched it. The first sign of trouble was a customer.
 *
 * So the health endpoint is polled. This is that poll. It is deliberately
 * small and needs no credentials: the endpoint names the variables it is
 * missing and never their values, so its answer can be printed and logged.
 *
 * The rules it follows:
 *
 *   • A definite answer that is not healthy is a FAILURE. The endpoint
 *     answered, so this is the application's answer and the application is
 *     telling us it is broken.
 *   • No answer at all is INCONCLUSIVE, not a failure. A runner that cannot
 *     reach the internet says nothing about the application, and a gate that
 *     cries wolf is a gate people learn to ignore. It warns and exits 0.
 *   • A transient failure is retried before it is believed.
 *
 * Usage:
 *   node scripts/check-live-health.mjs
 *   SMARTBUZ_HEALTH_URL=https://example.com/api/health node scripts/check-live-health.mjs
 *
 * Exit codes: 0 — healthy, or unreachable (inconclusive). 1 — unhealthy.
 */

const HEALTH_URL = process.env.SMARTBUZ_HEALTH_URL ?? "https://smartbuz.vercel.app/api/health";

/** How many times to ask before believing an answer. */
const ATTEMPTS = Number(process.env.SMARTBUZ_HEALTH_ATTEMPTS ?? 3);

/** How long to wait between attempts, in milliseconds. */
const RETRY_DELAY_MS = Number(process.env.SMARTBUZ_HEALTH_RETRY_MS ?? 15000);

/** How long to wait for the endpoint itself, in milliseconds. */
const REQUEST_TIMEOUT_MS = Number(process.env.SMARTBUZ_HEALTH_TIMEOUT_MS ?? 20000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the endpoint once.
 *
 * @returns {Promise<{answered: boolean, status: number|null, body: string}>}
 *   `answered` is false when the request never completed — that is the
 *   difference between "the application said it is broken" and "we could not
 *   reach it", and the two are not the same event.
 */
async function askOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const body = await response.text();
    return { answered: true, status: response.status, body };
  } catch {
    return { answered: false, status: null, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this a healthy application?
 *
 * The endpoint answers 200 with `status: "ok"` when every required dependency
 * answers and every required variable is set. Anything else is a fault, and
 * the body says which.
 */
function isHealthy(result) {
  if (result.status !== 200) return false;
  try {
    const parsed = JSON.parse(result.body);
    return parsed && parsed.status === "ok" && Array.isArray(parsed.missingVariables) && parsed.missingVariables.length === 0;
  } catch {
    // A 200 that is not the JSON we expect is still a fault: the endpoint
    // cannot be relied on to say whether the application is well.
    return false;
  }
}

async function main() {
  console.log("check-live-health: the live application");
  console.log(`  url            : ${HEALTH_URL}`);
  console.log(`  attempts       : ${ATTEMPTS}`);
  console.log("");

  let last = { answered: false, status: null, body: "" };

  for (let attempt = 1; attempt <= Math.max(1, ATTEMPTS); attempt += 1) {
    last = await askOnce();

    if (!last.answered) {
      console.log(`  attempt ${attempt}: no answer`);
    } else {
      console.log(`  attempt ${attempt}: HTTP ${last.status}`);
    }

    if (isHealthy(last)) {
      console.log("");
      console.log("PASS: the live application reports itself healthy.");
      return;
    }

    // An answer that came back is the application's own answer. Retrying a
    // definite "I am broken" only delays the report; retrying a request that
    // never completed is worth doing.
    if (last.answered) break;

    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  console.log("");

  if (!last.answered) {
    console.log("::warning::The health endpoint could not be reached from here.");
    console.log("::warning::This is inconclusive - it may be this machine's network rather than");
    console.log("::warning::the application. Check it by hand:");
    console.log("::warning::  curl -s -i " + HEALTH_URL);
    console.log("");
    console.log("INCONCLUSIVE: the application was not reached, so it was not judged.");
    return;
  }

  console.error("::error::The live application is not healthy: HTTP " + last.status);
  if (last.body) {
    console.error(last.body);
  }
  console.error("");
  console.error("The application was down for most of a day on 23-24 Nov 2026 because the Vercel");
  console.error("Production environment lost its variables and nothing was watching for it.");
  console.error("See docs/RUNBOOK.md section 5.2 for what to check, in order.");
  process.exit(1);
}

await main();
