# Database

Cloudflare D1 (SQLite). Migrations live in `migrations/` and are applied in
filename order.

## Conventions

| | |
|---|---|
| Primary keys | Opaque random `TEXT` (`prp_a1b2…`) — nothing is guessable or enumerable |
| Timestamps | ISO-8601 UTC `TEXT` (`2026-08-26T10:00:00Z`) — sorts correctly, and `substr(ts,1,10)` is the date |
| Booleans | `INTEGER` 0/1 |
| Money | `INTEGER` whole taka — no floating point anywhere near money |
| Status columns | `CHECK` constraints mirroring `src/domain/enums.ts` exactly |

Adding an enum value means adding a migration; the TypeScript union and the SQL
CHECK are kept in step deliberately.

## Tables

| Table | Purpose |
|---|---|
| `roles` | Reference: role names and their rank |
| `sequences` | Monotonic counters — allocates `properties.public_ref` |
| `users` | Accounts. At least one of phone/email is required |
| `sessions` | `id` is the SHA-256 of the cookie token |
| `verification_tokens` | Email/phone verification and password reset |
| `categories`, `locations`, `amenities` | Reference data |
| `properties` | Listings, including the four private columns |
| `property_images` | R2 object keys and metadata — never binary data |
| `property_amenities` | Join table |
| `favorites` | Unique on `(user_id, property_id)` |
| `property_views` | Unique on `(property_id, session_hash, view_date)` |
| `payments` | One row per transaction attempt |
| `contact_unlocks` | Entitlements, one per paid property per user |
| `reports` | User-submitted moderation reports |
| `notifications` | In-app notifications |
| `admin_logs` | Append-only audit trail |
| `settings` | SUPER_ADMIN-editable configuration (never secrets) |
| `rate_limits` | Fixed-window counters |

## The constraints that carry weight

### Duplicate unlock protection

```sql
CREATE UNIQUE INDEX contact_unlocks_active_uq
  ON contact_unlocks (user_id, property_id) WHERE status = 'ACTIVE';
```

A partial unique index. One user can hold at most one **active** unlock per
property, enforced by the database rather than by application logic. Because it
is partial, a `REVOKED` unlock (after a refund) does not block a later
re-purchase.

```sql
CREATE UNIQUE INDEX contact_unlocks_payment_uq
  ON contact_unlocks (payment_id) WHERE payment_id IS NOT NULL;
```

One unlock per payment — a replayed IPN cannot mint a second entitlement.

### Payment idempotency

`payments.transaction_id` and `payments.validation_id` are both `UNIQUE`. A
duplicate IPN carrying an already-recorded `val_id` trips the index, which the
settlement code catches and treats as "already settled".

### View de-duplication

```sql
CREATE UNIQUE INDEX property_views_unique_daily_uq
  ON property_views (property_id, session_hash, view_date);
```

`INSERT OR IGNORE` against this index is what stops a refresh loop inflating the
unique-view count an owner sees. Total views still count every visit.

`session_hash` is a salted hash of the session id, or of IP + user agent for
anonymous visitors. Raw IP addresses are never stored.

## Indexes

Composite indexes match the real access pattern — filter by status first, then
category or location, then sort:

```sql
CREATE INDEX properties_public_listing_idx
  ON properties (status, category_id, published_at DESC);
CREATE INDEX properties_public_location_idx
  ON properties (status, location_id, published_at DESC);
CREATE INDEX properties_price_idx  ON properties (status, price);
CREATE INDEX properties_owner_idx  ON properties (owner_id, created_at DESC);
```

## Public listing references

`properties.id` is random and opaque; `properties.public_ref` is a sequential
integer used in the slug (`…-1042`) and shown as `DP-1042`. Allocation is a
single atomic statement:

```sql
UPDATE sequences SET value = value + 1 WHERE name = 'property_ref' RETURNING value;
```

Two concurrent submissions therefore cannot receive the same reference.

## Property status

```
DRAFT ──► PENDING ──► APPROVED ──► PAUSED ──► APPROVED
                 │            ├──► RENTED / SOLD
                 │            └──► EXPIRED ──► (renew) APPROVED
                 └──► REJECTED
                                  ──► ARCHIVED (soft delete)
```

Only `APPROVED` is public. Listings are never deleted — archiving preserves
referential integrity for payments and audit records.

## Deletion policy

| Relationship | Behaviour |
|---|---|
| user → properties, sessions, favorites, unlocks | `ON DELETE CASCADE` |
| property → payments | `ON DELETE RESTRICT` — financial records survive |
| admin → admin_logs | `ON DELETE SET NULL` — the log entry survives the account |
