# Deployment

Three environments, all defined in `wrangler.jsonc`: development (top-level),
`staging` and `production`. Each has its own D1 database and R2 bucket —
production data is never touched by local development.

All three set `workers_dev: true`, so every environment has a working
`*.workers.dev` address independently of any custom domain.

## How an environment is selected

**Read this before changing anything about deployment.**

### The trap

`vinext build` writes two things:

* `dist/server/wrangler.json` — the build's own Wrangler config, with the
  **top-level (development)** environment flattened into it and the `env` block
  **removed**.
* `.wrangler/deploy/config.json` — a Wrangler
  [redirected configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#redirected-configurations)
  pointing at that file.

When the redirect file exists, Wrangler **ignores `wrangler.jsonc` entirely**
and uses the generated config. That config defines no environments, so:

```
wrangler deploy --env production     # ← matches nothing, falls back to dev
```

It does not warn. It does not fail. It deploys the Worker bound to
`dayarampur-dev`, `dayarampur-property-images-dev`, `APP_ENV=development` and
`NEXT_PUBLIC_SITE_URL=http://localhost:3000` — which would break canonical URLs,
the sitemap, `robots.txt` and every payment callback, while looking like a
successful deploy. `--env staging` fails the same way.

### The fix

The deploy path never passes `--env`. Instead:

```
npm run build
node scripts/prepare-deploy-config.mjs production          # resolve
node scripts/prepare-deploy-config.mjs production --verify # re-check
wrangler deploy --config dist/server/wrangler.json         # deploy that file
```

`prepare-deploy-config.mjs` merges `env.production` from `wrangler.jsonc` (the
source of truth) into the generated config, deletes the `env` and
`definedEnvironments` keys so nothing is left for `--env` to select, stamps
`__preparedFor`, and then refuses to continue unless the result genuinely is
that environment.

`--verify` re-runs the assertions against the file on disk without rewriting it,
as a last gate immediately before the upload.

### What it refuses to deploy

| Check | Why |
|---|---|
| D1 binding is the dev database | The exact silent-fallback bug above |
| R2 binding is the dev bucket | Same |
| `APP_ENV` is `development` | Same |
| Name / database / bucket differ from `wrangler.jsonc` | Config drift |
| `database_id` is the `00000000-…` placeholder | Binds a database that does not exist |
| `DB`, `PROPERTY_IMAGES` or `assets` binding missing | The app cannot serve a page |
| `NEXT_PUBLIC_SITE_URL` is not `https://…` | Breaks canonicals, sitemap, payment callbacks |
| `CONTACT_UNLOCK_PRICE_BDT` unset | The unlock price must come from configuration |
| Production with `SSLCOMMERZ_IS_SANDBOX != "false"` | Real payments would go to the sandbox |
| Production missing the `dayarampur.com` route | The domain would not be attached |
| An `env` block survived into the resolved config | `--env` could still re-resolve |

`tests/security/deploy-config.test.ts` drives the script as a subprocess against
fixture configs and asserts each refusal, so the regression cannot return
silently.

### Which config each command uses

Every Wrangler command names its config explicitly. Without `--config`, a stale
`.wrangler/deploy/config.json` left by an earlier build silently changes what
the command resolves.

| Command | Config | Environment selected by |
|---|---|---|
| `npm run dev` | `wrangler.jsonc` (top level) | Vite plugin; always development |
| `npm run db:migrate` | `wrangler.jsonc` | Top level (development) |
| `npm run db:migrate:staging` | `wrangler.jsonc` | `--env staging` — safe, because `--config` defeats the redirect and migrations need no entry point |
| `npm run db:migrate:production` | `wrangler.jsonc` | `--env production` |
| `npm run cf:deploy:staging` | `dist/server/wrangler.json` | Already resolved by the prepare step — no `--env` |
| `npm run cf:deploy:production` | `dist/server/wrangler.json` | Same |
| `wrangler secret put` | — | `--name <worker>`, which bypasses config resolution entirely |

`wrangler deploy --config wrangler.jsonc` does **not** work: the source config's
`main` is `vinext/server/fetch-handler`, which only exists inside the build. The
redirect is why vinext generates its own config in the first place — the fix is
to make that generated config correct, not to bypass it.

## The short version

```bash
npx wrangler login
npm run cf:launch              # staging
npm run cf:launch:production   # production
```

`scripts/deploy.sh` does everything in "First-time setup" below — create the
database and bucket, write the real `database_id` into `wrangler.jsonc`, apply
migrations, check secrets, verify, build, deploy — and prints the live URL. It
is idempotent, so re-running it after fixing a missing secret just continues.

`cf:launch:production` requires `dayarampur.com` to already be a zone in the
account, because the production config declares custom-domain routes. Until it
is, use staging.

## First-time setup for an environment

The manual equivalent of the script above, if you would rather do it by hand.

### 1. Create resources

```bash
npx wrangler d1 create dayarampur-production
npx wrangler r2 bucket create dayarampur-property-images
```

Copy the printed `database_id` into the matching block in `wrangler.jsonc`,
replacing the `00000000-…` placeholder, then:

```bash
npm run cf:typegen
```

### 2. Set secrets

```bash
npx wrangler secret put SESSION_SECRET             --env production
npx wrangler secret put SSLCOMMERZ_STORE_ID        --env production
npx wrangler secret put SSLCOMMERZ_STORE_PASSWORD  --env production
npx wrangler secret put TURNSTILE_SECRET           --env production
```

Generate the session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Apply migrations

```bash
npm run db:migrate:production
```

### 4. Deploy

```bash
npm run cf:deploy:production
```

## Routine deploy

```bash
npm run verify                 # typecheck + lint + test — all must pass
npm run db:migrate:staging
npm run cf:deploy:staging      # build → resolve staging → verify → deploy
# smoke-test staging, then:
npm run db:migrate:production
npm run cf:deploy:production
```

Both `cf:deploy:*` scripts print the environment they resolved before uploading:

```
  Deploy configuration resolved for: PRODUCTION

    worker name   dayarampur
    D1 database   dayarampur-production  (…)
    R2 bucket     dayarampur-property-images
    APP_ENV       production
    site URL      https://dayarampur.com
```

Read that block. If it does not say what you expect, the deploy has not happened
yet — nothing is uploaded until after the check passes.

Migrations run **before** the deploy that needs them, and must be
backwards-compatible with the currently-deployed Worker for the window between
the two steps.

## Staging smoke test

- [ ] The deploy printed `Deploy configuration resolved for: STAGING` with the
      staging database and bucket — not the dev ones
- [ ] Homepage renders with listings
- [ ] A category page filters, sorts and paginates
- [ ] A property page shows the locked contact panel
- [ ] `view-source` on that page contains no phone number or exact address
- [ ] Register, log in, log out
- [ ] Post a listing with photos; it lands as PENDING
- [ ] Approve it in the admin panel; it appears publicly
- [ ] Reject one; the owner sees the reason
- [ ] Complete a sandbox payment; contact details unlock
- [ ] Revisit the same listing; it does not charge again
- [ ] `/robots.txt` and `/sitemap.xml` return the production host
- [ ] `/admin` and `/dashboard` redirect an anonymous visitor

## Custom domain

Add `dayarampur.com` as a Cloudflare zone and point its nameservers at
Cloudflare. The production `routes` block already declares `dayarampur.com` and
`www.dayarampur.com` as custom domains, so the deploy attaches them and
provisions certificates.

Set `NEXT_PUBLIC_SITE_URL` to `https://dayarampur.com` — it drives canonical
URLs, the sitemap, `robots.txt` and the payment callback URLs.

## Images in production

Development serves images through `/api/images/[...key]`, which streams from R2
via the Worker. For production, put a custom domain in front of the bucket
(R2 → Settings → Public access → Connect domain, e.g.
`images.dayarampur.com`) and set:

```
NEXT_PUBLIC_IMAGE_BASE_URL=https://images.dayarampur.com
```

Images are then served straight from the edge without invoking the Worker.
Object keys are random and immutable, so `max-age=31536000, immutable` is safe.

## Rollback

```bash
npx wrangler deployments list --env production
npx wrangler rollback <deployment-id> --env production
```

Code rolls back instantly. **Migrations do not** — a rollback across a schema
change requires a compensating migration, which is the reason for the
backwards-compatibility rule above.

## Monitoring

`observability.enabled` is on, so Workers Logs collects invocations and errors.
Watch for:

- `[ipn]` lines with `result=REJECTED` — verification failures
- `[unlock] duplicate active unlock` — a payment that needs a refund review
- `[audit] FAILED TO RECORD ADMIN ACTION` — audit-log writes failing
- `[sslcommerz]` gateway errors

## Outstanding work

Before this is genuinely production-ready:

1. **Run a real SSLCOMMERZ sandbox transaction.** The gateway handshake has
   never been exercised against the live service — the build environment blocks
   `sslcommerz.com`. The logic is covered by tests with a scripted provider, but
   the wire format has not been confirmed. Do this first.
2. **Perform the first Cloudflare deploy.** No account is attached to this
   repository, so the D1 ids in `wrangler.jsonc` are placeholders and no
   environment has been created.
3. **Wire a Cron Trigger for listing expiry.** `expireStaleProperties()` is
   implemented and tested but nothing calls it on a schedule. Add a
   `[triggers] crons` entry and a scheduled handler.
4. **Configure email delivery.** Password reset is built and sends through the
   provider abstraction, but `EMAIL_PROVIDER` defaults to `console` — links are
   written to Workers Logs, not delivered. Set `EMAIL_PROVIDER=resend` and the
   `RESEND_API_KEY` secret before launch, or nobody can recover an account.
   Email/phone *verification* is still unbuilt.
5. **Add a listing edit screen.** Creation, status changes and archiving work;
   editing an existing listing's fields does not.
6. **Generate thumbnails.** Full-size images are served with immutable cache
   headers, but no resized variants are produced. Cloudflare Images or a resize
   step on upload would cut mobile bandwidth substantially.
7. **Run a penetration test** against staging before launch.

## Scheduled jobs (cron triggers)

Some marketplace state changes on a timer rather than on a request: a listing
whose window closes, an advertisement campaign that starts or ends. These run
as Cloudflare cron triggers, so they happen with nobody on the site.

```
wrangler.jsonc  triggers.crons: ["0 * * * *"]   (hourly, every environment)
      ↓
src/worker.ts   export default { fetch, scheduled }
      ↓
src/server/jobs/run.ts        runScheduledJobs(db)
      ↓
src/server/jobs/registry.ts   expire-properties, advertising-schedule
```

**Why a custom Worker entry.** `main` used to be
`vinext/server/fetch-handler`, which exports only `fetch`. Cloudflare delivers
cron triggers to a separate `scheduled` export, so there was nothing to deliver
them to. `src/worker.ts` exports both and delegates every HTTP request straight
back to vinext, unchanged.

**Why crons are declared three times.** Once at the top level and once in each
of `env.staging` and `env.production`. `vinext build` flattens a single
environment into `dist/server/wrangler.json`; an environment block without its
own `triggers` would contribute none. `prepare-deploy-config.mjs` refuses to
deploy a resolved config with no crons — losing them is a silent failure that
looks exactly like a healthy site with nothing expiring.

**Safety properties.** Every job is a status-conditional `UPDATE ... WHERE`, so
a duplicate firing changes zero rows and two overlapping runs cannot both apply
the same transition. A job that throws is contained: the remaining jobs still
run, and the invocation is then re-thrown so it registers as failed in the
Cloudflare dashboard rather than looking healthy. Every run writes a `CRON_RUN`
row to `admin_logs` with `admin_id` NULL.

**Verifying locally.** `wrangler dev` normally exposes `/__scheduled`, but the
generated config sets `no_bundle: true`, which skips the middleware that serves
it. To exercise the handler against the real local D1:

```bash
npm run build
node -e "const f='dist/server/wrangler.json',j=require('./'+f);delete j.no_bundle;
  require('fs').writeFileSync('dist/server/wrangler.crontest.json',JSON.stringify(j))"
npx wrangler dev --config dist/server/wrangler.crontest.json \
  --test-scheduled --persist-to .wrangler/state
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

`--persist-to .wrangler/state` matters: a config living under `dist/server/`
otherwise gets its own empty D1 state directory beside it, and the jobs will
report "no such table". The same applies to `npm run preview`.
