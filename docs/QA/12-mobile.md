# 12 — React Native + Expo Mobile Application

**Commit audited:** `acafd2b` (main) and `feature/phase-8-mobile` @ `e4ee370` (in-progress work)

---

## 1. Status: NOT IMPLEMENTED on the audited branch

**On `main` — the commit this audit covers — there is no mobile application.** There is no
`apps/` directory, no Expo project, no `app.json`, no `easi.json`, and no React Native code
anywhere in the repository. The Phase 8 mobile build has **not** been merged.

**An in-progress implementation exists on the branch `feature/phase-8-mobile`** (commit
`e4ee370`, *"wip: begin the Phase 8 mobile application (React Native + Expo)"*). It was created
during this audit session and parked on its own branch so that `main` — the thing under audit —
stays clean and reviewable.

This report describes both: what `main` actually contains, and exactly how far the branch has
got. **Nothing in the branch has been run.** No screen exists, no device has run it, and the
web application has not been rebuilt with the shared-package changes it contains.

---

## 2. What `main` provides for a mobile client today

| Need | Available on `main`? | Notes |
|---|---|---|
| A backend to talk to | **Yes** | The same Convex deployment the web application uses |
| Typed function references | **Yes** | `convex/_generated/api.d.ts` is committed and covers every module |
| Authentication | **Partly** | The sign-in route sets an **HttpOnly cookie**. React Native has no reliable cookie jar, so the browser's session cannot be carried to a phone as it stands |
| A refresh token endpoint | **Yes** | `GET /api/auth/convex-token` mints a fresh 15-minute RS256 token from the cookie |
| An offline engine | **Yes, for the browser** | `src/lib/offline/*` is IndexedDB-based; the *semantics* port to SQLite unchanged |
| Barcode hardware | **Partly** | `src/lib/hardware/barcode.ts` is a keyboard-wedge driver (USB scanners). No camera scanning |
| Receipt printing | **Partly** | `src/lib/escpos.ts` produces the ESC/POS byte stream; `printDirectWebSerial` is browser-only (Web Serial) |
| Push notifications | **No** | No push token table, no registration function, no server-side delivery |
| Local notifications | **No** | `expo-notifications` is not a dependency |

**In short: the backend and the shared logic are ready for a phone; the client is not.**

---

## 3. The architectural constraint, and how the branch addresses it

Because Convex here is configured with a `customJwt` provider
(`convex/auth.config.ts:24-34`), **a mobile client cannot mint its own Convex token** — the
RS256 private key must stay on the Next.js server. The browser solves this with an HttpOnly
cookie that the server reads. A phone cannot rely on a cookie jar.

The branch's answer is a new route, `src/app/api/mobile/auth/route.ts`, which:

* validates the credentials through the same `users:login` mutation the browser uses;
* opens the same server-side session through `users:startSession`;
* mints the same 15-minute RS256 access token through the same `signAccessToken`;
* returns it **in the response body**, alongside a **refresh credential** built from the
  existing `signSession` helper — the very same HMAC-signed session payload the browser's
  cookie carries, handed back as a bearer token instead;
* revokes the session on logout through `users:endSession`.

The refresh credential is stored with `expo-secure-store` using
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it is in the Android keystore / iOS keychain and cannot be
restored onto another phone from a backup. The private key and the session secret never leave
the server.

**Assessment: this is the right design.** It reuses the existing session machinery rather than
inventing a second token scheme, and it keeps the trust model identical to the browser's.

---

## 4. What the branch contains

27 new or changed files:

```
apps/mobile/
  app.json                     Expo configuration (SDK 58, camera/secure-store/notification plugins)
  package.json                 30 dependencies, pinned to convex 1.31.7 to match the root
  tsconfig.json                strict, moduleResolution bundler, path alias @/*
  babel.config.js              babel-preset-expo
  metro.config.js              watches the workspace; pins one copy of convex
  eas.json                     development / preview / production / production-apk profiles
  .env.example                 EXPO_PUBLIC_CONVEX_URL, EXPO_PUBLIC_API_URL
  src/lib/config.ts            build configuration
  src/lib/shared.ts            re-export of packages/shared
  src/lib/convex-api.ts        re-export of the generated Convex API
  src/lib/convex-client.ts     ConvexReactClient with automatic token renewal
  src/lib/auth.ts              sign in / renew / sign out
  src/lib/token-store.ts       expo-secure-store credential store
  src/lib/session.tsx          session, businesses, permissions
  src/theme.tsx                light and dark themes
  src/components/ui.tsx        the interface kit
  src/lib/offline/*.ts         SQLite queue, catalogue cache, cart store, sync engine, device, network
  src/lib/hardware/*.ts(x)     barcode scanner, printer adapter, notifications
packages/shared/               the shared business logic (see below)
src/app/api/mobile/auth/       the mobile sign-in route
src/lib/mobile-auth.ts         the session issuing helpers
convex/notifications.ts        push token registration and delivery
```

### 4.1 The shared package

`packages/shared/` is new, and it is a genuine refactor rather than a copy:

| Module | Moved from | Also used by |
|---|---|---|
| `vat.ts` | `src/lib/vat.ts` | Web receipts, mobile receipts |
| `permissions.ts` | `src/lib/permissions.ts` | Web interface, mobile interface |
| `escpos.ts` | `src/lib/escpos.ts` | Web printing, mobile printing |
| `cart.ts` | new | Cart arithmetic |
| `payments.ts` | new | Payment rules and confirmation |
| `offline.ts` | new | Offline state machine |
| `validation.ts` | new | Form validation |
| `types.ts` | new | Shared vocabulary |

`src/lib/vat.ts` and `src/lib/permissions.ts` on the branch are now thin re-exports, so the web
application's behaviour is unchanged while there is only one implementation of each rule. The
shared package has **no runtime dependencies**, which is what makes it consumable from a
Next.js route, a React Native bundle and a Node test without any of them knowing about the
others.

### 4.2 The offline engine

The branch ports the browser offline engine to SQLite (`expo-sqlite`) with the same semantics:
the same idempotency key, the same `pending / syncing / synced / failed / conflict` states, the
same exponential backoff, the same "a synced sale is never deleted" rule, and the same refusal
to represent an offline transaction as confirmed.

### 4.3 The hardware adapters

| Adapter | Status |
|---|---|
| **Barcode (camera)** | Implemented on top of `expo-camera`. **Never run.** |
| **Receipt printing (system)** | Implemented on top of `expo-print` (HTML receipt). **Never run.** |
| **Receipt printing (Bluetooth ESC/POS)** | Declared, and **reported as unavailable** — it needs a native module that is not part of the Expo development build. The adapter raises a clear error rather than pretending to work. |
| **Receipt printing (network ESC/POS)** | Declared, likewise unavailable — raw TCP on port 9100 needs a socket module. |
| **Push notifications** | `expo-notifications` local notifications implemented; remote push needs an Expo project id, and the code says so when there is not one. |
| **Secure credential storage** | `expo-secure-store`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. |

**This is the honest position, and it is the right one.** The spec asked for Bluetooth and
network printers to be *evaluated before being selected*. The evaluation is in
`docs/MOBILE.md` on the branch; the code refuses to claim a capability it does not have.

---

## 5. What the branch does **not** contain

| Missing | Consequence |
|---|---|
| **Any screen at all** | There is no sign-in, no dashboard, no point of sale, no inventory, no customers, no staff, no subscription screen. The providers and the interface kit exist; no route uses them |
| Expo Router `app/` directory | `expo-router/entry` is the entry point but there is no `app/` folder, so the application starts and immediately has nothing to show |
| A shared-package path mapping for Metro | `metro.config.js` watches the workspace and pins `convex`, but the `@smartbuz/shared` alias is **not** wired into Metro — the branch uses relative imports instead, which works, but the tsconfig's `@/*` alias is not mirrored in Metro and would fail if used |
| Tests | No test covers the shared package, the SQLite queue or the mobile rules |
| Type-check evidence | `tsc --noEmit` has **not** been run for `apps/mobile` |
| Build evidence | `expo prebuild`, `expo export` and EAS builds have **not** been run |
| Device evidence | No Android or iOS device or emulator was available |
| Documentation | `docs/MOBILE.md` is **not** on the branch (it was in progress when the work was parked) |
| The `pushTokens` schema change deployed | `convex/notifications.ts` and the `pushTokens` table exist in the branch but have **not** been pushed to any deployment, and `convex codegen` has not been re-run for them |

**The branch is a foundation, not an application.** It is roughly a third of the way to a
shippable client: the plumbing, the shared rules and the offline engine are there; the screens
are not.

---

## 6. Verification that was possible, and what was not

| Check | Result |
|---|---|
| `npm install` in `apps/mobile` (546 packages) | **Succeeded** |
| Dependency versions | Expo SDK 58.0.26, React 19.3.0, React Native 0.88.1, `expo-router` 58.0.32 — the current SDK |
| Convex version | Pinned to 1.31.7 to match the root, so the client and the generated API speak the same protocol |
| Camera, SQLite, secure store, print, notifications, haptics, network APIs | Confirmed present in the installed packages, with the expected exported symbols |
| `tsc --noEmit` (mobile) | **Not run** |
| `expo prebuild` / `expo export` | **Not run** |
| EAS build | **Not possible** — it needs an Expo account and a cloud build |
| Camera, scanner, printer, notifications on a device | **Not possible** — no device or emulator was available |

**This report does not claim the mobile application works.** It does not work yet. What can be
said is that the architecture is right, the dependencies resolve, the shared rules are real, and
the parts that were written are written to the same standard as the rest of the platform.

---

## 7. Requirements coverage

| Requirement (from the Phase 8 brief) | Status |
|---|---|
| Reuse the existing Convex backend and database | **Met** — the same deployment, the same generated API, no second backend |
| Reuse the existing authentication infrastructure | **Met in design** — the same session machinery, a new route that returns the token in the body |
| Preserve business isolation and server-side permissions | **Met** — no client-side authorisation; the server's guards are the only authority |
| No private backend secrets in the mobile app | **Met** — the branch reads no secret; `EXPO_PUBLIC_*` values are public addresses |
| Shared TypeScript packages | **Met** — `packages/shared`, now the single implementation of the VAT, permission, receipt, cart, payment and offline rules |
| Module A — Authentication | **Partly** — the service, the token store and the session provider exist; the screens do not |
| Module B — Dashboard | **Not implemented** |
| Module C — Mobile POS | **Partly** — the cart arithmetic, the payment rules and the queue exist; the screens do not |
| Module D — Inventory | **Partly** — the catalogue cache exists; the screens do not |
| Module E — Customers and suppliers | **Not implemented** |
| Module F — Business management | **Not implemented** |
| Module G — Subscription and licensing | **Partly** — `subscriptions.getSubscriptionState` and `listDevices` exist on the server; no screen |
| Offline-first: local storage, queue, retry, sync, idempotency, conflicts, statuses | **Met in the engine** — the SQLite port exists; no screen uses it yet |
| Hardware: camera, barcode, notifications, printing, device info, secure storage | **Partly** — the adapters exist and have never been run |
| UI/UX: premium, mobile-first, bottom navigation, light/dark, states, accessible | **Partly** — the theme and the interface kit exist; no screens |
| Testing | **Not implemented** |
| Deployment: EAS, APK/AAB, iOS production builds | **Configured, not executed** — `eas.json` and `app.json` are prepared; no build was run |

---

## 8. Findings

**H-07 (High).** There is no mobile application in production. A business whose tills are
phones has no product. This is the single largest gap between the platform's stated scope and
what it delivers.

**M-45 (Medium).** The mobile authentication route `src/app/api/mobile/auth/route.ts` does not
exist on `main`. A phone cannot sign in to the deployed platform today.

**M-46 (Medium).** No push notification support exists on `main` — no token table, no
registration, no delivery.

**M-47 (Medium).** The branch's Metro configuration does not map the `@smartbuz/shared` alias,
while its tsconfig does. The branch avoids this by using relative imports, but the two
configurations disagree, and the first person to use the alias will get a Metro resolution
error.

**M-48 (Medium).** The branch is untested and unbuilt. It must not be merged as "the mobile
application" without the screens, the tests, the type-check and at least one successful
`expo export`.

---

## 9. Recommendations, in order

1. **Finish the screens.** Sign-in, business picker, dashboard, POS (search, scan, cart,
   checkout, receipt), sales history, inventory, customers, suppliers, staff, subscription,
   settings. The providers and the interface kit are ready for them.
2. **Type-check and build.** `tsc --noEmit` in `apps/mobile`, then `expo export` for both
   platforms, then a development build on a real device.
3. **Test the shared package.** `packages/shared` is pure TypeScript with no dependencies, so
   the existing `scripts/run-tests.mjs` harness can test it directly — cart arithmetic, payment
   confirmation, the offline state machine, the validation rules. This is the cheapest way to
   raise confidence in the rules both clients now share.
4. **Wire the alias properly** or remove it from the tsconfig, so the two configurations agree.
5. **Choose the printer deliberately.** The evaluation is in `docs/MOBILE.md`; the decision
   needs a real pocket printer and a real test.
6. **Run `convex codegen` and push the `pushTokens` schema** before the notifications feature
   is enabled.
7. **Set up an EAS project** and produce a signed APK and an iOS build.

None of this is a redesign. It is the second half of a plan that was already sound.
