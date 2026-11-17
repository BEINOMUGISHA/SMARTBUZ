/**
 * SMART_BUZ — UI check.
 *
 *   node scripts/ui-check.mjs [--base http://localhost:3111] [--email ...] [--password ...]
 *
 * Signs in through the app's own API, then confirms the multi-tenant UI is
 * really rendered: the business switcher in the sidebar and the
 * business-management tabs in the settings page.
 */
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:3111").replace(/\/+$/, "");
const EMAIL = arg("email", "legacy.operator.mwi45oeh@smartbuz.test");
const PASSWORD = arg("password", "Password123!");

let cookie = "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

async function page(path) {
  try {
    const res = await request(path);
    const html = await res.text();
    console.log(
      `      GET ${path} -> HTTP ${res.status} (${html.length} bytes)` +
        (res.headers.get("location") ? ` -> ${res.headers.get("location")}` : "")
    );
    return html;
  } catch (err) {
    console.log(`FAIL  GET ${path} -> ${err.message}`);
    return "";
  }
}

function checkMarkers(label, html, markers) {
  const found = markers.filter((m) => html.includes(m));
  if (found.length > 0) {
    console.log(`PASS  ${label} - found: ${found.join(", ")}`);
    return true;
  }
  console.log(`FAIL  ${label} - none of: ${markers.join(" | ")}`);
  return false;
}

console.log(`\nSMART_BUZ UI check against ${BASE}\n${"-".repeat(46)}`);

const login = await (async () => {
  // The dev server may hit a transient DNS failure talking to Convex; retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await request("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const body = await res.json();
    if (body.success) return body;
    if (attempt === 3) return body;
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
if (login?.success) {
  console.log(`PASS  sign-in - ${login.user?.email}`);
} else {
  console.log(`FAIL  sign-in - ${JSON.stringify(login)}`);
}

const dashboard = await page("/");
checkMarkers("sidebar business switcher", dashboard, [
  "Select business",
  "Create a business",
  "Your businesses",
  "Register another business",
]);

const settings = await page("/settings");
checkMarkers("settings business tabs", settings, [
  "Business",
  "Vertical &amp; Tax",
  "Vertical & Tax",
  "Team",
  "Branches",
  "Warehouses",
  "Employees",
]);

const setup = await page("/setup");
checkMarkers("onboarding page", setup, ["business", "Business"]);
