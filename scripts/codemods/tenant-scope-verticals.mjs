/**
 * SMART_BUZ — one-off codemod that moves the vertical modules onto the
 * multi-tenant model.
 *
 *   node scripts/tenant-scope-verticals.mjs
 *
 * The three vertical modules (scheduling, members, operations) all share the
 * same legacy shape: a `businessProfileId` pointer that nothing enforced, a
 * `getActiveBusinessId(ctx)` helper that picked "the active profile", and
 * reads that filtered in memory with
 *
 *     if (businessId) rows = rows.filter(r => !r.businessProfileId || r.businessProfileId === businessId);
 *
 * The replacement is the tenant model: the business comes from the caller's
 * membership, and every row must carry that business id.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const FILES = ["scheduling.ts", "members.ts", "operations.ts"];

let totalChanged = 0;

for (const file of FILES) {
  const full = path.join(ROOT, "convex", "verticals", file);
  let src = fs.readFileSync(full, "utf8");
  const before = src;

  /* 1 ── imports */
  src = src.replace(
    'import { getActiveBusinessId } from "./batches";',
    'import { ConvexError } from "convex/values";\nimport { logActivity, requirePermission, requireTenant } from "../tenancy";'
  );

  /* 2 ── tenant resolution replaces the profile lookup */
  src = src.replace(
    /const businessId = await getActiveBusinessId\(ctx\);/g,
    "const tenant = await requireTenant(ctx, args.businessId);\n        const businessId = tenant.businessId;"
  );

  /* 3 ── in-memory tenant filters become strict businessId filters */
  src = src.replace(
    /if \(businessId\) (\w+) = \1\.filter\(\(r\) => !r\.businessProfileId \|\| r\.businessProfileId === businessId\);/g,
    "$1 = $1.filter((r) => r.businessId === businessId);"
  );

  /* 4 ── writes carry the tenant */
  src = src.replace(/businessProfileId: businessId,/g, "businessId,");
  src = src.replace(/businessProfileId: businessId\n/g, "businessId\n");

  /* 5 ── the actor comes from the session, not from an argument */
  src = src.replace(/userId: args\.userId,/g, "userId: tenant.user._id,");

  /* 6 ── every handler resolves the tenant first */
  src = src.replace(
    /handler: async \(ctx, args\) => \{\n(?!\s*const tenant = await requireTenant)/g,
    "handler: async (ctx, args) => {\n        const tenant = await requireTenant(ctx, args.businessId);\n"
  );

  /* 7 ── an optional businessId argument on every function */
  src = src.replace(/args: \{([^}]*)\}/g, (match, inner) => {
    if (inner.includes("businessId:")) return match;
    const trimmed = inner.replace(/\s+$/, "");
    if (!trimmed) return `args: { businessId: v.optional(v.id("businesses")) }`;
    const needsComma = !trimmed.endsWith(",");
    return `args: {${trimmed}${needsComma ? "," : ""} businessId: v.optional(v.id("businesses")) }`;
  });

  if (src !== before) {
    fs.writeFileSync(full, src, "utf8");
    totalChanged++;
    console.log(`patched ${file}`);
  } else {
    console.log(`unchanged ${file}`);
  }
}

console.log(`\n${totalChanged} file(s) patched.`);
console.log(
  "\nRemaining manual work:\n" +
    "  • ctx.db.get(args.id) sites must be ownership-checked\n" +
    "  • activityLogs inserts must carry businessId\n" +
    "  • handlers that reference `tenant` but no longer resolve it\n" +
    "  • remaining references to businessProfileId"
);
