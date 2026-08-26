# Payments and contact unlock

BDT 50 unlocks the owner's phone number and exact address for **one property**,
for **one user**, permanently.

## The rule

```
gateway response
    + IPN
    + server-side transaction validation
    + expected amount validation
    + transaction uniqueness
    ────────────────────────────────
    = PAID  →  CONTACT_UNLOCK = ACTIVE
```

Reaching the success URL is **never** sufficient. Neither is a well-formed IPN
on its own.

## Flow

```
1. User clicks "৳৫০ দিয়ে যোগাযোগের তথ্য দেখুন"
2. POST /api/payments/create  { propertyId }        ← no amount field exists
3. Server:
     · loads the property, checks it is APPROVED
     · refuses if the user is the owner
     · refuses if an ACTIVE unlock already exists   ← no second charge
     · reads the price from configuration
     · creates payments(PENDING) + contact_unlocks(PENDING) in one batch
     · asks SSLCOMMERZ for a session
4. Browser redirects to the gateway
5a. SSLCOMMERZ → POST /api/payments/sslcommerz/ipn      (server to server)
5b. Browser    → GET/POST /api/payments/sslcommerz/return
6. Both call settlePayment(); whichever arrives first wins, the other no-ops
7. settlePayment():
     · loads the payment by transaction id
     · returns ALREADY_SETTLED if it is already PAID
     · calls the Order Validation API
     · requires status VALID/VALIDATED, matching tran_id, currency,
       and |amount − expected| < 1
     · UPDATE payments SET status='PAID' WHERE id=? AND status='PENDING'
     · only if that changed exactly one row: activate the unlock,
       bump the counter, notify the user
```

## Why the price cannot be manipulated

`createPaymentSchema` is:

```ts
export const createPaymentSchema = z.object({
  propertyId: z.string().min(1).max(64),
});
```

There is no `amount`, no `price`, no `currency`. Zod strips unknown keys, so a
client that posts `{ propertyId, amount: 1 }` has the `amount` discarded before
the handler runs. The route passes `contactUnlockPriceBdt()` — read from
Worker configuration — into the service.

Verified end to end: posting `{"propertyId":"…","amount":1,"currency":"USD"}`
records `amount = 50, currency = BDT` in the database.

At settlement, the expected amount comes from **our** `payments` row, not from
the callback, so a gateway response describing a different (cheaper) order
cannot settle this one.

## Idempotency

The state transition is a conditional update:

```sql
UPDATE payments SET status = 'PAID', … WHERE id = ? AND status = 'PENDING'
```

Only the first caller sees `changes === 1`. Everyone else — a retried IPN, the
browser return leg racing the IPN, an operator replaying a webhook — gets
`ALREADY_SETTLED` and changes nothing. `payments.validation_id` is additionally
`UNIQUE`, so a duplicate `val_id` trips the index and is likewise treated as a
replay.

The unlock counter is incremented inside that same guarded path, so three
identical IPNs still produce exactly one unlock and one increment.

## SSLCOMMERZ specifics

| | Sandbox | Live |
|---|---|---|
| Session | `https://sandbox.sslcommerz.com/gwprocess/v4/api.php` | `https://securepay.sslcommerz.com/gwprocess/v4/api.php` |
| Validation | `https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php` | `https://securepay.sslcommerz.com/validator/api/validationserverAPI.php` |

`SSLCOMMERZ_IS_SANDBOX` selects between them. Anything other than the exact
string `"false"` keeps us in the sandbox — the safe default if the variable is
missing or malformed.

### Transaction ids

`U<publicRef>-<random>`, capped at the gateway's 30-character limit. Example:
`U1042-a1b2c3d4e5f6`.

### IPN signature

SSLCOMMERZ signs the IPN with `verify_sign` / `verify_key`: take the parameters
named in `verify_key`, add `store_passwd = md5(store password)`, sort by key,
join as `k=v&k=v`, MD5 the result.

MD5 is unavailable in WebCrypto, so `src/server/payments/md5.ts` implements it —
verified against the RFC 1321 test vectors. It is used for **nothing else**;
passwords use PBKDF2 and sessions use SHA-256.

A failed signature is logged loudly but is not by itself decisive: the Order
Validation call is the authority, and it runs regardless.

### The IPN endpoint and CSRF

`/api/payments/sslcommerz/ipn` is called by SSLCOMMERZ's servers, not by a
browser, so the same-origin check that guards every other mutation deliberately
does not apply. Its authenticity comes from the signature plus the outbound
validation call. It always answers `200` — a non-2xx would make the gateway
retry a payload we have already decided about.

## Refunds

`recordRefund()` marks our ledger and revokes the unlock. **It does not move
money.** SSLCOMMERZ refunds are issued from the merchant panel; an operator
completes the refund there and pastes the gateway's reference into the admin
form so the two records can be reconciled. The UI says so explicitly rather than
implying a refund was sent.

Refunds are `SUPER_ADMIN`-only and are written to `admin_logs`.

## What has not been exercised

The live SSLCOMMERZ handshake has **not** been run end to end — the build
environment's egress proxy blocks `sslcommerz.com`. The payment logic is fully
covered by tests using a scripted provider (price manipulation, duplicate IPN,
amount mismatch, missing validation id, failed and pending gateway states), but
before taking real money you must:

1. Run a sandbox transaction end to end and confirm the IPN arrives.
2. Confirm the Order Validation response shape matches
   `ValidationApiResponse` in `src/server/payments/sslcommerz.ts`.
3. Confirm `verifySignature()` returns `true` for a genuine sandbox IPN.
