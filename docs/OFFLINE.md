# SMARTBUZ — The offline-first engine

Phase 7 makes the till work when the network does not.

A branch office in Uganda loses its link. The cashier keeps selling. When
the link comes back, everything they sold is on the books — once, in the
right period, with the stock correctly accounted for, and with anything that
went wrong written down for someone to look at.

This document describes how it works and what it guarantees.

---

## 1. The shape of it

```
   the till                          the server
   ────────                          ────────
   IndexedDB                         Convex
   ┌──────────────────────┐         ┌──────────────────────┐
   │ transactions         │  push   │ sync.pushTransactions│
   │  pending             │────────►│  • duplicate check   │
   │  syncing             │         │  • server validation  │
   │  synced              │◄────────│  • stock conflicts    │
   │  failed / conflict   │         │  • extends the period│
   ├──────────────────────┤         └──────────────────────┘
   │ catalog              │         ┌──────────────────────┐
   │  the price list      │         │ syncLogs             │
   ├──────────────────────┤         │ stockConflicts       │
   │ meta                 │         └──────────────────────┘
   │  the device id       │
   └──────────────────────┘
```

Two halves, and only two:

- **The till half** — `src/lib/offline/`. IndexedDB, the device identity, the
  network heartbeat, the queue, and the sync engine.
- **The server half** — `convex/sync.ts` and `convex/salesCore.ts`.

---

## 2. The guarantees

These are the promises the engine makes. Each one is tested.

### Nothing is lost

A sale is written to IndexedDB **before** the till says anything to the
customer. IndexedDB is on disk: it survives the tab closing, the browser
crashing, and the machine being switched off. The receipt is printed from
the same record that is going to be sent.

Nothing is deleted when a sale syncs. It moves to `synced` and stays in the
till's own history until somebody throws it away on purpose.

### Nothing is counted twice

Every transaction carries an id made with `crypto.getRandomValues`:

```
SBZ-3F9A2C7E14B8D605
```

The id is generated **before** the sale is queued and travels with it all the
way to the server. The server keeps a sale per `clientOfflineId`, so the
same transaction arriving twice is recognised the second time and the
original is returned.

This holds even when the second copy arrives from a **different till** — a
reinstalled machine, a cloned profile. One transaction, one sale.

### An interrupted sync is not a lost sale

If the application is closed in the middle of a push, the transaction is
left in the `syncing` state. On the next start it is put back to `pending`
and tried again. It is *not* assumed to have failed — the server decides
that, by looking at the transaction id.

### The books are never wrong about the price

The till's price list is what the customer is shown on the receipt. The
**server always recomputes the price** from the `stocks` table, so a stale
price can never change the books.

If the two figures differ — because the price changed while the till was
offline — the sale is still recorded, at the server's price, and the
till's figure is kept alongside it as `clientTotal` so the difference can be
explained rather than swallowed.

### The money is not assumed

**An offline mobile-money payment is not a confirmed payment.** Nobody at
the provider has seen it. It is recorded with
`paymentConfirmation: "pending_verification"` and the receipt says
"(to confirm)".

Cash in the drawer is different — that money is already in the business, so
an offline cash sale is `confirmed`.

Bank transfers and card payments are treated like mobile money: unconfirmed.

### The subscription still applies

A business whose subscription has lapsed cannot record new sales. But a
sale that was **rung up while the subscription was running** is still
recorded when it arrives, because the goods have gone and the customer has
been charged. Recording a sale that already happened is not trading; it is
catching up on the books.

The test is the subscription's own end date: a sale made after the period
ended is refused.

---

## 3. The till half

### The queue — `src/lib/offline/db.ts`, `queue.ts`

One IndexedDB database, `smartbuz_offline`, with three stores:

| Store | What it holds |
|---|---|
| `transactions` | Every sale this till has made, with its status |
| `catalog` | The last price list the till downloaded |
| `meta` | The device id and other small settings |

The `transactions` store is keyed by `transactionId`, so a duplicate id
cannot be stored twice — the second attempt is rejected rather than
silently creating a second row.

Statuses: `pending`, `syncing`, `synced`, `failed`, `conflict`.

### The device id — `src/lib/offline/device.ts`

One stable id per installation, generated with `crypto.getRandomValues` and
kept in the `meta` store. It is stamped on every queued transaction, so a
sale can always be traced back to the machine that made it.

The id is in IndexedDB, not `localStorage`, so it is not wiped by the
browser's "clear site data on low disk" heuristics.

### The network — `src/lib/offline/network.ts`

`navigator.onLine` is not trusted. It reports "online" whenever the machine
merely has a network interface up — which is exactly what happens behind a
captive portal or a dead uplink.

The heartbeat makes a real request (`/manifest.json`, `cache: "no-store"`)
every twenty seconds. Only an actual HTTP response counts as online. The
browser's `online`/`offline` events are used as a hint alongside it, and the
state is only reported when it actually changes.

### The sync engine — `src/lib/offline/sync.ts`

On start it does three things, in this order:

1. **Recovers.** Any transaction left mid-push goes back to `pending`.
2. **Registers the till** with the server.
3. **Pushes** whatever is due.

Then it keeps going: a push runs when the network comes back, every fifteen
seconds, and whenever the cashier presses *Send now*.

**Retry with backoff.** A push that fails is not lost. The attempt count and
the next attempt time live in IndexedDB, so closing the application does not
reset the backoff. The wait doubles with each attempt, up to five minutes,
with jitter so that every till in the country does not retry at the same
instant.

After eight attempts a transaction stops being retried automatically —
something is wrong that retrying will not fix — and it stays visible in the
till's record for a person to deal with.

**Batch size.** Twenty-five transactions per push.

### The price list — `src/lib/offline/catalog.ts`, `price-list.ts`

The product list arrives a page at a time, so what the till learns is
**merged** into the local catalogue rather than replacing it. A product that
was on page three yesterday is still sellable offline today.

Without this the cashier would be staring at an empty till: the product
list comes from a live query, and a live query fails with no network.

### The session — `src/lib/offline/session-cache.ts`

A till with no network still has to come up so the cashier can sell. The
last session the server confirmed is kept locally and used as a fallback.

**The session cookie is not cached.** Nothing in the cache can be used to
reach the server. Every write still goes through the server's own checks
when the network returns. The cache only decides what the interface shows
while the server cannot be asked.

Signing out clears it.

---

## 4. The server half

### One implementation of a sale — `convex/salesCore.ts`

The rules for turning a basket of goods into a sale live in **one place**.
Both the live till and the offline synchroniser call `applySale`:

```ts
const result = await applySale(ctx, args, {
    businessId,
    userId,
    allowPriceOverrides,
    offline: { deviceId, transactionId, occurredAt },
});
```

If the two paths were written separately they would drift apart within a
release, and the books would stop matching the tills. A sale that arrives
late is recorded exactly as if it had arrived on time: the same prices, the
same total, the same stock movement, the same promotion triggers.

The only things that differ for an offline sale are the two that must
differ:

- **When it happened.** `occurredAt` is the moment the sale was rung up.
  The reports are built from that, not from the moment the server received
  it. A till may not date a sale more than thirty days back or more than
  five minutes into the future; outside that window the server's own clock
  is used.
- **Whether the money is confirmed.** See above.

### Pushing — `convex/sync.pushTransactions`

Each transaction is handled on its own: one bad sale does not stop the rest
of the queue, and one good sale is not held up by it.

For each transaction:

1. **Duplicate check.** Has this id been recorded already? If so, return the
   original.
2. **Subscription check.** Was the business entitled to trade at the moment
   the sale was rung up?
3. **Apply it.** Through `applySale`.
4. **Record the conflicts.**
5. **Write the audit row.**

The result tells the till what happened to each transaction:

```ts
{ transactionId, status: "applied" | "duplicate" | "rejected",
  saleId, invoiceNumber, conflicts, error, paymentConfirmation,
  total, clientTotal }
```

### The audit trail — `syncLogs`

Every push leaves a row: what arrived, from which device, whether it was
applied, refused as a duplicate, held as a conflict, or rejected, and why.

This is the answer to "did my till's sales get in?".

### The conflicts — `stockConflicts`

Two devices selling the same stock offline is the normal case in a busy
shop, not an error. The point is to **notice** it, not to refuse the sale.

| Kind | What it means |
|---|---|
| `drift` | The stock moved since the till last saw it, but there is still enough to cover the sale |
| `insufficient` | There was not enough stock to cover the sale |

The sale is **still applied** — the customer has the goods, and refusing it
would leave the books wrong. The shortfall is recorded instead, and shown
to the owner at `/devices`, where it can be accepted, marked as a stock
correction, or reversed.

### The owner's page — `/devices`

Three tabs:

- **Tills** — every device, when it registered, when it was last seen, when
  it last synced, and any error it reported.
- **Stock conflicts** — the conflicts waiting for a decision.
- **Synchronisation log** — the audit trail, newest first.

---

## 5. What the cashier sees

- The header strip shows **Offline**, **Syncing** or **Online**, the number
  of sales waiting, and the number that need attention. It never hides a
  problem.
- **Queue** opens the till's own record: every sale, its state, how many
  attempts it has had, the reason it was refused, and a *Send again* button.
- The sales screen shows what is happening: *"Offline mode: sales will save
  locally"*, or *"Online: 3 sales waiting to sync"*.

---

## 6. What works offline, and what does not

Being honest about this is more useful than a promise that breaks.

### Fully supported offline

| | |
|---|---|
| Selling from the till | The whole sales screen works: the product list, the cart, the receipt |
| Cash sales | Recorded as `confirmed` — the money is in the drawer |
| Mobile-money and bank-transfer sales | Recorded as *awaiting confirmation*, never as confirmed |
| Stock movements | Taken down when the sale is pushed, with the conflict recorded |
| Invoices | Numbered on the server when the sale is pushed, so there are no gaps or clashes |
| Loans against a customer | The customer is recorded by id; the balance is recorded with the sale |
| Reopening the application | Everything is on disk; the queue is picked up where it was left |
| Promotions | Evaluated when the sale is pushed, from the server's own promotion rules |

### Not supported offline

| | Why |
|---|---|
| Picking a customer from the saved list | The customer list comes from the server. A walk-in can still be named by hand, and a customer chosen before the link went down is still recorded by id |
| Editing or refunding a sale | Both need the server, because both change stock and money. The till says so rather than pretending |
| Price changes, restocking, new products | These are server-side operations |
| Anything that needs the customer's balance to be current | The credit book needs the server |

The rule is simple: **a sale can be rung up offline; anything that has to
look at the current state of the business cannot.**

---

## 7. What is deliberately not done

- **No Background Sync API.** It is not supported in Safari and is
  inconsistent elsewhere. The engine uses a heartbeat and a tick instead,
  which works everywhere.
- **No silent background payment verification.** An offline mobile-money
  payment stays pending until somebody checks it against the provider's own
  record.
- **No negative-stock refusal.** Negative stock is allowed by design in
  this codebase. What Phase 7 adds is that the shortfall is *recorded and
  surfaced* rather than buried in a quantity.
- **The legacy localStorage "offline draft" mechanism has been removed.**
  It was a second, weaker path to the same outcome: it lived in
  `localStorage`, it carried no unique transaction id, and re-creating a
  draft as a sale could produce a **second** sale for a transaction the
  server had already accepted.

---

## 8. Where things are

| File | What is in it |
|---|---|
| `convex/sync.ts` | `registerDevice`, `pushTransactions`, `listConflicts`, `resolveConflict`, `getSyncStatus`, `listSyncLogs` |
| `convex/salesCore.ts` | `applySale` — the one implementation of a sale, used by both paths |
| `convex/subscriptionState.ts` | `subscriptionCoveredAt` — was the business entitled to trade *then*? |
| `src/lib/offline/db.ts` | The IndexedDB stores |
| `src/lib/offline/queue.ts` | The lifecycle of a locally stored sale |
| `src/lib/offline/device.ts` | The till's identity |
| `src/lib/offline/network.ts` | The heartbeat |
| `src/lib/offline/sync.ts` | The sync engine |
| `src/lib/offline/catalog.ts` | The price list |
| `src/lib/offline/session-cache.ts` | The cached session |
| `src/components/offline/sync-provider.tsx` | The React half: starts the engine, shares the state |
| `src/components/offline/sync-status.tsx` | The header strip |
| `src/components/offline/offline-transactions.tsx` | The till's record of its sales |
| `src/app/(dashboard)/devices/page.tsx` | The owner's view: tills, conflicts, audit log |
| `tests/offline.test.ts` | The tests |

---

## 9. Operating notes

- A till's device id can be reset from the browser's developer console:
  `localStorage` and the `meta` store hold it. `resetDeviceId()` in
  `src/lib/offline/device.ts` makes a new one. The old till must be revoked
  first, or the plan's device limit will refuse the new one.
- A till that has been offline for a long time holds a lot of sales. The
  engine pushes twenty-five at a time, so it takes a few passes to catch up.
- If a sale is refused, the reason is shown on the till and in the
  synchronisation log. A refused sale stays in the till's record; it is
  never dropped.
