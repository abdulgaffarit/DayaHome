# CLAUDE.md

Guidance for working in this repository.

## What this is

dayarampur.com — a Bangla property marketplace for Dayarampur, Bagatipara,
Natore. Next.js 16 on Cloudflare Workers via vinext, with D1 and R2.

Read [`README.md`](README.md) first, then [`docs/architecture.md`](docs/architecture.md).

## Commands

```bash
npm run dev          # dev server on :3000 with real D1/R2 bindings
npm run verify       # typecheck + lint + test — run before every commit
npm run db:migrate   # apply migrations to local D1
npm run db:seed      # development seed data
npm run build        # production build
```

## The rule that matters most

`properties` has four private columns:

```
exact_address    latitude    longitude    contact_phone
```

They may be read **only** by:

- `src/server/properties/contact.ts` — the authorization chain
- `src/server/properties/owner.ts` — an owner's own listing
- `src/server/properties/mutations.ts` — writing them at creation
- `src/server/admin/*` — staff moderation

Everything else builds its SELECT from `PUBLIC_PROPERTY_COLUMNS` or
`PUBLIC_CARD_COLUMNS` in `src/server/properties/columns.ts`.

`tests/security/private-columns.test.ts` greps the public modules and fails the
build if a private column name appears in one. If that test fails, the fix is
almost never to edit the test.

## Conventions

- **UI is Bangla, code is English.** User-visible strings, error messages and
  comments-for-users are Bangla; identifiers, table names and code comments are
  English.
- **Numbers shown to users go through `toBanglaDigits` / `formatPrice`.** Values
  sent to the server stay in ASCII digits.
- **Services take `D1Database` as a parameter**, never import the binding. That
  is what lets the test suite run real queries against real migrations.
- **Every query is parameterised.** Never concatenate user input into SQL.
- **Money is `INTEGER` whole taka.** No floats near money.
- **Timestamps are ISO-8601 UTC strings**, so `substr(ts, 1, 10)` is the date.
- **Migrations are append-only.** Add a new numbered file; never edit an applied
  one.
- **Enums live in `src/domain/enums.ts`** and are mirrored by SQL CHECK
  constraints. Adding a value means adding a migration.

## Security invariants — do not weaken these

1. The unlock price comes from `contactUnlockPriceBdt()`. `createPaymentSchema`
   has no amount field, deliberately.
2. A payment settles only after `provider.verifyTransaction()` returns
   `verified: true`. The success URL proves nothing.
3. Settlement is `UPDATE ... WHERE status = 'PENDING'` so replays are no-ops.
4. Owner queries always carry `AND owner_id = ?`.
5. Nobody can change their own role.
6. State-changing routes call `requireSameOrigin()`. The SSLCOMMERZ IPN is the
   one deliberate exception, documented in place.
7. Uploads are validated by magic bytes; object keys are server-generated.

## Deployment: never pass `--env`

`vinext build` writes `.wrangler/deploy/config.json`, a Wrangler redirected
configuration. Wrangler then ignores `wrangler.jsonc` and uses
`dist/server/wrangler.json`, which vinext flattens from the **development**
environment with the `env` block dropped. So `wrangler deploy --env production`
silently resolves the dev D1 database, dev R2 bucket and a localhost site URL,
and reports success.

Deploys therefore go through `scripts/prepare-deploy-config.mjs <env>`, which
merges the env block into the generated config and refuses to continue unless
the result really is that environment. Deploy the resolved file with no `--env`.

Every Wrangler command in `package.json` names its `--config` explicitly for the
same reason. See [`docs/deployment.md`](docs/deployment.md#how-an-environment-is-selected).

## Adding things

**A new page under `/dashboard` or `/admin`** — the layout already guards it;
add a `metadata` export with `robots: NOINDEX`.

**A new API route** — start with `guarded()`, then `requireSameOrigin()` for
mutations, then `buildContext()`, then `requireAuth()`, then rate limiting, then
Zod. Copy the shape of an existing route.

**A new admin mutation** — a Server Action in `src/server/admin/actions.ts` that
re-runs `requireAdmin()` / `requireSuperAdmin()` and writes to `admin_logs`.

**A new category** — add it to `src/domain/categories.ts`, add a row in a new
migration, and create `src/app/<slug>/page.tsx` from the existing template.

**A new scheduled job** — add an entry to `SCHEDULED_JOBS` in
`src/server/jobs/registry.ts`. It must be a status-conditional
`UPDATE ... WHERE`, so that a repeat firing changes nothing: cron delivery is
at-least-once and two runs can overlap. Never delete rows from a job. The
Worker's `scheduled` handler in `src/worker.ts` picks it up automatically.

## Scheduled execution

`src/worker.ts` is the Worker entry, not `vinext/server/fetch-handler` — that
one exports only `fetch`, and Cloudflare delivers cron triggers to a separate
`scheduled` export. HTTP is delegated straight back to vinext.

`triggers.crons` is declared at the top level of `wrangler.jsonc` **and** in each
environment block, because `vinext build` flattens one environment into the
generated config. `prepare-deploy-config.mjs` fails the deploy if the resolved
config has no crons: a deploy that loses them serves every request perfectly
while expired listings stay up and paid campaigns never start.

## Known gaps

See [README → Implementation status](README.md#implementation-status). The two
that matter: the live SSLCOMMERZ handshake has never been exercised, and the app
has never been deployed to Cloudflare.
