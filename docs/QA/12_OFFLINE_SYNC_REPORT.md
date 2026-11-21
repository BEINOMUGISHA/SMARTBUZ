# SMARTBUZ v2.0 — 12 · Offline Functionality and Synchronisation Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Component status:** **IMPLEMENTED and wired into the live sales flow** — with two licensing defects and one financial-integrity defect described below.
**Overall verdict:** The offline engine is one of the better-engineered parts of this platform: a durable IndexedDB queue with generated idempotency keys, restart recovery for interrupted pushes, per-transaction error isolation, and — critically — offline sales are pushed through the *same* server-side sale engine as online sales. It is **not** "cached screens only".

---

## 1. Method

| Aspect | Detail |
|---|---|
| Inspection | `src/lib/offline/` (9 modules, 67 KB), `convex/sync.ts` (706 lines), the sales page integration, `public/sw.js`, `tests/offline.test.ts`, `tests/offline-client.test.ts` |
| Commands | `ls src/lib/offline`, targeted reads of `queue.ts`, `db.ts`, `sync.ts` (client), `convex/sync.ts`; grep for `queueSale`, `syncing`, `stock_adjusted` |
| Live testing | **NOT PERFORMED** — every sync path writes to the live Convex deployment (creates sales, devices, conflicts, sync logs). Executing it would create production records, which the audit mandate forbids. |
| Evidence basis | Static analysis of the full client and server sync paths, plus the existing local test suites (`npm test` → offline suites pass). |

> The mandated Part 11 scenario (disconnect → sell → restart → restore → sync → confirm recorded exactly once) **cannot be run against production** and was not run against a local backend either — no local Convex backend is running in the audit environment (`CONVEX_URL` in `.env.local` points at the live cloud deployment). It is therefore recorded as **NOT TESTED end-to-end**, with the design evidence that follows.

---

## 2. Architecture as implemented

```
┌─ Till (browser) ────────────────────────────────────────────────┐
│ sales/page.tsx                                                  │
│   └─ sale fails to reach the server → queueSale()               │
│        └─ IndexedDB row { transactionId:"SBZ-<16 hex>", status,  │
│                          attempts, payload, occurredAt }        │
│   sync engine (src/lib/offline/sync.ts)                         │
│   └─ picks "pending"/"failed" rows that are due → markSyncing() │
│   └─ POST pushTransactions { deviceId, transactions[] }         │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─ Convex (convex/sync.ts) ───────────────────────────────────────┐
│ pushTransactions                                                │
│   1. requireTenant + role check ("sales.create")                │
│   2. device lookup by (businessId, deviceId)                    │
│   3. duplicate check on sales.by_clientOfflineId                │
│   4. subscription coverage at occurredAt                        │
│   5. applySale(...)  ← the SAME engine as an online sale        │
│   6. write stockConflicts + syncLogs + audit                    │
└─────────────────────────────────────────────────────────────────┘
```

**Client modules:** `db.ts` (IndexedDB schema + access layer), `queue.ts` (lifecycle), `sync.ts` (push engine, backoff, status events), `catalog.ts` (cached catalogue), `session-cache.ts` (last-known session for offline boot), `price-list.ts`, `device.ts` (stable device id + app version), `network.ts` (connectivity), `types.ts`.

---

## 3. Part 11 scenario assessment

| # | Mandated step | Status | Evidence |
|---|---|---|---|
| 1 | Disconnect the internet | **SUPPORTED** | `src/lib/offline/network.ts`; `src/lib/offline/sync.ts` tracks `online` state |
| 2 | Open the application | **SUPPORTED** | `src/lib/offline/session-cache.ts` restores the last confirmed session so the shell comes up |
| 3 | Access cached products | **IMPLEMENTED** | `src/lib/offline/catalog.ts`; `readCatalog` imported by the sales page (`src/app/(dashboard)/sales/page.tsx:36`) |
| 4 | Create a sale | **IMPLEMENTED** | `src/app/(dashboard)/sales/page.tsx:529-535` (`queueSaleQuietly`), `:647-651` (explicit offline branch), `:773` (fallback when the network fails between the check and the call) |
| 5 | Store the transaction locally | **IMPLEMENTED** | `queueSale()` → IndexedDB, `src/lib/offline/queue.ts:63-103` |
| 6 | Restart the application | **SUPPORTED** | rows live in IndexedDB, not memory |
| 7 | Confirm the pending transaction persists | **IMPLEMENTED** | `queueSummary()`/`listPendingTransactions()`; the offline banner reads them |
| 8 | Restore the internet | **SUPPORTED** | `src/lib/offline/network.ts` + the sync engine's timer |
| 9 | Synchronise the transaction | **IMPLEMENTED** | `src/lib/offline/sync.ts` push loop (batch size, backoff) |
| 10 | Confirm it is recorded exactly once | **IMPLEMENTED — by design** | Client generates `SBZ-` + 64-bit random id (`queue.ts:31-38`); server deduplicates on `sales.by_clientOfflineId` scoped to the business (`convex/sync.ts:273-302`); the duplicate branch returns `status:"duplicate"` with the original invoice number instead of writing a second sale |
| 11 | Simulate network failure during sync | **IMPLEMENTED** | per-transaction try/catch (`convex/sync.ts:396-415`); client marks the row failed with a persisted `nextAttemptAt` and exponential backoff (`queue.ts:161-171`, `sync.ts:425-428`) |
| 12 | Retry the synchronisation | **IMPLEMENTED** | `dueTransactions()` honours `nextAttemptAt`; `attempts` is incremented per attempt and preserved across restarts |
| 13 | Test conflicting stock updates | **IMPLEMENTED** | `applySale` returns conflicts; the server writes `stockConflicts` rows with expected/available/requested quantities (`convex/sync.ts:343-358`); `listConflicts` and `resolveConflict` expose them to the owner |
| 14 | Verify transaction status | **IMPLEMENTED** | five-state lifecycle `pending → syncing → synced / failed / conflict` (`src/lib/offline/types.ts:17-22`), surfaced through `queueSummary()` and `getSyncStatus` |

**Interruption recovery (the "crash mid-push" case) is handled explicitly:** `src/lib/offline/db.ts:517-560` resets any row left in `"syncing"` back to `"pending"` on restart, preserving `attempts` and `nextAttemptAt`, because the server deduplicates on `transactionId` and a blind retry is therefore safe.

**Nothing is deleted when a sale syncs.** A synced row stays in the local store as the cashier's record
(`src/lib/offline/queue.ts:15-17`, `markSynced()` at `:142-153`); only `discardTransaction()` removes a row and
it is never called automatically (`:200-203`).

---

## 4. Findings

### OFF-01 — An unregistered device can push sales, bypassing device registration and the plan's device limit
- **ID:** OFF-01
- **Module:** Offline sync / licensing
- **Severity:** **HIGH**
- **Description:** `pushTransactions` looks the device up and rejects it only if it exists **and** is revoked:
  `const device = await ctx.db.query("devices").withIndex("by_businessId_deviceId", …).unique();` followed by `if (device && device.status === "revoked") { throw … }` (`convex/sync.ts:254-265`). The code's own comment says *"The device must be known to this business"*, but when the lookup returns `null` — an arbitrary, never-registered `deviceId` — the check is skipped and the batch is processed. The device's `lastSeenAt`/`lastSyncAt` are also only patched when a row exists (`convex/sync.ts:419-426`). A client can therefore push sales from any number of unregistered devices, and the device registry never reflects them.
- **Steps to reproduce:** Static inspection: `convex/sync.ts:254-265` and `:419-426`. (A live proof requires a write to the production deployment and was therefore not performed.)
- **Expected behavior:** `pushTransactions` requires a device row for the caller's business, in a non-revoked state; an unknown `deviceId` is refused with a message telling the operator to register the till.
- **Actual behavior:** Only revoked devices are refused. Unknown devices are accepted silently.
- **Root cause:** The guard was written to express "revoked devices may not sync" and the "must be known" invariant was never enforced.
- **Recommended fix:** Replace the condition with an explicit requirement — if `device` is `null`, throw a `ConvexError` naming the device id and instructing the operator to register the till; if `device.status === "revoked"`, keep the current refusal. Keep the `lastSeenAt` patch inside the same branch.
- **Test required to verify the fix:** A unit test asserting that `pushTransactions` with an unknown `deviceId` is rejected, and one asserting that a registered, active device succeeds.

### OFF-02 — The device limit is not enforced when a business has no subscription row
- **ID:** OFF-02
- **Module:** Licensing
- **Severity:** **MEDIUM**
- **Description:** `deviceLimit()` returns `0` when no subscription row exists (`convex/sync.ts:210-215`), and `registerDevice` only enforces the cap when `limit > 0` (`convex/sync.ts:161-174`). A business with no subscription — including one whose subscription row was deleted — can register unlimited devices. The check also counts only devices with `status === "active"`, so revoked devices do not consume a slot (correct), but there is no cap at all in the zero-limit case.
- **Steps to reproduce:** Static inspection: `convex/sync.ts:157-174` and `:209-215`.
- **Expected behavior:** A business with no active subscription registers no devices (or a documented trial allowance), and the limit is enforced regardless of how the subscription row is missing.
- **Actual behavior:** `limit = 0` disables the check entirely.
- **Root cause:** `0` is overloaded to mean both "no subscription" and "no limit", and the code treats zero as "no check needed".
- **Recommended fix:** Return `null` (or `-1`) from `deviceLimit()` when there is no subscription and treat that as *no devices allowed*, reserving `0` for a plan that genuinely allows zero devices. Verify that the platform onboarding flow creates the subscription row before the first device registers.
- **Test required to verify the fix:** A test that registers a device for a business with no subscription row and asserts the refusal.

### OFF-03 — Resolving a conflict as "rejected" does not reverse the sale, the stock or the money
- **ID:** OFF-03
- **Module:** Offline sync / financial integrity
- **Severity:** **HIGH**
- **Description:** `resolveConflict` offers three resolutions — `accepted`, `rejected`, `stock_adjusted` — documented in the code as *"rejected — the sale was a mistake and should be reversed"* and *"stock_adjusted — the stock record has been corrected"* (`convex/sync.ts:520-527`). The handler validates the resolution string (`convex/sync.ts:547-552`) and then **only patches the conflict row** with `status`, `resolution`, `note`, `resolvedBy`, `resolvedAt` (`convex/sync.ts:554-560`). It never reverses the sale, never returns the stock, and never touches the financial records — although `convex/sales.ts:1038` (`refundSale`) exists and does exactly that (stock back to the warehouse, money recorded against the original invoice, audit trail written). An operator who marks a conflicted offline sale as "rejected" will reasonably believe the sale has been undone. It has not: the sale remains in the books and the stock remains deducted.
- **Steps to reproduce:** Static inspection: `convex/sync.ts:528-573` compared with `convex/sales.ts:1038`. (A live proof requires writing a conflict, a sale and a stock movement to the production deployment and was therefore not performed.)
- **Expected behavior:** `rejected` reverses the sale through `refundSale` (or an equivalent compensating entry), and `stock_adjusted` writes a stock adjustment movement that brings the balance back — both auditable.
- **Actual behavior:** Only the conflict's own status changes. The financial and stock position is untouched in all three cases.
- **Root cause:** The conflict workflow was implemented as a *labelling* operation rather than a *corrective* one.
- **Recommended fix:** In `resolveConflict`, for `rejected` call the same compensation path `refundSale` uses (reuse it rather than duplicating it, so the money and stock rules stay in one place); for `stock_adjusted` write a `stockMovements` entry that reconciles the difference. Both must write an audit record naming the conflict. Rename the option in the UI to "Rejected — the sale is NOT reversed" until the compensation is implemented.
- **Test required to verify the fix:** A test that creates a sale with a stock conflict, resolves it as `rejected`, and asserts that the sale's stock movement is reversed and the financial ledger is netted accordingly.

### OFF-04 — `getSyncStatus` reads every sync log for the business with an unbounded query
- **ID:** OFF-04
- **Module:** Offline sync / performance
- **Severity:** **MEDIUM**
- **Description:** `getSyncStatus` collects the business's devices, pending conflicts and **all** sync logs with three `.collect()` calls and no limit (`convex/sync.ts:595-614`). `syncLogs` is an append-only table that grows with every push attempt, including every duplicate and every rejection, so this query grows without bound for a busy till.
- **Steps to reproduce:** Static inspection: `convex/sync.ts:595-614`; `writeSyncLog` at `:438-467` inserts one row per transaction attempt.
- **Expected behavior:** The status query reads a bounded window (for example the last N logs, or logs since the last sync), and the history is paged separately.
- **Actual behavior:** The whole log table for the business is loaded into memory on every status call.
- **Root cause:** The status view was written for a small table and never revisited as the table grew.
- **Recommended fix:** Bound the log read (e.g. `order("desc").take(50)` on `by_businessId_createdAt`) and expose the full history through a paged query.
- **Test required to verify the fix:** A performance test that seeds 100,000 sync logs and asserts the status query still returns within a fixed time budget.

### OFF-05 — The offline client has no upper bound on queue size
- **ID:** OFF-05
- **Module:** Offline / storage
- **Severity:** **LOW**
- **Description:** Nothing in `src/lib/offline/queue.ts` or `db.ts` limits how many rows the local store may hold. A till that is offline for a long period accumulates one row per sale, each holding the full payload, and IndexedDB storage is not reclaimed until the row is explicitly discarded. `discardTransaction()` exists but is never called automatically, and synced rows are deliberately kept as local history.
- **Steps to reproduce:** Static inspection: `src/lib/offline/queue.ts:63-103` (enqueue, no cap), `:142-153` (synced rows retained), `src/lib/offline/db.ts` (no retention policy).
- **Expected behavior:** A retention policy that prunes synced rows beyond a bounded history (for example the last 500 sales) and a visible warning when the queue grows large.
- **Actual behavior:** Unbounded growth for the lifetime of the installation.
- **Root cause:** Local history was treated as free.
- **Recommended fix:** Add a retention pass that deletes the oldest *synced* rows beyond a configured count or age, never touching pending, failed or conflicted rows, and surface the queue size in the offline banner.
- **Test required to verify the fix:** A test that queues more than the retention limit, runs the pruning pass, and asserts that pending/failed/conflicted rows survive and that the oldest synced rows do not.

### OFF-06 — The service worker caches static assets without a size bound and offers no version-scoped purge for the app shell
- **ID:** OFF-06
- **Module:** PWA / offline
- **Severity:** **LOW**
- **Description:** `public/sw.js` (version `v5`) precaches only `/manifest.json` and `/logo.ico`, serves HTML network-first, static assets cache-first with a background refresh, and never caches API responses — a sound design whose rules are documented in the file header. The residual gap is that cached static assets are evicted only when `CACHE_VERSION` changes, so a rollout that changes an asset without bumping the version leaves stale copies on tills that are offline at the time.
- **Steps to reproduce:** Static inspection: `public/sw.js` (`CACHE_VERSION = "v5"`, `PRECACHE_URLS = ["/manifest.json", "/logo.ico"]`).
- **Expected behavior:** Asset caches are invalidated when the deployment changes, not only when a human remembers to bump a constant.
- **Actual behavior:** Cache invalidation depends on a manually maintained version string in a static file.
- **Root cause:** The service worker is a static asset with no build-time link to the deployment.
- **Recommended fix:** Inject the build id into `sw.js` at build time (or serve the cache name from a build-generated constant) so each deployment gets its own cache namespace and the old one is dropped on activation.
- **Test required to verify the fix:** Deploy twice with an asset change and assert that the second deployment's asset is served from the new cache and the old cache is deleted.

---

## 5. What was NOT TESTED, and why

| Item | Why |
|---|---|
| The full Part 11 scenario against a live backend | Every step writes records (sales, devices, conflicts, sync logs). The mandate forbids destructive/production writes; no local Convex backend is available in the audit environment. |
| Duplicate-suppression proof on the live deployment | Requires pushing a sale twice (production writes). The suppression code path is verified statically at `convex/sync.ts:273-302` and by `tests/offline.test.ts`. |
| IndexedDB behaviour in a real browser (private mode, quota, eviction) | Requires a browser harness; the repo has no browser test runner. |
| Concurrent pushes from two tills | Requires two live clients writing simultaneously. |
| Offline receipt printing | ESC/POS printing is browser-serial-only (`src/lib/escpos.ts:258`); untested in an offline scenario. |

---

## 6. Findings summary

**OFF-01** HIGH · **OFF-02** MEDIUM · **OFF-03** HIGH · **OFF-04** MEDIUM · **OFF-05** LOW · **OFF-06** LOW

**Counts: 0 CRITICAL, 2 HIGH, 2 MEDIUM, 2 LOW, 0 INFORMATIONAL**

---

## 7. Verdict

The offline subsystem **is genuinely implemented** and is wired into the live checkout path — a sale that cannot
reach the server is queued in IndexedDB with a generated idempotency key, survives a restart, and is later pushed
through the same server-side sale engine, so offline and online sales are priced and recorded identically. The
"cached screens only" failure mode the audit warns about **does not apply here**.

The defects are real but bounded: an unregistered device can sync (OFF-01) and the device limit is inert without a
subscription row (OFF-02) — both weaken a licensing control rather than a data boundary; and resolving a stock
conflict as "rejected" leaves the sale in the books (OFF-03), which is a genuine financial-integrity and
operator-trust defect. No cross-tenant path was found in the sync code: every sync function calls `requireTenant`,
and `resolveConflict` verifies `conflict.businessId === tenant.businessId` before touching a row
(`convex/sync.ts:540`).
