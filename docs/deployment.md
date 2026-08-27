# Deployment

Three environments, all defined in `wrangler.jsonc`: development (top-level),
`staging` and `production`. Each has its own D1 database and R2 bucket —
production data is never touched by local development.

All three set `workers_dev: true`, so every environment has a working
`*.workers.dev` address independently of any custom domain.

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
npm run cf:deploy:staging
# smoke-test staging, then:
npm run db:migrate:production
npm run cf:deploy:production
```

Migrations run **before** the deploy that needs them, and must be
backwards-compatible with the currently-deployed Worker for the window between
the two steps.

## Staging smoke test

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
4. **Build password reset and verification.** The `verification_tokens` table,
   the email provider abstraction and the Zod schemas exist; the routes and UI
   do not.
5. **Add a listing edit screen.** Creation, status changes and archiving work;
   editing an existing listing's fields does not.
6. **Generate thumbnails.** Full-size images are served with immutable cache
   headers, but no resized variants are produced. Cloudflare Images or a resize
   step on upload would cut mobile bandwidth substantially.
7. **Run a penetration test** against staging before launch.
