# Architecture

## Runtime

The application is a single Cloudflare Worker. Next.js 16 (App Router) is
compiled by [vinext](https://vinext.dev), a Vite plugin that reimplements the
Next.js API surface for Workers — Cloudflare's current recommended path for new
Next.js applications. Deprecated Workers Sites is not used anywhere.

There is no separate API server, no Node process and no container. Bindings
(D1, R2, Assets) are injected by the Workers runtime and reached through
`src/server/cloudflare/env.ts`.

```
         ┌─────────────────────────────────────┐
Browser ─┤  Cloudflare Worker (dayarampur)     │
         │                                     │
         │  ├── React Server Components        │
         │  ├── Route handlers (/api/*)        │
         │  └── Server Actions (admin)         │
         └──────┬──────────────┬───────────────┘
                │              │
           D1 (SQLite)    R2 (photos)
                │
                └── outbound HTTPS ──► SSLCOMMERZ, Turnstile
```

## Layering

Dependencies point in one direction: `app → components → server → db`. Nothing
in `server/` imports from `app/` or `components/`.

| Layer | Location | Rule |
|---|---|---|
| Pages & routes | `src/app` | Composition and guards only; no SQL |
| Components | `src/components` | Presentation; no direct DB access |
| Domain | `src/domain` | Enums, categories, Zod schemas, public types. No I/O |
| Server services | `src/server/*` | All business logic and authorization |
| Data access | `src/server/db` | Parameterised D1 helpers |
| Pure helpers | `src/lib` | No I/O, no bindings — trivially testable |

### Why services take `D1Database` as a parameter

Every function in `src/server` that touches the database receives the
`D1Database` as its first argument rather than importing the binding. Two
consequences:

1. The test suite can pass a SQLite-backed implementation and exercise the
   **real** queries against the **real** migrations.
2. There is exactly one place — `getDb()` — where a request obtains a database
   handle, so it is obvious which code paths run inside a request.

## The privacy boundary

This is the load-bearing design decision of the whole application.

`properties` has four private columns:

```
exact_address    latitude    longitude    contact_phone
```

`src/server/properties/columns.ts` declares them and exports
`PUBLIC_PROPERTY_COLUMNS` / `PUBLIC_CARD_COLUMNS`, the explicit column lists
that every public query is built from. Private columns may be read only by:

| Module | Why |
|---|---|
| `server/properties/contact.ts` | The authorization chain itself |
| `server/properties/owner.ts` | An owner reading their own listing |
| `server/properties/mutations.ts` | Writing them at creation time |
| `server/admin/*` | Staff moderating a listing |

Three independent mechanisms keep this honest:

1. **Types.** `PublicProperty` has no `phone`, `exactAddress`, `latitude` or
   `longitude` field. Anything typed as `PublicProperty` cannot carry them.
2. **SQL.** Public queries never select the columns, so the values are not even
   loaded into memory on a public request.
3. **A test.** `tests/security/private-columns.test.ts` greps the public
   modules' source (comments stripped) and fails if a private column name
   appears.

The private payload reaches a browser through exactly one route:
`GET /api/properties/[id]/contact`, and only after the full authorization chain
in `decideUnlock()` passes.

## Request flow: a locked property page

```
1. GET /property/<slug>
2. getPublicPropertyBySlug()   → PublicProperty (no private fields)
3. hasActiveUnlock()           → boolean entitlement flag
4. HTML renders with <ContactLockCard hasUnlock={false}>
   ── nothing private is in the HTML, the RSC payload, the metadata or the JSON-LD
5. User pays → SSLCOMMERZ → IPN → settlePayment() → unlock ACTIVE
6. ContactLockCard fetches /api/properties/<id>/contact
7. Server re-verifies user + property + unlock + payment, then returns the data
```

Step 7 re-checks everything. Step 3's boolean is a UI hint, never an
authorization decision.

## Data access

`src/server/db/client.ts` wraps D1 with `queryOne`, `queryAll`, `execute` and
`batch`. Every value is bound; SQL is never built by string concatenation of
user input. Where a query needs a variable-length `IN (...)`, the placeholder
count comes from the array length and the values are still bound.

`batch()` is the strongest atomicity primitive available — D1 has no
interactive transactions over the binding API — so multi-statement invariants
("mark the payment PAID *and* activate the unlock") go through it.

## Authentication

- **Passwords**: PBKDF2-HMAC-SHA256 via WebCrypto, 150k iterations, per-password
  salt. The iteration count is stored in the hash string, so it can be raised
  later and old hashes are transparently upgraded at next login. WebCrypto is
  the only cryptographic primitive available natively in Workers; a WASM argon2
  build would cost far more bundle than it buys at this scale.
- **Sessions**: an opaque 32-byte token in an HttpOnly, SameSite=Lax cookie. The
  database stores only its SHA-256, so a database dump cannot be replayed as a
  set of live sessions.
- **Guards**: `requireUser` / `requireRole` / `requireAdmin` run in the
  `/dashboard` and `/admin` **layouts**, so every page underneath is protected
  by default. Each mutation re-checks independently.

## Extension points

| Concern | Interface | Today |
|---|---|---|
| Payments | `server/payments/provider.ts` | SSLCOMMERZ |
| Email | `server/email/provider.ts` | console / Resend |
| Maps | `server/maps/provider.ts` | MapLibre + OSM tiles |

Each is an interface with a factory, so a second implementation is an
environment change rather than a code change.
