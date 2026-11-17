/**
 * SMART_BUZ — identity smoke test.
 *
 * Proves the single most important property of the multi-tenant build: the
 * Convex backend can tell who is calling, and it tells the truth.
 *
 *   node scripts/verify-identity.mjs
 */
import { signAccessToken, convex, createRunner } from "./lib/harness.mjs";

const { check, summary } = createRunner("SMART_BUZ identity verification");

(async () => {
  /* ── 1. anonymous callers get no identity ─────────────────────────── */
  console.log("\nAnonymous");
  const anon = await convex("query", "whoami:whoami", {});
  check("an anonymous query carries no identity", anon.status === "success" && anon.value === null, JSON.stringify(anon.value));

  /* ── 2. a signed token produces a verified identity ───────────────── */
  console.log("\nSigned token");
  const token = signAccessToken({
    userId: "identity-probe-user",
    email: "probe@smartbuz.test",
    name: "Probe",
  });
  const authed = await convex("query", "whoami:whoami", {}, token);
  check("a signed token yields an identity", authed.status === "success" && authed.value !== null, JSON.stringify(authed).slice(0, 200));
  check("the identity carries the subject", authed.value?.subject === "identity-probe-user", authed.value?.subject ?? "(none)");
  check("the identity carries the email", authed.value?.email === "probe@smartbuz.test", authed.value?.email ?? "(none)");
  check("the identity names the issuer", typeof authed.value?.issuer === "string" && authed.value.issuer.length > 0, authed.value?.issuer ?? "(none)");

  /* ── 3. a forged token is rejected ────────────────────────────────── */
  console.log("\nForged token");
  const parts = token.split(".");
  const forged = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}AAAA`;
  const forgedRes = await convex("query", "whoami:whoami", {}, forged);
  check(
    "a tampered signature yields no identity",
    forgedRes.status !== "success" || forgedRes.value === null,
    JSON.stringify(forgedRes).slice(0, 160)
  );

  const swapped = signAccessToken({
    userId: "attacker",
    email: "attacker@evil.test",
    ttlSeconds: 900,
    issuer: "https://evil.example.com",
  });
  const swappedRes = await convex("query", "whoami:whoami", {}, swapped);
  check(
    "a token from a foreign issuer yields no identity",
    swappedRes.status !== "success" || swappedRes.value === null,
    JSON.stringify(swappedRes).slice(0, 160)
  );

  const expired = signAccessToken({
    userId: "identity-probe-user",
    email: "probe@smartbuz.test",
    ttlSeconds: -60,
  });
  const expiredRes = await convex("query", "whoami:whoami", {}, expired);
  check(
    "an expired token yields no identity",
    expiredRes.status !== "success" || expiredRes.value === null,
    JSON.stringify(expiredRes).slice(0, 160)
  );

  process.exit(summary() ? 0 : 1);
})();
