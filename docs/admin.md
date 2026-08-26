# Admin panel

A custom panel at `/admin` — no WordPress, no off-the-shelf CMS. Desktop-first
with a sidebar, responsive down to phones.

## Access

`requireAdmin()` runs in `src/app/admin/layout.tsx`, so every page underneath is
gated. Pages needing `SUPER_ADMIN` call `requireSuperAdmin()` themselves, and
every mutation re-checks independently — the sidebar hiding a link is
convenience, not access control.

| Section | Minimum role |
|---|---|
| Dashboard, properties, users, payments, unlocks, reports, logs | `ADMIN` |
| Settings, administrators, refunds | `SUPER_ADMIN` |

## Sections

### Dashboard

Eight cards (users, properties, active, pending, payments, revenue, unlocks,
today's revenue), four 30-day trend charts and a category distribution bar list.
Open reports surface as a banner.

### Pending approval

The moderation queue. Each card shows the photos, description, and — because
staff need them to judge whether a listing is genuine — the private fields:
exact address and contact number. That access is deliberate, scoped to the role,
and every approve/reject writes an `admin_logs` entry.

**Approve** publishes the listing, sets `published_at` and `expires_at`, and
notifies the owner.

**Reject** requires a written reason of at least ten characters. Presets are
offered so a busy moderator still leaves something actionable. The reason is
stored on the listing and delivered to the owner as a notification — they see it
on their dashboard.

### All properties

Searchable, filterable by status. Toggle **ফিচার্ড** (homepage promotion) and
**যাচাই** (verified). Verification asks for confirmation and says plainly that
it must reflect a real check with the owner — the badge is a promise to users,
not decoration.

### Users

Search by name, phone or email; filter by role. Shows listing and unlock counts.
Suspend/unsuspend (which kills the account's sessions immediately) and, for a
`SUPER_ADMIN`, change roles.

Rules the server enforces regardless of the UI:

- nobody can change their own role or status
- only a `SUPER_ADMIN` may grant or revoke `ADMIN` / `SUPER_ADMIN`
- an `ADMIN` may not suspend another `ADMIN`
- a role change destroys every session for that account

### Payments

Every transaction with its id, user, property, amount, gateway, status,
validation id and timestamps. Failure reasons are shown inline.

**Refunds** are `SUPER_ADMIN`-only. The form records a refund and revokes the
unlock — **it does not move money**. The operator issues the refund in the
SSLCOMMERZ merchant panel and pastes the gateway reference here. The UI says so
explicitly.

### Unlocks

Who unlocked which listing, for how much, and when.

### Reports

User-submitted reports with reason and details. Move through
`OPEN → INVESTIGATING → RESOLVED / DISMISSED`.

### Admin log

The audit trail, read-only. There is no delete or edit control anywhere — an
audit log staff can rewrite is not an audit log.

### Settings

`SUPER_ADMIN` only. Platform configuration: unlock price, listing duration, max
images, auto-approve, support contacts. A banner states that gateway
credentials, the session secret and the Turnstile secret are **not** stored here
— they are Worker secrets.

## Bootstrapping the first admin

There is no self-service path to staff privileges. Promote the first account
directly:

```bash
npx wrangler d1 execute dayarampur-production --remote \
  --command "UPDATE users SET role = 'SUPER_ADMIN' WHERE phone = '01XXXXXXXXX'"
```

That account then promotes everyone else through the UI.

## Dangerous actions

Destructive operations require confirmation through a modal, with the
consequence spelled out — for example, archiving a listing warns
**"এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।"**
