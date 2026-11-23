# SMARTBUZ — Deployment Runbook

**Audience:** whoever is on call. **Scope:** releasing, rolling back, rotating
keys, and answering "the app is 503" at 02:00.

This runbook exists because of the 19 November 2026 outage. `SMARTBUZ_JWT_PRIVATE_KEY`
had never been added to the Vercel project, so every signed-in browser received
HTTP 503 from `/api/auth/convex-token`, the Convex backend treated every request
as anonymous, and the first signal of trouble was a customer reading their
browser console. Nothing in the pipeline could have caught it, and nothing told
us it had happened.

Everything below is written to be followed literally. Where a step cannot be
done from a clean checkout, it says so.

---

## 1. What is deployed, and where

| Piece | Hosted at | Deployed by | Trigger |
|---|---|---|---|
| Web app (Next.js) | Vercel — `https://smartbuz.vercel.app` | Vercel, git-connected to `github.com/BEINOMUGISHA/SMARTBUZ` on branch `main` | A push to `main` auto-deploys. No manual step. |
| Convex backend | Convex Cloud — `affable-panda-681.convex.cloud` (site `affable-panda-681.convex.site`) | `npx convex deploy`, run by hand | **Manual.** Not part of any pipeline until 20 Nov 2026; see §7. |
| CI quality gates | GitHub Actions — `.github/workflows/ci.yml` | — | Push to `main`, or a PR against `main`. |

Two facts follow from that table and they cause most of the incidents this
document exists for:

1. **The web app and the backend are released separately.** A push to `main`
   moves the web app and leaves the backend exactly where it was. Nothing in
   the pipeline compares the two.
2. **`NEXT_PUBLIC_*` variables are inlined into the client bundle at build
   time.** Editing one in the Vercel dashboard changes nothing until a new
   build is produced. A redeploy is always required; editing is not enough.

### What "deployed" means for the backend

A commit that changes `convex/schema.ts` or any function under `convex/`
changes nothing in production until someone publishes the functions.

**Which deployment you publish to is the single easiest thing to get wrong
here, and on 21 Nov 2026 it was got wrong in a way that reported success.**

This installation has **two** Convex deployments:

| Deployment | URL | Role |
|---|---|---|
| `affable-panda-681` (`CONVEX_DEPLOYMENT=dev:affable-panda-681`) | `affable-panda-681.convex.cloud` | **The one the web app points at.** Holds the real data. The CLI treats it as the *dev* deployment. |
| `shocking-mule-553` | `shocking-mule-553.convex.cloud` | The *production* deployment of the Convex project. Not used by the app. |

`npx convex deploy` publishes to the project's **production** deployment —
`shocking-mule-553` — **not** to the one `NEXT_PUBLIC_CONVEX_URL` points at.
The deploy prints "✔ Deployed Convex functions" and the app keeps serving the
old code.

To publish to the deployment the app actually uses:

```bash
npx convex dev --once
```

`convex dev --once` pushes the functions to the deployment named by
`CONVEX_DEPLOYMENT` and exits without starting the watcher.

**Always verify which deployment is serving the code** — the check the CI
workflow now performs (§7):

```bash
# Prints the deployment's function list; a fresh deploy contains this function.
npx convex function-spec --url https://affable-panda-681.convex.cloud \
  | grep -c listUnsubscribed
```

A `0` means the deployment is still running the old code.

---

## 2. Releasing

### 2.1 A change that touches only the web app

```bash
git checkout main
git pull
npm ci
npm run typecheck        # tsc --noEmit
npm test                 # node scripts/run-tests.mjs
npm run build
git push origin main     # this is the deploy
```

Then watch the deployment:

```bash
# Vercel exposes the production alias; poll until it answers.
curl -s -o /dev/null -w "%{http_code}\n" https://smartbuz.vercel.app/api/health
```

Wait for the Vercel build to finish before declaring the release done. A push
to `main` triggers a build; the GitHub Actions run and the Vercel build are
independent.

### 2.2 A change that touches the Convex backend

The backend and the web app must be released in an order that never leaves a
live mismatch. The rule is:

- **Additive changes** (new optional fields, new functions, new tables) —
  deploy the **backend first**. The old web build keeps working against the
  new backend, because nothing it calls has been removed.
- **Destructive changes** (removing or renaming a field or function) —
  deploy the **web app first**, and only deploy the backend once the new web
  build is live and no longer calls what was removed.

In both cases the backend deploy is a separate, manual step:

```bash
git checkout main
git pull
npm ci

# Publish to the deployment the app points at. `npx convex deploy` would
# publish to the project's *production* deployment, which is a different one
# — see §1, "What deployed means for the backend".
npx convex dev --once
```

`npx convex dev --once` prints the deployment it pushed to. Read it back and
confirm it is `affable-panda-681.convex.cloud` before you walk away. Convex
requires an authenticated session (`npx convex login`) or `CONVEX_DEPLOY_KEY`.

Then verify the deployment is really serving the new code — a deploy can
report success and still leave the app on the old one:

```bash
npx convex function-spec --url https://affable-panda-681.convex.cloud \
  | grep -c listUnsubscribed      # must be 1, not 0
```

Then release the web app as in §2.1.

> **After this particular release, run the subscription backfill.**
>
> The entitlement gate now fails closed: a business with no subscription row
> is not licensed and cannot record anything new. That is the correct
> behaviour, but it catches any tenant that was registered through the path
> that never created a subscription — and those tenants would find their
> tills unable to record.
>
> The backfill gives each of them a trial. Run it **immediately** after the
> deploy:
>
> ```bash
> node scripts/backfill-subscriptions.mjs --dry-run   # see what would change
> node scripts/backfill-subscriptions.mjs
> ```
>
> It needs the server-to-backend secret (`SMARTBUZ_SERVER_SECRET`, or
> `RESEND_API_KEY` / `SESSION_SECRET` as fallbacks) in the environment, and
> `NEXT_PUBLIC_CONVEX_URL` pointing at the deployment.
>
> **Set `SMARTBUZ_SERVER_SECRET` in the Convex deployment's environment
> before you deploy.** The backfill calls a function that checks the secret
> against the value the *deployment* holds, and the migration and the
> seeder are gated on the same one. If the deployment does not have it, the
> backfill is refused and the tenants that need it stay blocked.
>
> When the backend deploy runs from CI, the workflow does this automatically
> on the step straight after `npx convex deploy`.
>
> A business that already has a subscription is left alone — the backfill
> only fills gaps.

> **Verify the backend is reachable after every backend deploy:**
> ```bash
> curl -s https://affable-panda-681.convex.cloud/version
> curl -s https://affable-panda-681.convex.site/auth/jwks | head -c 200
> ```
> The second call must return a JSON document with a `keys` array. If it
> returns an error, the backend is broken and the web app cannot mint a token
> that Convex will accept.

### 2.3 Before every release, check the configuration

```bash
node scripts/validate-config.mjs --prod
```

It prints the **names** of anything missing, mis-shaped or too short, and
exits non-zero if there is a problem. It never prints a secret. Run it against
a `.env.local` to check a local configuration, or with no file to check the
current shell / CI environment.

---

## 3. Rolling back

### 3.1 Rolling back the web app

Vercel keeps every previous build. A rollback is a redeploy of an older one —
no rebuild, no code change, and therefore seconds rather than minutes.

1. Vercel dashboard → the project → **Deployments**.
2. Find the last deployment you know was good. Note its commit SHA and its
   age. *Do not* pick a preview deployment.
3. **⋯ → Redeploy** (or "Promote to Production", depending on the UI).
4. Wait for it to reach **Ready**, then confirm:

   ```bash
   curl -s -i https://smartbuz.vercel.app/api/health
   ```

Because `NEXT_PUBLIC_*` values are baked into the build, a redeploy also
restores the *old* inlined values. That is what you want during a rollback.

To roll back to a specific commit instead of a specific build:

```bash
git revert <sha>          # preferred: keeps history honest
git push origin main
```

### 3.2 Rolling back the Convex backend

There is no one-click rollback of Convex functions. You redeploy an older
commit's `convex/` directory:

```bash
# In a scratch clone, so the working tree you are on is untouched.
git clone https://github.com/BEINOMUGISHA/SMARTBUZ.git /tmp/smartbuz-rollback
cd /tmp/smartbuz-rollback
git checkout <last-good-sha>
npm ci
npx convex deploy
```

Two things this does **not** do:

- **It does not roll back data.** Convex keeps the documents; redeploying old
  functions does not delete the rows they wrote. A schema change that dropped
  a field does not put the field back.
- **It does not roll back the schema.** The schema is pushed with the
  functions, but Convex does not remove tables or fields that the new schema
  no longer declares. Rolling the functions back to a schema that expects a
  field which was never removed will still work; rolling back to one that
  expects a field the new schema *added* will not.

If a release wrote wrong data, no rollback helps — that is a data repair, and
it needs its own plan.

### 3.3 Which one to roll back first

Roll back the **web app first**. It is fast, it is reversible, and it stops
users seeing the new behaviour. Only then decide about the backend: if the
backend change is the cause, roll it back too (§3.2), but never leave the web
app running against a backend you have already rolled back.

---

## 4. Rotating keys and secrets

Four different secrets live in two different places. Confusing them is how
sessions get invalidated for every user at once.

| Variable | Lives on the web app (Vercel) | Lives on the backend (Convex) | Effect of rotating it |
|---|---|---|---|
| `SMARTBUZ_JWT_PRIVATE_KEY` | yes (secret) | no — the **public** half lives in `convex/authJwks.ts` and is deployed with the backend | Access tokens signed with the old key stop verifying. Sessions survive (they are cookies, not tokens). |
| `SMARTBUZ_SERVER_SECRET` | yes (secret) | **yes** — the same value | Server-to-backend calls that are gated by the secret start failing while the two sides disagree. |
| `RESEND_API_KEY` | yes (secret) | only if it is acting as the fallback server secret | Outbound email stops working; and, if it is the fallback, the server secret changes with it. |
| `SESSION_SECRET` | yes (secret) | only if it is acting as the fallback server secret | **Every session cookie stops verifying — every user is signed out.** |

**The fallback chain matters.** `convex/serverSecret.ts` reads the server
secret from `SMARTBUZ_SERVER_SECRET`, else `RESEND_API_KEY`, else
`SESSION_SECRET`. If `SMARTBUZ_SERVER_SECRET` is *not* set on the Convex
deployment, then rotating the email key or the session secret silently rotates
the server secret as well, on one side only, and the two sides stop agreeing.

**Therefore: set `SMARTBUZ_SERVER_SECRET` explicitly, on both sides, before
rotating anything else.** After that, the email key and the session secret are
independent of the server secret and can be rotated safely.

### 4.1 Rotating `SMARTBUZ_JWT_PRIVATE_KEY` (the RSA signing key)

The key pair is split across two artefacts that are deployed independently:
the **public** key is committed in `convex/authJwks.ts` and reaches the backend
through `npx convex deploy`; the **private** key lives only in the Vercel
environment. The order is the whole procedure.

**Prerequisite — the JWKS must be able to hold two keys.** `convex/jwks.ts`
currently publishes a single key (`{ keys: [SMARTBUZ_JWK] }`) with
`Cache-Control: public, max-age=3600`. A safe rotation needs the *old* and the
*new* public key published together for the overlap window, and it needs that
window to be longer than the cache lifetime. Until `convex/jwks.ts` serves a
key set, use the wait-out-the-cache variant in §4.1b.

#### 4.1a Overlapping rotation (recommended; requires the key-set change)

```bash
# 1. Generate a new pair. The private key is printed to your terminal and
#    must go straight into your password manager - never into git.
node scripts/generate-auth-keys.mjs
```

2. Add the **new public JWK** to `convex/authJwks.ts` next to the old one and
   change `convex/jwks.ts` to publish both:

   ```ts
   // convex/jwks.ts
   JSON.stringify({ keys: [SMARTBUZ_JWK, SMARTBUZ_JWK_PREVIOUS] })
   ```

3. Commit and deploy the **backend** (see §2.2). The backend now publishes two
   keys.

4. **Wait 60 minutes.** The JWKS is cached publicly for an hour, so Convex may
   still be verifying against the old cached key set. Do not skip this.

5. Confirm the new key is actually being served:

   ```bash
   curl -s https://affable-panda-681.convex.site/auth/jwks | python -c \
     "import json,sys; print([k['kid'] for k in json.load(sys.stdin)['keys']])"
   ```

   The new `kid` must appear in that list.

6. Set the **new private key** in Vercel (Production scope) and redeploy.
   Editing the variable alone does nothing — `NEXT_PUBLIC_*` aside, a server
   restart is needed for the process to read the new value, and the redeploy
   is what does that.

   ```bash
   # Generate the exact env line to paste into the Vercel dashboard.
   node scripts/generate-auth-keys.mjs | grep SMARTBUZ_JWT_PRIVATE_KEY
   ```

7. Verify end to end:

   ```bash
   curl -s -i https://smartbuz.vercel.app/api/health          # 200
   curl -s -i https://smartbuz.vercel.app/api/auth/convex-token # 200 with a token
   ```

8. Remove the **old public key** from `convex/authJwks.ts` and `convex/jwks.ts`,
   commit, deploy the backend, wait 60 minutes again, then destroy the old
   private key. Only now is the rotation complete.

#### 4.1b Without the key-set change (wait it out)

```bash
# 1. Publish the new public key only.
#    Edit convex/authJwks.ts, commit.
npx convex deploy

# 2. WAIT 60 MINUTES. Convex caches the JWKS for max-age=3600, and it must
#    re-read it before it will accept a token signed with the new key.

# 3. Only now, set the new private key in Vercel and redeploy.

# 4. Verify.
curl -s -i https://smartbuz.vercel.app/api/auth/convex-token
```

**Never set the new private key before the backend publishes the new public
key.** In that order every newly minted token is signed with a key Convex does
not know, and every signed-in user sees an error until it is fixed.

### 4.2 Rotating `SMARTBUZ_SERVER_SECRET`

The same value must exist on both sides at all times, or the operations gated
by it — opening a session, reading a password-reset code, sending a
verification email — fail closed with a 403.

```bash
# 1. Generate.
openssl rand -base64 48

# 2. Set it on the backend first.
npx convex env set SMARTBUZ_SERVER_SECRET '<new-value>'

# 3. Set the same value in the Vercel dashboard (Production scope) and redeploy.

# 4. Verify: sign in, and request a password-reset email. Both must work.
```

There is no atomic way to change a secret on two systems at once. The window
between steps 2 and 3 is a window in which those operations fail. Keep it as
short as possible, and do it outside trading hours.

### 4.3 Rotating `RESEND_API_KEY`

```bash
# 1. Create the new key in the Resend dashboard.
# 2. Set it in Vercel (Production scope) and redeploy.
# 3. Verify by requesting a password-reset email.
# 4. Revoke the old key in Resend.
```

**Before step 2**, confirm that `SMARTBUZ_SERVER_SECRET` is set on *both*
sides. If it is not, `RESEND_API_KEY` is the server secret fallback and
rotating it changes the server secret on the web side only — the backend would
then be comparing against the old value and every gated operation breaks.
Fix the fallback chain (§4 preamble) before rotating the email key.

### 4.4 Rotating `SESSION_SECRET`

```bash
openssl rand -base64 48
```

Set it in Vercel and redeploy. **Every signed-in user is signed out** the
moment the new value is live, because the cookie is an HMAC over the old
secret and no longer verifies. There is no way to avoid this; the only
choice is when to do it. Announce it, or do it at the start of a quiet
morning.

`SESSION_SECRET` must be at least 32 characters — `src/lib/session.ts` throws
outright when it is missing or shorter, so a short value does not degrade
gracefully, it breaks login entirely.

---

## 5. The app returns 503 — what to check, in order

Do these in order. The first two take seconds and between them they identify
almost every real case.

### 5.1 Is the app healthy?

```bash
curl -s -i https://smartbuz.vercel.app/api/health
```

The body is JSON and it never contains a secret value:

```json
{
  "status": "error",
  "timestamp": "2026-11-20T04:12:33.001Z",
  "checks": [
    { "name": "convex", "status": "ok", "required": true, "latencyMs": 84 }
  ],
  "missingVariables": ["SMARTBUZ_JWT_PRIVATE_KEY"]
}
```

- `status: "ok"` and HTTP 200 → the app's own dependencies are fine. If the
  browser still fails, the problem is in the browser or the user's session,
  not in the deployment.
- `missingVariables` is non-empty → **§5.2**.
- `checks[0].status` is `timeout`, `unreachable` or `unexpected-response` →
  **§5.3**.
- `checks[0].status` is `not-configured` → `NEXT_PUBLIC_CONVEX_URL` is not
  set on Vercel, or the running build was built without it. **§5.2**.

### 5.2 A configuration variable is missing — the 19 Nov 2026 case

`missingVariables` names the variables that are not set. For each one:

1. Vercel dashboard → **Settings → Environment Variables**.
2. Check the **scope**. A variable set for *Preview* but not *Production*
   is the single most common version of this failure.
3. Set the value (for `SMARTBUZ_JWT_PRIVATE_KEY`, see §4.1; for
   `SESSION_SECRET`, `openssl rand -base64 48`).
4. **Redeploy.** Editing a variable does not restart the running application,
   and for `NEXT_PUBLIC_*` it does not even change the built bundle. A
   redeploy is mandatory.

   ```bash
   # From the CLI, if the Vercel CLI is authenticated:
   vercel redeploy <deployment-url> --prod
   ```

   Or, without the CLI: Vercel dashboard → **Deployments** → the current
   deployment → **Redeploy** → *Production*.

   Or — and this is the one that needs nobody's authenticator — **push a
   commit**. The project is connected to GitHub, so a push builds a new
   deployment with the new variables in it. Vercel asks for a six-digit
   code from your authenticator before it will *redeploy* an existing
   build, but it does not ask before it *builds* a new one from a push.

   That is how the 22 Nov 2026 outage was closed: the variable was added
   in the dashboard and the next push carried it into a new deployment.

5. Re-check:

   ```bash
   curl -s https://smartbuz.vercel.app/api/health
   ```

The same problem on the **backend** side shows up differently: the health
check passes (the backend is reachable) but the browser still fails. Check it
with:

```bash
npx convex env list
```

`SMARTBUZ_SERVER_SECRET` and `RESEND_API_KEY` must match the Vercel values
exactly.

To confirm that the two sides agree without printing either value, hash them
and compare the first twelve characters:

```bash
# The Convex deployment
npx convex env get SMARTBUZ_SERVER_SECRET --deployment-name affable-panda-681 \
  | node -e "const c=require('crypto');let d='';process.stdin.on('data',x=>d+=x).on('end',()=>console.log(c.createHash('sha256').update(d.trim()).digest('hex').slice(0,12)))"

# The local .env.local
grep '^SMARTBUZ_SERVER_SECRET=' .env.local | cut -d= -f2- \
  | node -e "const c=require('crypto');let d='';process.stdin.on('data',x=>d+=x).on('end',()=>console.log(c.createHash('sha256').update(d.trim()).digest('hex').slice(0,12)))"
```

Two matching hashes mean the two sides agree. The values themselves are
never printed.

### 5.3 The Convex backend is not answering

```bash
curl -s -i --max-time 10 https://affable-panda-681.convex.cloud/version
curl -s -i --max-time 10 https://affable-panda-681.convex.site/auth/jwks
```

- Both time out → Convex Cloud is down or the deployment is wedged. Check
  <https://status.convex.dev>. There is nothing to fix in this repository.
- `/version` answers but `/auth/jwks` does not → the backend was deployed with
  a broken `convex/jwks.ts` or `convex/http.ts`. Roll the backend back
  (§3.2).
- Both answer, but the app still 503s → the failure is in the token route, not
  in connectivity. Continue at §5.4.

### 5.4 The health check passes but the token route fails

```bash
curl -s -i https://smartbuz.vercel.app/api/auth/convex-token
```

- `401` → no session cookie. That is correct behaviour, not a fault.
- `503` with a JSON body naming a missing configuration item → the
  configuration was changed after the last deploy, or the last deploy
  predates it. See §5.2.
- `500` → read the **Vercel → Logs → Runtime Logs** for the request. The
  error message names the missing variable when the cause is configuration
  (that behaviour was added in commit `953f958`).

### 5.5 If the answer is still not obvious

```bash
# 1. Which build is actually live?
curl -s https://smartbuz.vercel.app/api/health -D - -o /dev/null | grep -i etag

# 2. What did the last deploy do?
#    Vercel dashboard -> Deployments -> the live one -> build logs.

# 3. Is the backend at the commit you think it is?
npx convex deploy --dry-run   # prints what would be pushed
```

---

## 6. Environment variable inventory

**Names only. No value of any secret belongs in this document, in git, or in a
ticket.** The authoritative list is `.env.example`; the validator is
`scripts/validate-config.mjs`.

### 6.1 Web app — Vercel project settings, Production scope

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | yes | The Convex deployment the browser talks to. **Inlined at build time.** |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | yes | The deployment's site URL; the issuer of every access token. **Inlined at build time.** |
| `SMARTBUZ_JWT_PRIVATE_KEY` | yes | RSA private key (PKCS#8 DER, base64url) that signs access tokens. **The cause of the 19 Nov 2026 outage.** |
| `SESSION_SECRET` | yes (≥32 chars) | Signs the session cookie. Rotating it signs everyone out. |
| `SMARTBUZ_SERVER_SECRET` | yes (≥16 chars) | Shared secret with the Convex backend. Must be identical on both sides. |
| `RESEND_API_KEY` | for email | Transactional email provider. |
| `RESEND_FROM_EMAIL` | no | Sender address. Defaults to `noreply@smartbuz.app`. |
| `NEXT_PUBLIC_APP_VERSION` | no | Version stamped on offline devices. |

### 6.2 Backend — Convex deployment environment

| Variable | Required | Purpose |
|---|---|---|
| `SMARTBUZ_SERVER_SECRET` | yes | Must be **identical** to the Vercel value. |
| `RESEND_API_KEY` | only as a fallback | Used only when `SMARTBUZ_SERVER_SECRET` is unset. |
| `CONVEX_SITE_URL` | provided by the platform | The deployment's site URL; the JWKS issuer. Set it if you use a custom domain. |

### 6.3 In the repository

| Variable | Where | Purpose |
|---|---|---|
| `SMARTBUZ_JWT_PRIVATE_KEY` | `convex/authJwks.ts` holds the **public** half | Deployed with the backend; published at `<site>/auth/jwks`. |

---

## 7. Pipelines, and the drift between the two deployments

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

| Job | What it proves |
|---|---|
| `config` | Every required environment variable is present and correctly shaped, checked against placeholder values. This is the check that would have caught the 19 Nov 2026 outage. |
| `lint` | ESLint finds no problem that is not already in `scripts/lint-baseline.json`. The rules are unchanged; the gate fails on new problems only. |
| `audit` | The production dependency tree has no high or critical advisory. A registry outage is reported as inconclusive and does not fail the job. |
| `convex` | The Convex functions typecheck against the schema and the checked-in generated data model, and the generated code is complete. |
| `quality` | The app typechecks, the permission tests pass, and the production build succeeds. |

`.github/workflows/deploy-convex.yml` is a separate workflow that deploys the
backend on a push to `main`. It deploys **only if** `CONVEX_DEPLOY_KEY` and
`CONVEX_URL` are present as repository secrets; without them the deploy steps
are skipped and the workflow says so in its log. Until those secrets are
added, the backend must be deployed by hand (§2.2).

Note the order between the two workflows: they are independent, so a push to
`main` can deploy the backend while the web build is still being produced.
That is acceptable for an additive backend change (§2.2) but it is the reason
the release order matters.

Until that workflow is enabled, **the two deployments can drift**. The check
for drift is:

```bash
git log -1 --format=%H -- convex/     # the backend's last change
npx convex deploy --dry-run           # what the backend has right now
```

If the backend's last deployed commit is behind `main`, the web app and the
backend are running different code and nothing will say so.

---

## 8. Monitoring — what a human still has to set up

The repository now contains the pieces; the alerts themselves are configured
outside it, in a service.

| # | What | Where | Why |
|---|---|---|---|
| 1 | An uptime monitor on `https://smartbuz.vercel.app/api/health`, alerting on a non-200 | Any uptime service | This is the signal that would have caught the 19 Nov outage in under a minute. |
| 2 | An uptime monitor on `https://affable-panda-681.convex.cloud/version` | Same service | Separates "the web app is down" from "the backend is down" at 02:00. |
| 3 | An alert on `5xx` rate from the Vercel runtime logs | Vercel log drain or an error-reporting service | The 503s on `/api/auth/convex-token` were invisible until a customer reported them. |
| 4 | `node scripts/validate-config.mjs --prod` on a schedule, against the real environment | Wherever the environment variables live | Configuration drift is silent until it is not. |
| 5 | A weekly `npm audit --audit-level=high` | CI schedule | The dependency vulnerability status is unknown (see `docs/QA/16_BUILD_DEPLOYMENT_REPORT.md`, BUILD-03). |

Point 5 is why `npm audit` in CI is written to tolerate a registry outage: a
scan that fails because the registry is unreachable must not look like a
vulnerable build, and it must not look like a green build either.

---

## 9. First-time setup for a new operator

```bash
# Web app
npx vercel login
npx vercel link          # pick the SMARTBUZ project
npx vercel env ls        # see which variables exist in which scope

# Convex backend
npx convex login
npx convex dev           # once, locally, to confirm you can reach the deployment

# Configuration check
node scripts/validate-config.mjs --prod
```

Read `docs/QA/16_BUILD_DEPLOYMENT_REPORT.md` for the audit these procedures
come from, and `docs/QA/17_BUG_REGISTER.md` for the open defects.

---

## 10. Backing a business up, and putting it back

There was no way to take a business's data out of SMARTBUZ, and no way to
put it back. That made every other guarantee conditional: the ledger is
truthful *as long as nobody loses the database*.

### Taking one

In the app: **Settings → Business → Backup & Restore → Download a backup**.
The file is JSON and is downloaded to the browser's usual place.

From the server:

```bash
# The same route the button uses. The session cookie is what proves who
# you are, so this is not something a script can do on its own.
curl -H "Cookie: sb_session=..." \
  "http://localhost:3000/api/backup/export?businessId=<business id>"
```

The file contains the business's rows from every table listed in
`convex/backupTables.ts`, plus the business's own settings in the header.
It does **not** contain the accounts, the sessions or the licence: those
belong to the platform, and a restored database that could grant itself a
licence would be a hole rather than a backup.

### Putting one back

In the app: **Settings → Business → Backup & Restore → Restore from a
file**.

What a restore does, and what it does not:

- It **adds** the rows in the file to the business you are restoring into.
  It does not remove anything, and it does not overwrite a row that is
  already there.
- Every row gets a **new id** — Convex does not let a document keep an id
  it was given elsewhere — and every reference between the rows is
  rewritten to match, so a restored sale points at the restored customer
  and the restored payment at the restored loan.
- A row the current schema will not accept is **counted and skipped**,
  not allowed to stop the restore. The report says how many.
- The business in the file is **not** restored. The data goes into the
  business you chose, and the business's own settings are in the header
  for you to read.

### Checking that a backup is worth having

A backup nobody has restored is a belief, not a backup. Once in a while,
restore one into a scratch business and check that the catalogue, a sale
and its customer all come back and point at each other.

### The one-time repair

`scripts/strip-counter-copies.mjs` removes the legacy product copies from
the counters. It was needed once, on 21 Nov 2026, and it is safe to run
again — it reports what it found and does nothing when there is nothing
to do.

---

## 11. Barcodes

A barcode is stored in one form: upper case, with the spaces and the
punctuation taken out and the dashes kept. So `abc-123`, `ABC 123` and
`ABC-123` are the same barcode, and the scanner may report any of them.

The lookup reads the `by_businessId_barcode` index, which only matches
what is actually stored. A barcode written before the rule was in force is
still stored in the form it was typed in, so the index cannot find it and
the scan comes back empty.

### The one-time repair

`scripts/normalise-barcodes.mjs` rewrites those rows in the stored form.
It was needed once, on 22 Nov 2026, and it is safe to run again — it
reports what it found and does nothing when there is nothing to do.

```bash
node scripts/normalise-barcodes.mjs
```

It needs the server-to-backend secret and the new backend published. A
barcode that another product in the same business already holds is left
alone: that clash is a question for a person, not for a script.

### Recording a barcode

The product form takes a barcode. It is optional — a product without one
is still sold, it is just found by name. A barcode belongs to one product
in the business: if a second product takes one, the save is refused with
a message naming the product that already holds it.

### Scanning at the till

The till listens for a barcode the whole time it is open. Most scanners
are keyboards: they type the barcode very fast and press Enter, and the
till reads that as a scan. The product is then looked up **on that
counter** — the goods the cashier can sell — and put in the basket.

A barcode that belongs to no product on the counter is refused in words
rather than matched loosely, because a near match is a wrong item handed
to a customer.

---

## 12. What the operator downloads before signing in

The sign-in screen is the first thing the product does for a stranger, and
on a metered or congested connection it is the slowest and most
failure-prone moment there is. So the size of that screen is a number
worth keeping an eye on.

### Measuring it

```bash
# Against the live deployment.
node scripts/measure-bundle.mjs
node scripts/measure-bundle.mjs https://smartbuz.vercel.app /auth/login

# Against a local production build.
npm run build && npx next start -p 3111
node scripts/measure-bundle.mjs http://localhost:3111 /auth/login
```

The script lists the JavaScript chunks the server put in the page and adds
up the bytes that came over the wire, compressed — which is the number the
operator's connection pays for.

To find out *what* is in a chunk, download the chunks and ask:

```bash
node scripts/explain-bundle.mjs <directory-of-chunks>
```

It names the libraries it can find in each one. A number becomes a thing
that can be fixed.

### Keeping it small

The public routes must not be able to reach the Convex client. The client
is needed to read business data behind an open session, and the sign-in
screens read none, so the providers live on the authenticated routes only
and the public routes reach the backend through this server instead.

```bash
node scripts/check-public-bundle.mjs
```

The script walks the import graph of the public routes and fails if the
Convex client can be reached from any of them. It reads the source, so it
runs in a second and needs no build. Run it before a release that touches
anything a public route imports.

---

## 13. Reads that grow without end

A business's catalogue — its products, its customers, its branches — is
bounded by the size of the business. A ledger is not: every sale, every
payment, every shift and every audit row is one more row, forever.

So the reads worth watching are the ones that take a whole ledger when
they only need part of it.

### Measuring it

```bash
# Every ledger read that is not narrowed by a date, an id or a filter.
node scripts/check-ledger-reads.mjs

# Every read that is loaded whole in order to serve one page.
node scripts/check-bounded-reads.mjs
```

Both scripts read the source, so they run in a second and need no build.
The first prints a table-by-table list; the second prints the sites.

### The rules that were applied

- **A page is a page.** A query whose only job is to serve one page reads
  one page, from the narrowest index that carries the filters, and lets
  the server filter before it pages. Reading the tenant's whole history
  and throwing all but one page away meant the cost of a page of twenty
  rows grew with the tenant's entire history.
- **A period is a range.** A report for a period reads the period, from
  the date index. A purchase made after the period cannot have costed
  anything in it, so the cost history is read as far as the end of the
  period and no further.
- **A cursor is an offset.** The cursor is the position of the first row
  of the page. It used to be the page *number*, which the pagination hook
  does not send — so the second page asked for the first page again.

### The one-time repair

The audit trail rows written before the trail became a field of its own
carry no scope, and an index that keys on the scope will not find them.

```bash
node scripts/backfill-audit-scope.mjs
```

It is safe to run more than once. It needs the server-to-backend secret,
and it only runs after the new backend is published.
