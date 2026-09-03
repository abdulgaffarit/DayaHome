# dayarampur.com

**দয়ারামপুরের নিজের ঠিকানা** — a local property marketplace for Dayarampur,
Bagatipara, Natore.

Owners publish house rentals, sales, shops, offices, godowns, land, mess and
sublet listings for free. Visitors browse everything — photos, price, rooms,
area, amenities — without paying. The one thing behind a paywall is the
**owner's phone number and exact address**, unlocked per listing for **BDT 50**.

---

## Table of contents

- [Project overview](#project-overview)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Cloudflare setup](#cloudflare-setup)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Seed data](#seed-data)
- [Development](#development)
- [Testing](#testing)
- [Build](#build)
- [Deployment](#deployment)
- [Custom domain](#custom-domain)
- [SSLCOMMERZ setup](#sslcommerz-setup)
- [Admin setup](#admin-setup)
- [Backup and restore](#backup-and-restore)
- [Implementation status](#implementation-status)

---

## Project overview

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| **Runtime** | Cloudflare Workers via [vinext](https://vinext.dev) — Cloudflare's current recommended Next.js path |
| **Database** | Cloudflare D1 (SQLite) |
| **Object storage** | Cloudflare R2 (property photos) |
| **Payments** | SSLCOMMERZ (sandbox + live) |
| **Bot protection** | Cloudflare Turnstile |
| **Validation** | Zod, React Hook Form |
| **Tests** | Vitest against real SQLite via better-sqlite3 |
| **Language** | Bangla UI, English code |

### The unlock model

```
Public, free                      Locked behind BDT 50
────────────────────────          ────────────────────────
title, price, photos              owner's phone number
category, area name               exact street address
rooms, size, floor                map coordinates
amenities, rules, dates
listing id, posted date
```

A payment unlocks **one property for one user**, permanently. Returning to the
same listing never charges again.

---

## Architecture

```
src/
├── app/                     Next.js App Router
│   ├── (public pages)       /, /basha-vhara, /property/[slug], /search, …
│   ├── dashboard/           owner + user area (guarded in the layout)
│   ├── admin/               staff area (guarded in the layout)
│   └── api/                 route handlers
├── components/
│   ├── ui/                  design-system primitives
│   ├── site/                header, footer, mobile nav
│   ├── property/            cards, filters, gallery, contact lock
│   ├── post-ad/             listing wizard
│   ├── dashboard/           owner widgets
│   └── admin/               tables, moderation controls
├── domain/                  enums, categories, Zod schemas, public types
├── lib/                     pure helpers (Bangla formatting, slugs, ids, SEO)
└── server/
    ├── cloudflare/          binding + secret access
    ├── db/                  parameterised D1 query helpers
    ├── auth/                passwords, sessions, guards
    ├── security/            rate limiting, CSRF, Turnstile, headers
    ├── properties/          queries, mutations, contact resolver, favorites
    ├── payments/            provider interface, SSLCOMMERZ, unlock service
    ├── storage/             R2 image handling
    ├── admin/               moderation, users, dashboard, audit log
    ├── notifications/       in-app notifications
    ├── email/               provider abstraction
    └── maps/                provider abstraction
migrations/                  D1 SQL migrations
scripts/                     seed generators
tests/                       unit + security suites
docs/                        deep-dive documentation
```

**The privacy boundary.** `src/server/properties/columns.ts` splits the
`properties` table into public and private columns. Public queries are built
from an explicit public column list; the private columns are readable only by
`src/server/properties/contact.ts` (after authorization), the owner's own views,
and staff moderation screens. A test greps the public modules and fails the
build if a private column name appears in one.

See [`docs/architecture.md`](docs/architecture.md) for the full picture.

---

## Local setup

**Requirements:** Node.js 20+ and npm.

```bash
git clone https://github.com/abdulgaffarit/DayaHome.git
cd DayaHome
npm install

# Local secrets. `.dev.vars` is git-ignored.
cp .env.example .dev.vars

npm run db:migrate        # create the local D1 database
npm run db:seed           # 10 users, 20 listings, payments, reports
npm run db:seed:images    # generated placeholder photos in local R2

npm run dev               # http://localhost:3000
```

Every seeded account uses the password `dayarampur123`:

| Role | Phone |
|---|---|
| SUPER_ADMIN | `01700000001` |
| ADMIN | `01700000002` |
| OWNER | `01700000101` … `01700000105` |
| USER | `01700000201` … `01700000203` |

---

## Cloudflare setup

### 1. Authenticate

```bash
npx wrangler login
```

### 2. Create the D1 databases

```bash
npx wrangler d1 create dayarampur-dev
npx wrangler d1 create dayarampur-staging
npx wrangler d1 create dayarampur-production
```

Each command prints a `database_id`. Paste them into `wrangler.jsonc`, replacing
the `00000000-…` placeholders in the top-level `d1_databases` block and in each
`env.*` block.

### 3. Create the R2 buckets

```bash
npx wrangler r2 bucket create dayarampur-property-images-dev
npx wrangler r2 bucket create dayarampur-property-images-staging
npx wrangler r2 bucket create dayarampur-property-images
```

The buckets stay **private**. Images are served through
`/api/images/[...key]`, or — in production — through a custom domain placed in
front of the bucket (`NEXT_PUBLIC_IMAGE_BASE_URL`).

### 4. Regenerate binding types

```bash
npm run cf:typegen
```

Re-run this after any change to `wrangler.jsonc`.

---

## Environment variables

Copy [`.env.example`](.env.example) to `.dev.vars` for local work. In deployed
environments:

* **Plain vars** (`APP_ENV`, `NEXT_PUBLIC_SITE_URL`, `SSLCOMMERZ_IS_SANDBOX`,
  `CONTACT_UNLOCK_PRICE_BDT`) live in `wrangler.jsonc`.
* **Secrets** are set with Wrangler and never committed:

```bash
npx wrangler secret put SESSION_SECRET             --env production
npx wrangler secret put SSLCOMMERZ_STORE_ID        --env production
npx wrangler secret put SSLCOMMERZ_STORE_PASSWORD  --env production
npx wrangler secret put TURNSTILE_SECRET           --env production
npx wrangler secret put RESEND_API_KEY             --env production   # optional
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`.env`, `.env.*` and `.dev.vars` are all git-ignored.

---

## Database migrations

Migrations live in `migrations/` and are applied in filename order. They are
**append-only**: to change the schema, add a new numbered file. Never edit a
migration that has been applied to staging or production, and never edit a
deployed schema by hand.

```bash
npm run db:migrate               # local
npm run db:migrate:remote        # remote dev
npm run db:migrate:staging       # staging
npm run db:migrate:production    # production
```

| File | Contents |
|---|---|
| `0001_initial_schema.sql` | All tables, indexes, constraints |
| `0002_reference_data.sql` | Categories, locations, amenities, settings |

`0002` is reference data every environment needs, so it ships as a migration
rather than as seed data.

---

## Seed data

Development only. `scripts/seed.ts` emits SQL rather than talking to D1
directly, so the output can be reviewed before it touches a database.

```bash
npm run db:seed          # users, listings, favourites, views, payments, reports
npm run db:seed:images   # generates placeholder PNGs and uploads them to R2
```

All seeded phone numbers are fake (`01700000xxx`). Never run these against
production.

---

## Development

```bash
npm run dev          # vinext dev server on :3000, with real D1 and R2 bindings
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest
npm run verify       # all three
```

---

## Testing

```bash
npm run test
npm run test:watch
```

Tests run the **real** data layer against an in-memory SQLite database loaded
with the **real** migrations — real CHECK constraints, real foreign keys, real
partial unique indexes. The application's data functions take `D1Database` as a
parameter rather than importing the binding, which is what makes this possible.

Coverage includes the four security requirements from the specification:

- a user without a paid unlock never receives the phone number
- a paid user does receive it
- one user's unlock does not work for another user
- a tampered client price does not change the server's charge

plus duplicate-IPN idempotency, ownership/IDOR checks, role escalation,
CSRF, rate limiting, SQL-injection and malicious-upload handling. See
[`docs/security.md`](docs/security.md).

---

## Build

```bash
npm run build     # vinext build → dist/
npm run preview   # run the built Worker locally with Wrangler
```

---

## Deployment

### One command

```bash
npx wrangler login     # once — opens a browser
npm run cf:launch      # staging: provisions everything, then deploys
```

`scripts/deploy.sh` creates the D1 database and R2 bucket if they do not exist,
writes the real `database_id` into `wrangler.jsonc`, applies migrations, checks
that the required secrets are set, runs `npm run verify`, builds, and deploys.
Every step is a no-op when the resource already exists, so it is safe to re-run.

It prints the live `https://<worker>.<subdomain>.workers.dev` URL at the end.

For production (requires `dayarampur.com` to already be a zone in the account,
because of the custom-domain routes):

```bash
npm run cf:launch:production
```

### Plain redeploy

Once the resources exist and `wrangler.jsonc` has real ids:

```bash
npm run cf:deploy:staging
npm run cf:deploy:production
```

Each prints the environment it resolved — worker name, D1 database, R2 bucket,
`APP_ENV`, site URL — and refuses to upload if that is not genuinely the
environment you asked for. `--env` is deliberately never used; see
[how an environment is selected](docs/deployment.md#how-an-environment-is-selected)
for why it cannot be trusted with this toolchain.

Full runbook, rollback and monitoring: [`docs/deployment.md`](docs/deployment.md).

---

## Custom domain

`dayarampur.com` is registered through Cloudflare Registrar, so the zone and
nameservers are already in place — nothing to configure by hand.

The production config declares `dayarampur.com` and `www.dayarampur.com` as
custom domains, so `npm run cf:launch:production` attaches both and provisions
certificates. `www` then 308-redirects to the apex (see
`src/middleware.ts`), keeping one canonical URL.

`NEXT_PUBLIC_SITE_URL` is already `https://dayarampur.com` in the production
vars — it is the source of truth for canonical URLs, the sitemap, `robots.txt`
and the payment callback URLs.

---

## SSLCOMMERZ setup

### Sandbox

1. Register at <https://developer.sslcommerz.com/> for a sandbox store.
2. Set `SSLCOMMERZ_IS_SANDBOX` to `"true"` (already the default for development
   and staging).
3. Set the store id and password as secrets.
4. Set the IPN URL in the merchant panel to
   `https://<your-host>/api/payments/sslcommerz/ipn`.

### Production

1. Complete SSLCOMMERZ merchant onboarding and obtain live credentials.
2. Set `SSLCOMMERZ_IS_SANDBOX` to `"false"` in the production `vars`.
3. Set the live store id and password as production secrets.
4. Register the production IPN URL in the merchant panel.

A payment is only ever settled after a server-to-server call to the Order
Validation API confirms the transaction id, amount and currency. Reaching the
success URL proves nothing on its own. See [`docs/payments.md`](docs/payments.md).

---

## Admin setup

The first administrator is promoted directly in the database — there is no
self-service path to staff privileges:

```bash
npx wrangler d1 execute dayarampur-production --remote \
  --command "UPDATE users SET role = 'SUPER_ADMIN' WHERE phone = '01XXXXXXXXX'"
```

After that, promote further staff from **Admin → ব্যবহারকারী**. Rules enforced
server-side:

- nobody can change their own role
- only a `SUPER_ADMIN` can grant or revoke `ADMIN` / `SUPER_ADMIN`
- an `ADMIN` cannot suspend another `ADMIN`
- every role change and suspension is written to `admin_logs`

---

## Backup and restore

```bash
# Backup (run on a schedule; keep the dumps somewhere private —
# they contain user phone numbers and listing addresses)
npx wrangler d1 export dayarampur-production --remote --output backup-$(date +%F).sql

# Restore into a fresh database
npx wrangler d1 execute <target-db> --remote --file backup-2026-08-26.sql
```

D1 also keeps automatic point-in-time backups; see the Cloudflare dashboard for
the retention window on your plan. R2 objects are immutable and never
overwritten, so the bucket only needs periodic replication rather than
versioned backups.

**Never commit a database dump.** `.gitignore` blocks `*.sql` dumps under
`.seed*`, but a manual export must be kept out of the repository.

---

## Implementation status

Working end to end:

- [x] Homepage, category pages, search, filters, sort, pagination
- [x] Property detail page with gallery and structured data
- [x] Registration, login, logout, sessions, roles
- [x] Multi-step listing wizard with R2 image upload
- [x] Owner dashboard (listings, stats, status changes, payments, profile)
- [x] Admin panel (dashboard, moderation, users, payments, unlocks, reports, logs, settings)
- [x] Approval / rejection with a mandatory reason surfaced to the owner
- [x] Favourites, reports, view counting
- [x] Contact unlock: creation, verification, idempotent settlement, authorization
- [x] Duplicate-payment and duplicate-unlock protection
- [x] SEO: metadata, canonicals, Open Graph, JSON-LD, sitemap, robots
- [x] Responsive, Bangla-first, accessible UI
- [x] Security test suite (120 tests)
- [x] Production build

Not yet done — see [`docs/deployment.md`](docs/deployment.md#outstanding-work):

- [ ] **Live SSLCOMMERZ handshake has not been exercised.** The payment code is
      covered by tests with a scripted provider, but no real sandbox transaction
      has been run end to end. Do this before taking real money.
- [ ] **Cloudflare deployment has not been performed.** No account is attached,
      so the D1 ids in `wrangler.jsonc` are placeholders.
- [ ] Password reset and email/phone verification flows (the token table,
      email provider abstraction and schemas exist; the UI does not).
- [ ] Listing edit screen (creation, status changes and archiving work;
      editing an existing listing's fields does not).
- [ ] Image thumbnail generation (full-size images are served with immutable
      cache headers; no resized variants are produced).
- [ ] Scheduled expiry job (`expireStaleProperties()` is implemented and tested
      but is not yet wired to a Cron Trigger).
