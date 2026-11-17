/**
 * SMART_BUZ — static tenant-guard audit.
 *
 *   node scripts/audit-tenant-guards.mjs
 *
 * Reads every `convex/**\/*.ts` module and checks that each exported query,
 * mutation and action either
 *
 *   • calls a tenancy guard (`requireTenant`, `requireUser`, `requireIdentity`,
 *     `requireMembership`, `requireRole`, `requirePermission`), or
 *   • is one of the deliberately public entry points.
 *
 * It is a lint, not a proof — the isolation suite is the proof — but it
 * catches a handler that was added without a guard.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/harness.mjs";

const GUARDS = [
  "requireTenant",
  "requireUser",
  "requireIdentity",
  "requireMembership",
  "requireRole",
  "requirePermission",
  "resolveBusinessId",
  "assertSameBusiness",
  "loadTenantDocument",
  // Wrappers that resolve to one of the guards above.
  "requireAdmin",
  "requireSelfOrAdmin",
  "requireMigrationOperator",
];

/**
 * The public surface: how somebody arrives, and how they register a
 * business. Everything else must carry a guard.
 */
const PUBLIC = new Set([
  "users.register",
  "users.login",
  "users.requestPasswordReset",
  "users.resetPassword",
  "businesses.register",
  // Reads back the caller's *own* verified identity — no tenant data. It is
  // what the identity smoke test asserts against.
  "whoami.whoami",
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated" || entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

const convexDir = path.join(ROOT, "convex");
const findings = [];
let total = 0;
let guarded = 0;

for (const file of walk(convexDir)) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);

  // Each exported function, with the body that follows it.
  const pattern = /export const (\w+) = (query|mutation|action|internalQuery|internalMutation)\(\{([\s\S]*?)\n\}\);/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, name, kind, body] = match;
    const moduleName = path.basename(file, ".ts");
    const fnPath = `${moduleName}.${name}`;
    total += 1;

    const hasGuard = GUARDS.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body));
    const isPublic = PUBLIC.has(fnPath);

    if (hasGuard || isPublic) {
      guarded += 1;
    } else {
      findings.push({ fnPath, kind, relative });
    }
  }
}

console.log(`\nTenant guard audit — ${convexDir}`);
console.log("-".repeat(60));
console.log(`  exported functions : ${total}`);
console.log(`  guarded or public  : ${guarded}`);
console.log(`  unguarded          : ${findings.length}`);
console.log("-".repeat(60));

for (const f of findings) {
  console.log(`  ! ${f.fnPath} (${f.kind}) — ${f.relative}`);
}

if (findings.length > 0) {
  console.log(
    "\nEach of these must be public by design, or must call a tenancy guard."
  );
}

process.exit(findings.length === 0 ? 0 : 1);
