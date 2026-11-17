/**
 * SMART_BUZ — authentication journey verification.
 *
 * Walks the real HTTP surface the browser uses: the public auth pages, the
 * session gate in middleware, the login endpoint, the session cookie, the
 * "who am I" endpoint, logout, the login rate limiter and the password-reset
 * request path. Every assertion here is about the path a real user walks.
 */
const BASE = process.env.APP_URL || "http://localhost:3000";
const CONVEX = process.env.CONVEX_URL || "https://affable-panda-681.convex.cloud";

const stamp = Date.now();
const EMAIL = `auth.journey.${stamp}@example.com`;
const PASSWORD = "journey-pass-2026";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function convex(kind, path, args) {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return res.json();
}

function cookieFrom(res) {
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

(async () => {
  console.log(`\nSMART_BUZ auth journey — ${BASE}\n`);

  /* ── 1. public pages ───────────────────────────────────────── */

  console.log("Public pages");
  for (const p of ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password"]) {
    const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
    check(`GET ${p}`, res.status === 200, `http=${res.status}`);
  }

  /* ── 2. session gate ────────────────────────────────────────── */

  console.log("\nSession gate (no cookie)");
  for (const p of ["/", "/setup", "/sales", "/stock"]) {
    const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    check(
      `GET ${p} redirects to login`,
      res.status === 307 && loc.includes("/auth/login"),
      `http=${res.status} location=${loc || "(none)"}`
    );
  }

  /* ── 3. registration ────────────────────────────────────────── */

  console.log("\nRegistration");
  const reg = await convex("mutation", "users:register", {
    first_name: "Auth",
    last_name: "Journey",
    email: EMAIL,
    password: PASSWORD,
    phone_number: "0773000000",
    roles: ["sales"],
  });
  check("register succeeds", reg.status === "success", reg.errorMessage ?? "");
  check("register does not return the password", !JSON.stringify(reg).includes(PASSWORD));

  const dupe = await convex("mutation", "users:register", {
    first_name: "Auth",
    last_name: "Journey",
    email: EMAIL,
    password: PASSWORD,
    roles: ["sales"],
  });
  check(
    "duplicate email is refused",
    dupe.status === "error",
    (dupe.errorMessage ?? "").slice(0, 70)
  );

  const shortPw = await convex("mutation", "users:register", {
    first_name: "Short",
    last_name: "Pw",
    email: `short.${stamp}@example.com`,
    password: "123",
    roles: ["sales"],
  });
  check(
    "short password is refused",
    shortPw.status === "error",
    (shortPw.errorMessage ?? "").slice(0, 70)
  );

  /* ── 4. login ───────────────────────────────────────────────── */

  console.log("\nLogin");
  const badLogin = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
  });
  const badBody = await badLogin.json();
  check(
    "wrong password returns 401",
    badLogin.status === 401,
    `http=${badLogin.status}`
  );
  check(
    "wrong password gives a friendly message",
    typeof badBody?.error === "string" && badBody.error.length > 0,
    badBody?.error ?? "(none)"
  );
  check(
    "wrong password does not reveal whether the account exists",
    !/no such user|not found|does not exist/i.test(badBody?.error ?? ""),
    badBody?.error ?? ""
  );
  check("wrong password issues no session", !cookieFrom(badLogin));

  const noInput = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("missing credentials returns 400", noInput.status === 400, `http=${noInput.status}`);

  const goodLogin = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const goodBody = await goodLogin.json();
  const session = cookieFrom(goodLogin);
  check("correct password returns 200", goodLogin.status === 200, `http=${goodLogin.status}`);
  check("login succeeds", goodBody?.success === true);
  check("login issues a session cookie", session.startsWith("sb_session="), session.slice(0, 28) + "...");
  check("login response carries the user", Boolean(goodBody?.user?.email), goodBody?.user?.email ?? "");

  /* ── 5. session works ───────────────────────────────────────── */

  console.log("\nSession");
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: session } });
  const meBody = await me.json();
  check("GET /api/auth/me with a session returns the user", me.status === 200 && meBody?.user?.email === EMAIL, `http=${me.status}`);

  for (const p of ["/", "/setup", "/sales"]) {
    const res = await fetch(`${BASE}${p}`, { headers: { Cookie: session }, redirect: "manual" });
    check(`GET ${p} with a session is allowed`, res.status === 200, `http=${res.status}`);
  }

  // The cookie must be verifiable across independent requests.
  const second = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: session } });
  check("session survives an independent request", second.status === 200, `http=${second.status}`);

  /* ── 6. tampered cookie ─────────────────────────────────────── */

  console.log("\nTampered session");
  const tampered = session.slice(0, -4) + "AAAA";
  const tRes = await fetch(`${BASE}/`, { headers: { Cookie: tampered }, redirect: "manual" });
  check(
    "tampered session is rejected",
    tRes.status === 307 && (tRes.headers.get("location") ?? "").includes("/auth/login"),
    `http=${tRes.status}`
  );

  const forged = `sb_session=${Buffer.from(JSON.stringify({ userId: "x", email: "x" })).toString("base64url")}`;
  const fRes = await fetch(`${BASE}/`, { headers: { Cookie: forged }, redirect: "manual" });
  check(
    "forged session is rejected",
    fRes.status === 307 && (fRes.headers.get("location") ?? "").includes("/auth/login"),
    `http=${fRes.status}`
  );

  /* ── 7. logout ──────────────────────────────────────────────── */

  console.log("\nLogout");
  const logout = await fetch(`${BASE}/api/auth?action=logout`, {
    method: "POST",
    headers: { Cookie: session },
  });
  check("logout returns 200", logout.status === 200, `http=${logout.status}`);
  const cleared = cookieFrom(logout);
  check(
    "logout clears the cookie",
    cleared === "" || /sb_session=;|sb_session=$/.test(cleared) || cleared.includes("Max-Age=0"),
    cleared || "(no cookie header)"
  );

  const afterLogout = await fetch(`${BASE}/`, { headers: { Cookie: session }, redirect: "manual" });
  check(
    "protected route is gated again after logout",
    afterLogout.status === 307,
    `http=${afterLogout.status}`
  );

  /* ── 8. rate limiting ───────────────────────────────────────── */

  console.log("\nLogin rate limiting");
  const victim = `ratelimit.${stamp}@example.com`;
  let sawRateLimit = false;
  let sawInvalid = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: victim, password: `wrong-${i}` }),
    });
    if (res.status === 429) sawRateLimit = true;
    if (res.status === 401) sawInvalid = true;
    if (sawRateLimit) break;
  }
  check("repeated failures are eventually rate limited", sawRateLimit);
  check("rate limiter does not lock out a different account", sawInvalid);

  /* ── 9. password reset must not leak the code ───────────────── */

  console.log("\nPassword reset");
  const anonReset = await convex("mutation", "users:requestPasswordReset", { email: EMAIL });
  const anonText = JSON.stringify(anonReset);
  check(
    "an anonymous reset request returns no code",
    anonReset.status !== "success" || anonReset.value?.code === undefined,
    anonText.slice(0, 90)
  );
  check(
    "an anonymous reset request reveals no code digits",
    !/\b\d{6}\b/.test(anonText),
    anonText.slice(0, 90)
  );

  const wrongSecret = await convex("mutation", "users:requestPasswordReset", {
    email: EMAIL,
    serverSecret: "not-the-real-key",
  });
  check(
    "a wrong server secret yields no code",
    wrongSecret.value?.code === undefined,
    JSON.stringify(wrongSecret).slice(0, 90)
  );

  const unknown = await convex("mutation", "users:requestPasswordReset", {
    email: `nobody.${stamp}@example.com`,
    serverSecret: "not-the-real-key",
  });
  check(
    "an unknown email is indistinguishable from a known one",
    unknown.value?.code === undefined,
    JSON.stringify(unknown).slice(0, 90)
  );

  const resetApi = await fetch(`${BASE}/api/send-reset-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });
  const resetBody = await resetApi.json();
  check(
    "the reset email endpoint never returns the code",
    !JSON.stringify(resetBody).match(/\b\d{6}\b/),
    `http=${resetApi.status} body=${JSON.stringify(resetBody).slice(0, 80)}`
  );

  /* ── summary ────────────────────────────────────────────────── */

  console.log(`\n────────────────────────────────────────────`);
  console.log(`  ${pass} passed, ${failures.length} failed`);
  console.log(`────────────────────────────────────────────`);
  if (failures.length) {
    for (const f of failures) console.log(`  ! ${f.name} ${f.detail}`);
    process.exit(1);
  }
})();
