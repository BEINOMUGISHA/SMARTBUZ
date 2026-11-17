# SMART_BUZ — multi-tenant migration guide

How to take a deployment that still holds single-tenant data and move it to
the multi-tenant model **without losing a single record**.

- [What changed](#what-changed)
- [Before you start](#before-you-start)
- [The migration](#the-migration)
- [What the migration does, step by step](#what-the-migration-does-step-by-step)
- [Verifying the result](#verifying-the-result)
- [After the migration](#after-the-migration)
- [Rollback](#rollback)
- [Troubleshooting](#troubleshooting)

---

## What changed

| Before | After |
| --- | --- |
| One global set of users, products and sales | Many businesses, each with its own data |
| `businessProfiles` — a single decorative row nobody enforced | `businesses` — the tenant, with real settings |
| No notion of "who may see what" | `memberships` — a user may belong to many businesses, each with its own role |
| `users.roles` decided what the *whole installation* could do | The role inside a membership decides what a user may do *in that business* |
| The backend was a public API: any caller could read any table | Every protected query derives the caller from a signed token and filters by their business |
| Client-supplied `adminUserId` / `email` decided who you were | `ctx.auth.getUserIdentity()` decides, and the client cannot forge it |
| Rows had no tenant pointer | Every tenant-owned row carries `businessId` and is indexed by it |

Full detail of the model is in [`convex/TENANCY-GUIDE.md`](../convex/TENANCY-GUIDE.md).

## Before you start

1. **Back up the deployment.** The migration only adds rows and patches
   existing ones — it never deletes — but take a snapshot anyway.

   ```bash
   npx convex export --path ./backup
   ```

2. **Deploy the new functions first.** The schema change is additive: new
   tables, a new `businessId` column on the existing tables and new indexes.
   Existing rows stay valid because `businessId` is optional in the schema.

   ```bash
   npx convex deploy
   ```

3. **Generate the access-token key** (only if the deployment does not have
   one yet). The backend now verifies the caller's identity against the
   deployment's own JWKS endpoint.

   ```bash
   node scripts/generate-auth-keys.mjs
   ```

   Add the printed `SMARTBUZ_JWT_PRIVATE_KEY` to `.env.local` (server) and
   to the deployment's environment variables (the `convex/auth.config.ts`
   issuer is derived from `CONVEX_SITE_URL`, so nothing else is needed).

4. **Know the administrator account** that will run the migration. It must
   be the owner (or an administrator) of a business — the server checks the
   caller's membership, so a random signed-in account is refused.

## The migration

```bash
node scripts/migrate-to-multitenancy.mjs --email admin@pos.com --password '…'
```

The credentials may also come from `MIGRATION_EMAIL` / `MIGRATION_PASSWORD`
in `.env.local`.

The script:

1. signs in as that account (`users:login`),
2. mints the same short-lived access token the browser gets,
3. reports the state of the deployment *before* the migration,
4. runs the three migration steps,
5. reports the state *after* the migration.

It is safe to run more than once: the second run finds everything already
migrated and changes nothing. See
[Idempotency](#idempotency-and-safety) for what "nothing" means exactly.

Pass `--business <id>` when the legacy data belongs to a specific business;
otherwise the server picks it — the business that the operator's own legacy
profile became, or the one they own.

## What the migration does, step by step

### 1. Legacy business profiles become real businesses

Every row of `businessProfiles` is copied into `businesses`, field for
field: name, vertical, industry, modules, currency, country, tax settings,
address, phone, plan and subscription state.

The copy is matched by name, so a second run does not create duplicates.
The legacy rows are **left in place** — they are marked deprecated in the
schema and can be dropped in a later release once every deployment has been
migrated.

### 2. Memberships are created

| Who | Gets |
| --- | --- |
| The owner of a legacy profile | An `owner` membership in the business that profile became |
| The person who ran a shop | A membership in the business that shop belongs to |
| Everybody else | A membership in the primary business, with the role their legacy `users.roles` array implied (`admin` → admin, `sales` → cashier, `stock` → stock, `reports` → viewer) |

The legacy role mapping lives in `convex/tenancy.ts` (`LEGACY_ROLE_MAP` /
`roleFromLegacyRoles`).

Two rules keep the migration from damaging a deployment that is *already*
multi-tenant:

- a user who already belongs to a business **keeps** it — the migration never
  drags an existing tenant's people into the legacy business;
- a user with no membership at all was part of the old single business and
  goes to the primary one.

Nobody loses access to the data they could see before: the migration gives
every user a membership, and sets `activeBusinessId` when they have not
chosen a business yet. A user who already had an active business stays where
they are — the business switcher is how they reach the migrated one.

### 3. Every tenant row is stamped

The legacy data was global — it was never partitioned — so it all belongs
to the primary business. The migration patches `businessId` onto:

`categories`, `stocks`, `customers`, `promotions`, `promotionProducts`,
`promotionRedemptions`, `sales`, `loans`, `payments`, `expenses`, `shops`,
`stockEntries`, `shopIssueRecords`, `stockLedger`, `banking`,
`activityLogs`, `counters`.

The vertical tables (`members`, `appointments`, `purchaseOrders`, …) carried
a `businessProfileId`; those rows are re-pointed at the business that
profile became. The deprecated field is left in place so the mapping stays
auditable. A vertical row with no pointer at all was legacy global data, so
it is assigned to the primary business (the run reports these separately as
`assignedByDefault`).

## Idempotency and safety

The migration never rewrites a row that already has a `businessId`. Only
rows with no tenant pointer — the legacy global rows — are stamped. That
means:

- running it twice changes nothing the second time;
- running it on a deployment that already holds multi-tenant data cannot
  collapse two tenants into one;
- the legacy `businessProfiles` rows are never deleted, so the input stays
  auditable.

## Verifying the result

`migration:migrationStatus` reports what is left:

```bash
node scripts/migrate-to-multitenancy.mjs --email admin@pos.com --password '…'
```

The run ends with `"migrationComplete": true` when

- there is at least one business,
- every user has a membership, and
- no row is left without a `businessId`.

(The legacy `businessProfiles` rows are deliberately still there, so their
presence is *not* counted against completion — they are the input the
migration already consumed.)

You can also read the status in the dashboard, or call the query directly:

```bash
curl -X POST "$NEXT_PUBLIC_CONVEX_URL/api/query" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"path":"migration:migrationStatus","args":{},"format":"json"}'
```

### The end-to-end check

`scripts/verify-migration.mjs` proves the migration worked, not just that it
ran:

```bash
node scripts/verify-migration.mjs --email admin@pos.com --password '…'
```

It asserts that every user has a membership, that no row is left unassigned,
that the legacy settings (currency, tax rate) survived the copy, that the
migrated customer is **visible** in the migrated business and **invisible**
from another one, and that a second run creates no duplicate business, no
duplicate membership and rewrites no already-migrated row.

### Rehearsing on a scratch deployment

To try the migration on a deployment that has no legacy data, recreate one:

```bash
node scripts/seed-legacy-fixture.mjs          # creates the operator + fixture files
npx convex import --table businessProfiles --format jsonArray --append scripts/fixtures/businessProfiles.json
npx convex import --table customers         --format jsonArray --append scripts/fixtures/customers.json
npx convex import --table categories        --format jsonArray --append scripts/fixtures/categories.json
npx convex import --table counters          --format jsonArray --append scripts/fixtures/counters.json
npx convex import --table activityLogs      --format jsonArray --append scripts/fixtures/activityLogs.json
```

`--append` matters: without it the import *replaces* the table and would
delete the rows that are already there.

Finally, run the isolation suite. It proves the migrated deployment keeps
businesses apart:

```bash
node scripts/tenant-isolation-e2e.mjs
```

## After the migration

1. **Each user picks their business.** The business switcher sits in the
   sidebar; switching is a server operation that verifies the membership
   first. A user with several businesses who has not chosen one is asked
   to choose.

2. **Check the invoice counters.** Invoice sequences are now per business
   (`counters` is indexed by `by_businessId_name`), so two businesses may
   both issue `MBR-001`. That is intended.

3. **Product codes are now unique per business.** A code that existed once
   in the old global catalogue can be reused by another business.

4. **Drop the legacy table** once every deployment has been migrated:

   ```ts
   // convex/schema.ts — remove the businessProfiles table, then:
   npx convex deploy
   ```

## Rollback

The migration is additive and non-destructive:

- `businessProfiles` still holds the original rows.
- `businesses`, `memberships`, `branches`, `warehouses` and `employees`
  are new rows and can be deleted without touching anything else.
- The `businessId` patches can be undone by setting the field back to
  `undefined` on the affected rows.

If you need to roll back, deploy the previous functions and restore the
export taken in [Before you start](#before-you-start).

## Troubleshooting

**"Unauthorized: the migration must be run by a signed-in administrator."**
The account does not have a valid session, or the deployment has no
`SMARTBUZ_JWT_PRIVATE_KEY` yet. Check that the script can mint a token.

**"Forbidden: you do not have access to this business."**
The account is not a member of the business being migrated. Run the
migration as the business owner.

**"No businesses found. Run migrateBusinessProfiles first."**
The steps ran out of order. `migrate-to-multitenancy.mjs` runs them in the
right order — use the script rather than calling the mutations by hand.

**Some rows still have no `businessId`.**
They belonged to a legacy profile that no longer exists, so the migration
cannot know which business they were in. Check
`migration:migrationStatus` for the table and count, then decide manually
which business they belong to, or delete them.

**"Token expired" / "Could not decode token"**
The signing key in `.env.local` does not match the public key published at
`<deployment>.convex.site/auth/jwks`. Regenerate both with
`node scripts/generate-auth-keys.mjs`, update `convex/authJwks.ts`, and
redeploy.
