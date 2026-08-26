# Security

## Threat model

The valuable asset is the set of owner phone numbers and exact addresses. An
attacker wants them without paying; a scraper wants them in bulk. Everything
below follows from that.

## The contact authorization chain

`src/server/properties/contact.ts` — the only module that reads private columns
for a non-owner:

1. **Authenticate.** No session → refused, and the property is not even looked
   up (which would let an attacker probe for non-public listings).
2. **Existence.** The property must exist.
3. **Ownership.** An owner always sees their own listing.
4. **Staff.** `ADMIN`+ sees it for moderation; the access is logged.
5. **Visibility.** A non-owner may only reach an `APPROVED` listing.
6. **Entitlement.** An `ACTIVE` unlock for *this* user and *this* property,
   joined against a `PAID` payment.

The join against `payments` is deliberate redundancy: even if a bug or a manual
database edit flipped an unlock to `ACTIVE` without a settled payment, the
contact details stay locked. There is a test for exactly that.

## Anti-enumeration

A locked response for a non-existent property is **byte-identical** to a locked
response for one the user has not paid for:

```json
{ "locked": true, "priceBdt": 50, "reason": "PAYMENT_REQUIRED" }
```

The contact endpoint is additionally rate-limited per caller, so a stolen
session cannot sweep every listing id looking for one that happens to be
unlocked.

## What never reaches the browser

Before payment, the phone number and exact address are absent from:

- the HTML
- the RSC payload
- `generateMetadata()` output
- Open Graph and Twitter tags
- JSON-LD (`RealEstateListing` omits `telephone` and `streetAddress`)
- any public JSON response
- the sitemap

The blur on the locked panel is decoration. There is nothing behind it.

## Passwords and sessions

- PBKDF2-HMAC-SHA256, 150k iterations, per-password random salt, cost stored in
  the hash and transparently upgraded at next login.
- Failed login verifies against a dummy hash so a missing account and a wrong
  password take the same time and return the same message.
- Session cookies are HttpOnly, SameSite=Lax, Secure in production. The database
  stores only the SHA-256 of the token.
- Suspension takes effect on the account's next request, not when its cookie
  expires. A role change destroys every session for that account.

## CSRF

Two independent layers:

1. `SameSite=Lax` on the session cookie blocks cross-site form POSTs.
2. Every state-changing route handler calls `requireSameOrigin()`, which
   requires an `Origin` (or `Referer`) matching the site. A request with
   neither is rejected — browsers always send `Origin` on POST.

Admin mutations are Server Actions, which carry Next's own origin check.

The single deliberate exception is the SSLCOMMERZ IPN endpoint, which is a
machine-to-machine callback authenticated by signature plus outbound
validation.

## Authorization

| Rule | Enforced by |
|---|---|
| Owner-scoped reads/writes | `AND owner_id = ?` in every owner query — a guessed id returns nothing |
| Owner cannot self-approve | `setOwnerPropertyStatus` maps actions to a fixed status set that excludes `APPROVED` from `PENDING` |
| Owner cannot attach another's images | `createProperty` claims only rows with `uploaded_by = <caller> AND property_id IS NULL` |
| Nobody changes their own role | `changeUserRole` rejects `actor.id === targetUserId` |
| Only SUPER_ADMIN grants staff | `changeUserRole` refuses when either the old or new role is `ADMIN`+ and the actor is not `SUPER_ADMIN` |
| ADMIN cannot suspend an ADMIN | `setUserStatus` checks the target's role |

Guards live in the `/dashboard` and `/admin` **layouts**, so a new page under
them cannot forget to check. Every mutation re-checks independently — reaching
the admin UI is never taken as proof of authorization for an action.

## Input validation

Every route parses its body with a Zod schema. Unknown keys are stripped, so a
client cannot smuggle `role`, `status` or `amount` into a payload.

Deliberate negative-space design:

- `createPaymentSchema` has no amount field.
- `registerSchema` has no role field.
- `createPropertySchema` has no status field.

`flag()` is used instead of `z.coerce.boolean()`, which maps the string
`"false"` to `true` — exactly wrong for form payloads.

## SQL injection

All queries go through `db.prepare(...).bind(...)`. Dynamic `IN (...)` lists
generate their placeholders from the array length and still bind the values.
Search terms escape LIKE metacharacters, so a user typing `%` matches nothing
rather than everything. Sort order is looked up in a fixed map keyed by a Zod
enum, so only code-chosen SQL fragments are ever concatenated.

## File uploads

- The declared filename and Content-Type are ignored entirely.
- The real format is sniffed from magic bytes; only JPEG, PNG and WebP pass.
  SVG (which can carry script), HTML and PHP payloads are rejected.
- Object keys are fully server-generated (`properties/YYYY/MM/<userId>/<random>.<ext>`)
  — no part of the user's filename survives, which removes path traversal and
  key collisions outright.
- 5 MB per file, 15 files per listing, rate limited.
- The `/api/images` route pins reads to the `properties/` prefix and refuses
  `..`, so it cannot be used to read elsewhere in the bucket.

## Rate limiting

Fixed-window counters in D1. Login is limited **twice** — per IP (stops a spray
across many accounts) and per identifier (stops a slow brute force against one).
A successful login clears the identifier bucket so a user who mistyped is not
left locked out. Subjects are hashed before storage, so the table never holds a
raw IP or phone number.

## Secrets

Never in the database, never in `wrangler.jsonc`, never in client code. Set with
`wrangler secret put`. The settings screen says so explicitly. `.env`, `.env.*`
and `.dev.vars` are git-ignored.

## Headers

`securityHeaders()` sets CSP, `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY`, `Permissions-Policy` and HSTS. The CSP allows only what
the app actually loads from outside its origin: Turnstile, Google Fonts and OSM
tiles. `unsafe-inline` is permitted for styles only, never for scripts.

Responses carrying private data are `no-store, private`, keeping them out of
shared caches and the back-forward cache.

## Audit log

`admin_logs` is append-only — the application never updates or deletes a row,
and the admin UI has no control that would. Approvals, rejections, feature
flags, role changes, suspensions, refunds and setting changes are all recorded
with the acting admin, the entity, metadata and a salted IP hash.

## Test coverage

`npm run test` — 120 tests. The security-critical ones:

| Test | File |
|---|---|
| Unpaid user gets no phone number | `contact-unlock.test.ts` |
| Paid user does get it | `contact-unlock.test.ts` |
| One user's unlock does not work for another | `contact-unlock.test.ts` |
| Unlock for A does not unlock B | `contact-unlock.test.ts` |
| Anonymous caller refused before lookup | `contact-unlock.test.ts` |
| ACTIVE unlock + non-PAID payment stays locked | `contact-unlock.test.ts` |
| Missing and unpaid responses are identical | `contact-unlock.test.ts` |
| DB rejects a second ACTIVE unlock | `contact-unlock.test.ts` |
| Client price is ignored | `payments.test.ts` |
| No second charge for an owned unlock | `payments.test.ts` |
| Duplicate IPN creates nothing | `payments.test.ts` |
| Amount mismatch does not settle | `payments.test.ts` |
| Missing val_id does not settle | `payments.test.ts` |
| Nobody changes their own role | `auth.test.ts` |
| ADMIN cannot create an ADMIN | `auth.test.ts` |
| Role change kills sessions | `auth.test.ts` |
| Suspension takes effect immediately | `auth.test.ts` |
| CSRF blocks cross-origin and header-less POSTs | `auth.test.ts` |
| Rate limits apply and reset | `auth.test.ts` |
| Owner cannot touch another's listing | `properties.test.ts` |
| Owner cannot self-approve | `properties.test.ts` |
| Owner cannot attach another's images | `properties.test.ts` |
| Public projection has no private field | `properties.test.ts` |
| SQL injection and LIKE wildcards are inert | `properties.test.ts` |
| Non-image uploads rejected by magic bytes | `lib.test.ts` |
| Object key cannot escape its prefix | `lib.test.ts` |
| Public modules never name a private column | `private-columns.test.ts` |

## Known gaps

- The live SSLCOMMERZ handshake has not been exercised (see
  [`payments.md`](payments.md#what-has-not-been-exercised)).
- Password reset and account verification flows are not built; the token table
  and schemas exist.
- No penetration test has been performed against a deployed instance.
