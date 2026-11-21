# SMARTBUZ v2.0 — 13 · Mobile (React Native / Expo) Test Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Status of this component:** **NOT IMPLEMENTED**
**Overall verdict:** There is no mobile application to test. The mobile source tree does not exist in the repository.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Inspection | Directory listing of `apps/`, dependency manifest scan, repository-wide reference scan, CI workflow scan |
| Commands | `ls apps/mobile`, `grep -iE 'expo\|react-native' package.json`, repository-wide reference scan of `src/ convex/ docs/ scripts/ tests/` |
| Live testing | **None possible** — no buildable mobile target exists |
| Destructive tests | None run (nothing to run against) |

---

## 2. What actually exists

```
apps/
└── mobile/
    └── node_modules/      ← 338 installed packages (@expo, @react-native, @react-native-masked-view, …)
```

That is the entire directory. **There is no `package.json`, no `app.json` / `app.config.ts`, no `App.tsx`, no `src/`, no `tsconfig.json`, no `eas.json`, no `.expo/` configuration and no Metro config** anywhere in the repository.

| Mobile artefact | Present? | Evidence |
|---|---|---|
| `apps/mobile/package.json` | **NO** | `ls apps/mobile` → only `node_modules/` |
| Expo app config (`app.json` / `app.config.ts`) | **NO** | same |
| React Native entry point (`App.tsx` / `index.js`) | **NO** | same |
| Mobile source tree | **NO** | same |
| `expo` / `react-native` in the root `package.json` | **NO** | `package.json:15-81` — dependency list contains neither |
| EAS build profiles | **NO** | no `eas.json` anywhere |
| Mobile CI workflow | **NO** | `.github/workflows/ci.yml` is the only workflow; it targets Node 22 + Next.js |
| Mobile tests | **NO** | `tests/` contains 11 node-only suites; no Jest/Expo test config |

**Conclusion:** an Expo project was scaffolded and its dependencies installed into `apps/mobile/node_modules/`
(338 packages, including `@expo/*` and `@react-native/*`), but **the application source was never committed and
the project manifest is absent**. What remains is a stale dependency tree with nothing to build.

---

## 3. Status table

| Area | Status | Evidence |
|---|---|---|
| Android startup | **NOT IMPLEMENTED** | no application source |
| iOS startup | **NOT IMPLEMENTED** | no application source |
| Login / registration | **NOT IMPLEMENTED** | no mobile auth code |
| Navigation | **NOT IMPLEMENTED** | no mobile navigation code |
| Convex connectivity | **NOT IMPLEMENTED** | no mobile Convex client |
| Authentication persistence | **NOT IMPLEMENTED** | no mobile token storage |
| Product loading | **NOT IMPLEMENTED** | no mobile query code |
| POS checkout | **NOT IMPLEMENTED** | no mobile checkout |
| Barcode scanning | **NOT IMPLEMENTED** | no camera/scanner code (web keyboard-wedge only — `src/lib/hardware/barcode.ts`) |
| Camera permissions | **NOT IMPLEMENTED** | no Expo permissions in any manifest |
| Local storage | **NOT IMPLEMENTED** | no mobile storage layer |
| Offline operation | **NOT IMPLEMENTED** on mobile | the offline engine is browser-IndexedDB based (`src/lib/offline/db.ts`); it is not portable to SQLite |
| Synchronization | **NOT IMPLEMENTED** on mobile | `convex/sync.ts` server side exists; no mobile client exists to drive it |
| Notifications | **NOT IMPLEMENTED** | no `expo-notifications` dependency, no push token table, no server-side delivery |
| Mobile responsiveness | **N/A** | applies to the web app — see `03_FRONTEND_TEST_REPORT.md` |
| Mobile performance | **NOT IMPLEMENTED** | no build to measure |
| Crash reporting | **NOT IMPLEMENTED** | no mobile monitoring |
| Production build configuration | **NOT IMPLEMENTED** | no `eas.json`, no `app.json`, no build scripts |

**Counts: 0 PASSED, 0 FAILED, 19 NOT IMPLEMENTED, 0 NOT TESTED.**

---

## 4. Findings

### MOB-01 — No React Native / Expo application exists in the repository
- **ID:** MOB-01
- **Module:** Mobile application
- **Severity:** **HIGH**
- **Description:** `apps/mobile/` contains only a 338-package `node_modules/` tree. There is no Expo project — no manifest, no entry point, no source, no build configuration, and no Expo dependency in the root `package.json`. The mobile platform described in the product plan is not present in the codebase.
- **Steps to reproduce:** `ls apps/mobile` → `node_modules/` only. `grep -iE 'expo|react-native' package.json` → no matches.
- **Expected behavior:** An Expo/React Native application source tree, its manifest, and a build configuration would be present and buildable.
- **Actual behavior:** Only an orphaned `node_modules/` directory exists. Nothing builds, nothing runs, nothing can be installed on a device.
- **Root cause:** The project was scaffolded (dependencies installed) but the source was never committed. The directory is not tracked by git, so it is invisible to every other developer and to CI.
- **Recommended fix:** Either (a) commit the mobile project properly — `apps/mobile/package.json`, `app.json`, `App.tsx`, `src/`, `eas.json`, and an `apps/mobile` entry in a workspace root — or (b) delete `apps/mobile/` so the repository does not imply a mobile app that does not exist, and record the mobile work as a separate roadmap item.
- **Test required to verify the fix:** `npx expo export --platform android` (or EAS build) must succeed from a clean checkout, and the resulting artifact must be installable.

### MOB-02 — Mobile authentication has no viable design, and the current session model cannot be carried to a phone
- **ID:** MOB-02
- **Module:** Mobile authentication
- **Severity:** **HIGH**
- **Description:** The entire session model is an HttpOnly cookie issued by the Next.js server (`src/lib/session.ts`, `src/app/api/auth/route.ts`). React Native has no reliable cookie jar, and the current browser session cannot be transferred to a device. The refresh path `GET /api/auth/convex-token` (`src/app/api/auth/convex-token/route.ts`) authenticates the caller *by cookie alone* — it reads `getSessionFromRequest(request)` and mints a token for whoever presents a valid cookie. There is no device-code, refresh-token or assertion flow, so a phone client has no way to obtain a token.
- **Steps to reproduce:** Static inspection: `src/app/api/auth/convex-token/route.ts:35-40` (cookie → token, no other credential) and `src/lib/session.ts` (cookie is the only session carrier).
- **Expected behavior:** A mobile client could authenticate and refresh a token with a credential that does not depend on a browser cookie (for example a long-lived, revocable refresh token bound to the device, exchanged for the same 15-minute RS256 access token).
- **Actual behavior:** Token issuance depends exclusively on the HttpOnly session cookie. A native client cannot use it, and no alternative exists.
- **Root cause:** The session architecture was designed web-only; the refresh-token endpoint was not designed to accept a second credential type.
- **Recommended fix:** Introduce a device-bound refresh credential: a second endpoint (or a parameter on the existing one) that accepts a signed refresh token, verifies it against the Convex session row, and mints the same 15-minute access token. The refresh token must be revocable and must be bound to the registered device id so that revoking a device invalidates it.
- **Test required to verify the fix:** A test that obtains a refresh token through the new flow, exchanges it for an access token, then proves that (a) the access token produces a verified identity, (b) a revoked/expired refresh token does not, and (c) a refresh token issued for device A cannot be used to authorise device B.

### MOB-03 — The offline engine is browser-specific and cannot be reused on mobile without a rewrite
- **ID:** MOB-03
- **Module:** Offline / mobile
- **Severity:** **MEDIUM**
- **Description:** The offline engine is built on the browser Storage APIs — `src/lib/offline/db.ts` (22 KB of IndexedDB access), `src/lib/offline/queue.ts` (durable queue), `src/lib/offline/sync.ts` (18 KB), `src/lib/offline/session-cache.ts`. The server half is portable (`convex/sync.ts` exposes `registerDevice`, `pushTransactions`, `listConflicts`, `resolveConflict`, `getSyncStatus`, `listSyncLogs`), but the client half depends on IndexedDB, `navigator.onLine` (`src/lib/offline/network.ts`) and the browser Cache/Service Worker APIs (`public/sw.js`).
- **Steps to reproduce:** Static inspection of `src/lib/offline/**` and `public/sw.js`.
- **Expected behavior:** Either a portable storage abstraction with an SQLite implementation for mobile, or an explicit statement that mobile offline is out of scope.
- **Actual behavior:** The storage, connectivity and caching layers are browser-bound; porting them is a rewrite, not a configuration change.
- **Root cause:** The persistence and transport concerns were not separated from the browser platform.
- **Recommended fix:** Introduce a `StorageAdapter` interface behind `src/lib/offline/db.ts` and implement it with `expo-sqlite` for mobile. Keep the sync protocol in `src/lib/offline/sync.ts` platform-neutral. Defer until the mobile app exists (MOB-01).
- **Test required to verify the fix:** The same offline scenario suite (`tests/offline-client.test.ts` logic) executed against the SQLite adapter must produce identical queue and conflict outcomes.

### MOB-04 — Hardware peripherals are browser-only (Web Serial / WebUSB)
- **ID:** MOB-04
- **Module:** Hardware integration
- **Severity:** **LOW**
- **Description:** Receipt printing and cash-drawer control go through `src/lib/escpos.ts:258` (`printDirectWebSerial`, Web Serial API) and `src/lib/hardware/printer.ts`. Web Serial does not exist in React Native, so the device layer cannot be reused on a phone.
- **Steps to reproduce:** `grep -n 'navigator.serial' src/lib` → `src/lib/escpos.ts:258`.
- **Expected behavior:** A printer transport abstraction with a Web Serial implementation for the browser and a platform-specific implementation for mobile.
- **Actual behavior:** One browser-only transport.
- **Root cause:** Transport abstraction not introduced when the hardware layer was written.
- **Recommended fix:** Extract a `PrinterTransport` interface; keep the Web Serial implementation; add a Bluetooth/ESC-POS-over-BLE implementation for mobile later.
- **Test required to verify the fix:** A transport-level test that renders the same ESC/POS byte stream through the interface and asserts byte-identical output for both transports.

### MOB-05 — No mobile monitoring, crash reporting or push notification pipeline
- **ID:** MOB-05
- **Module:** Mobile operations
- **Severity:** **MEDIUM**
- **Description:** The platform has no error-reporting dependency of any kind (no Sentry, no Datadog, no OpenTelemetry — confirmed against the full dependency list in `package.json:15-81`), no push-notification token table in the 93-table schema, and no server-side push delivery. `convex/integrations/messaging.ts` and `providers/messaging.ts` handle SMS/email, not push. For a POS used on shared devices, a silent crash with no telemetry means a till can die without anyone knowing.
- **Steps to reproduce:** `grep -i 'sentry|datadog|opentelemetry' package.json` → no matches. Schema scan for a push-token table → none of the 93 tables.
- **Expected behavior:** Crash reporting for both web and mobile, and a documented operational path for "the till is down".
- **Actual behavior:** Neither exists. The only error visibility is `console.error` in catch blocks, which disappears with the browser tab.
- **Root cause:** Operational monitoring was never part of the build.
- **Recommended fix:** Add error monitoring for the web app first (it is the product that exists), then a push-token table and a delivery path before any mobile release.
- **Test required to verify the fix:** A deliberately thrown error in a staging environment must appear in the monitoring backend within the expected latency, with the release/commit identifier attached.

---

## 5. What was NOT TESTED, and why

| Item | Why |
|---|---|
| Anything requiring a mobile build | No application source exists; nothing can be built or run |
| Device camera/barcode behaviour | No native module to exercise |
| App Store / Play Store submission readiness | No bundle, no store metadata, no signing configuration |
| Mobile-to-web data interoperability | No mobile client to reconcile against the server |

---

## 6. Findings summary

**MOB-01** HIGH · **MOB-02** HIGH · **MOB-03** MEDIUM · **MOB-04** LOW · **MOB-05** MEDIUM

**Counts: 0 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW, 0 INFORMATIONAL**

---

## 7. Honest assessment

The product documentation in this repository describes a mobile application. **It does not exist in code.** Any
statement that "the mobile app is in progress" should be read as "the dependencies were installed and the source
was not committed". The server-side offline sync protocol (`convex/sync.ts`) and the device-registration model
(`hardwareDevices`) are real and reusable, but they currently have no mobile client, and the token endpoint has no
credential path a native app can use. Mobile readiness is therefore **zero**, not "partial".
