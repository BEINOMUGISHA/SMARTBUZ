# 11 — Offline Functionality and the Synchronisation Engine

**Commit audited:** `acafd2b`
**Scope:** `convex/sync.ts`, `src/lib/offline/*` (9 modules), `src/components/offline/*`,
`public/sw.js`, `tests/offline.test.ts` (45 tests), `tests/offline-client.test.ts` (10 tests),
`docs/OFFLINE.md`.

---

## 1. The claim being audited

The product promises that a cashier can complete a sale with no network, that the sale is not
lost, and that it is not counted twice. This report checks each promise against the code.

| Promise | Held? | Evidence |
|---|---|---|
| A sale can be rung up with no network | **Yes** | `src/lib/offline/queue.ts:63` writes locally before any network call |
| Closing and reopening the application loses nothing | **Yes** | IndexedDB (`src/lib/offline/db.ts`) + `resetInterruptedTransactions` (`:528`) |
| The same sale is never recorded twice | **Yes** | Idempotency key + `by_clientOfflineId` (`convex/sync.ts:273-279`) |
| The server's price wins over the till's | **Yes** | `convex/salesCore.ts:522-596` |
| An offline payment is never shown as confirmed | **Yes** | `resolvePaymentConfirmation` (`convex/salesCore.ts:338`) |
| A stock conflict is surfaced, not swallowed | **Yes** | `stockConflicts` rows + `listConflicts` (`convex/sync.ts:479`) |
| A failed sale is retried automatically | **Yes** | `backoffMs` (`src/lib/offline/sync.ts:186`), `dueTransactions` (`:193`) |
| The cashier can see what is waiting | **Partly** | The count is shown; the reason is not (M-07) |

---

## 2. The local store

`src/lib/offline/db.ts` opens an IndexedDB database with three object stores:

| Store | Purpose |
|---|---|
| `transactions` | The durable queue |
| `catalog` | The cached product catalogue and prices |
| `meta` | Device id, session cache, sync bookkeeping |

**The queue is written before anything else.** `queueSale` (`src/lib/offline/queue.ts:63`) is
called by the till as part of completing the sale, and the network push happens afterwards.
There is a window in which a crash would lose the sale — and the window is deliberately
*before* the money changes hands.

`resetInterruptedTransactions` (`src/lib/offline/db.ts:528`) handles the other window: a sale
that was being pushed when the application died is reset to `pending` when the application
comes back, so it is retried rather than lost. **This is the "recovery after application
restart" requirement, and it is implemented.**

---

## 3. The state machine

| Status | Meaning |
|---|---|
| `pending` | Written locally, waiting to be pushed |
| `syncing` | Being pushed right now |
| `synced` | The server took it. **The row stays as local history** |
| `failed` | The push failed. The row waits for its retry |
| `conflict` | The server recorded the sale but reported a stock conflict |

The transitions are `src/lib/offline/queue.ts:122-204`:

* `markSyncing` (`:122`) — marks the rows being pushed.
* `markSynced` (`:142`) — records the server's answer.
* `markFailed` (`:161`) — records the error and the next retry time.
* `markConflict` (`:174`) — records the conflict.
* `resetToPending` (`:192`) — puts a row back in the queue.
* `discardTransaction` (`:201`) — **explicitly** throws a sale away. It is never called
  automatically.

**A synced sale is never deleted.** The queue is the cashier's permanent local record of what
was sold. That satisfies "local transaction history" and means the till can still show a
customer their receipt after the network has gone for a week.

---

## 4. Retry and backoff

`src/lib/offline/sync.ts:174-209`:

```ts
const MAX_ATTEMPTS = 8;
const TICK_MS = 15_000;

export function backoffMs(attempts: number): number {
    const base = Math.min(MAX_BACKOFF_MS, 2_000 * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = Math.floor(Math.random() * Math.min(5_000, base / 4));
    return base + jitter;
}
```

* The wait doubles with each attempt, capped.
* **Jitter** is added so that every till in the country that lost the network at the same moment
  does not retry at the same instant when it comes back. That is a real-world detail that is
  usually missed.
* After **8 attempts** a transaction stops being retried automatically. The comment explains
  why: *"Something is wrong that retrying will not fix — the product was deleted, the price is
  wrong, the account is suspended. The sale stays in the local record and the cashier is shown
  it, rather than it being retried for ever."*

**Assessment: good.** A sale that can never succeed stops consuming battery and stops
generating log noise, but it does not disappear.

`dueTransactions` (`:193`) sorts by `queuedAt`, so sales are pushed **in the order they were
rung up**. A customer who bought bread before eggs gets the bread recorded first.

---

## 5. The server side

`convex/sync.ts:227-395` (`pushTransactions`) does, for each transaction:

1. **The device must be known to this business** (`:254-259`); a revoked device is refused
   outright with a message that tells the cashier to ask an administrator (`:261-265`).
2. **The role must be allowed to record sales** (`:243-247`).
3. **Has this sale already been recorded?** The `by_clientOfflineId` index is checked, filtered
   by business (`:273-279`). If it exists, the result is `duplicate` and the original sale is
   returned (`:281-302`) — **the duplicate is recognised, not rejected**, so a retry after a
   timeout cannot double-count.
4. **Was the business entitled to trade at that moment?** (`:304-312`) `subscriptionCoveredAt`
   is used rather than "are you entitled now", so a sale made during a valid subscription is
   still recordable after the subscription has lapsed.
5. **Apply the sale** through the same `applySale` the online path uses.
6. **Record the conflicts** as `stockConflicts` rows (`:343-357`).
7. **Write a sync log row** — the synchronisation audit trail.

**The result is one of three: `applied`, `duplicate` or `rejected`** (`:68-69`). There is no
"probably fine" state.

---

## 6. Stock conflict handling

`detectStockConflicts` (`convex/salesCore.ts:379-421`) distinguishes two cases:

| Kind | Meaning | Severity |
|---|---|---|
| `insufficient` | There was never enough stock. The customer has the goods; the books are short. | A human must settle it |
| `drift` | The till's belief was out of date, but there was enough. | A warning |

The conflict is recorded **alongside** the sale, not instead of it. The sale is recorded, the
conflict is visible, and the till's belief is compared with the server's truth.

**M-41 (Medium).** The conflict is recorded but the *till's* belief is not corrected. After a
conflict, the local catalogue still holds the stale quantity, so the next sale of the same
product will produce another conflict. The catalogue is only refreshed by a full catalogue sync.

---

## 7. Findings

### 7.1 M-07 — MEDIUM: the reason a sale failed is never shown

`markFailed` (`src/lib/offline/queue.ts:161`) stores the server's error text in the queue row,
and `SyncStatus` (`src/lib/offline/sync.ts:233-240`) counts the failures. But the interface
(`src/components/offline/sync-status.tsx`) shows the **counts**, not the **reasons**.

A cashier sees "3 sales waiting" and cannot tell whether that means the network is down, the
price was wrong, the product was deleted, or the subscription lapsed. Only three of those are
things the cashier can act on, and the one that most needs attention — *"your sale was refused
because the price changed"* — is invisible.

**Recommendation:** the sync banner should name the most recent failure and its reason, and the
local-history screen should show the error against each failed sale.

### 7.2 M-08 — MEDIUM: the offline experience is a write queue, not an offline application

The service worker (`public/sw.js`) caches the application shell. With no network, the browser
serves the cached shell — so the interface *loads* — and then every query fails, because there
is no offline read path for products, customers or prices other than the cached catalogue.

The result is an application that looks alive and cannot do anything. The offline banner says
how many sales are waiting, but a first-time user with no network sees a broken-looking
application rather than an honest "you are offline — here is what still works".

**Recommendation:** either serve a proper offline mode (the cached catalogue, the local
history, and an explicit statement that prices and balances may be out of date) or do not cache
the shell at all, so the browser's own offline page says what is happening.

### 7.3 M-42 — LOW: no explicit "there is unsynced work" prompt on sign-out

If a cashier signs out with sales still queued, the queue survives in IndexedDB (keyed by
device) but the next person to sign in on that device may be in a different business. The queue
is scoped by `businessId` on the row, so the sales will not be pushed into the wrong business —
but there is no prompt telling the outgoing cashier to wait for the sync.

### 7.4 M-43 — LOW: the sync engine's tick is 15 seconds and the interval is not adjusted for sleep

`TICK_MS = 15_000` (`src/lib/offline/sync.ts:177`). A phone that sleeps for an hour wakes and
finds a 15-second timer overdue; depending on the browser's timer throttling, the first push may
be delayed. The server-side push is triggered on network reconnection as well
(`src/lib/offline/network.ts` watches the connection), which covers the common case.

---

## 8. The offline engine's test coverage

| File | Tests | Covers |
|---|---:|---|
| `tests/offline.test.ts` | 45 | `convex/sync.ts`, `convex/sales.ts`, `convex/salesCore.ts`, `convex/subscriptionState.ts` |
| `tests/offline-client.test.ts` | 10 | `src/lib/offline/sync.ts` (`backoffMs`, `dueTransactions`) and the types |

**Assessment: good.** The server and browser halves are both tested, and the acceptance
scenario from the original brief is directly asserted: a sale is queued, the application is
"restarted", the sale is pushed, and it is not duplicated.

**M-44 (Medium).** `src/lib/offline/db.ts` — the IndexedDB layer, 20 exported functions — is not
tested. The queue logic above it is, and the schema below it is not. A change to the object
store names or the upgrade path would not be caught.

---

## 9. Summary

| Area | Assessment |
|---|---|
| Durable local queue | **Good** |
| Write-before-network ordering | **Good** |
| Idempotency | **Good** — the same key is recognised, not rejected |
| Server-side price wins | **Good** |
| Offline payment is never shown as confirmed | **Good** |
| Conflict detection and recording | **Good** |
| Retry, backoff and jitter | **Good** |
| Recovery after restart | **Good** |
| Local history kept after syncing | **Good** |
| Sync audit trail | **Good** |
| The reason a sale failed | **Never shown (M-07)** |
| The offline *read* experience | **Weak (M-08)** |
| The catalogue is not corrected after a conflict | **M-41** |
| The IndexedDB layer's own tests | **Absent (M-44)** |
