-- ============================================================================
-- One unsettled contact-unlock attempt per user and property
--
-- WHY THIS IS REQUIRED
--
-- `createUnlockPayment` inserted a fresh payment on every click, so a visitor
-- who pressed the pay button repeatedly accumulated one PENDING payment and
-- one PENDING contact_unlock per press. Production held six PENDING rows for a
-- single user and a single property.
--
-- The application now reuses an existing PENDING attempt, but a check followed
-- by an insert is not atomic: two concurrent requests can both read "none" and
-- both insert. Only a unique index actually prevents that, and it is the same
-- device `contact_unlocks_active_uq` already uses for the ACTIVE case.
--
-- SAFETY
--
-- The cleanup below touches ONLY rows that are already PENDING — money that
-- never settled. No PAID, FAILED, CANCELLED or REFUNDED payment is read or
-- written, no row is deleted, and no ACTIVE unlock is affected. Superseded
-- attempts become CANCELLED, which is an existing status, so the history of
-- what was attempted survives.
-- TIMESTAMPS
--
-- `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` rather than `datetime('now')`.
-- SQLite's datetime() renders "YYYY-MM-DD HH:MM:SS" — a space instead of the
-- 'T', and no trailing 'Z'. Every timestamp in this schema is ISO-8601 UTC and
-- these columns are compared as TEXT, so mixing the two formats sorts wrongly
-- within the same day, and Date.parse() reads the space form as LOCAL time.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Retire superseded attempts, keeping the earliest for each user+property.
--
-- The earliest is kept rather than the newest because it is the one whose
-- transaction id may already have been quoted to the payer.
-- --------------------------------------------------------------------------
UPDATE payments
   SET status = 'CANCELLED',
       failure_reason = 'superseded_duplicate_pending',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE status = 'PENDING'
   AND payment_type = 'PROPERTY_CONTACT_UNLOCK'
   -- Cancel a row exactly when a strictly-earlier sibling exists for the same
   -- user and property. Ordering is the (created_at, id) pair, so the outcome
   -- is deterministic even when two attempts share a timestamp to the second —
   -- which they can, since these are written by the same request path. The
   -- earlier MIN(created_at) + GROUP BY form still kept exactly one row, but
   -- WHICH one was unspecified — a bare column under GROUP BY. Checked against
   -- a three-way tie, it kept the last-inserted rather than the smallest id.
   AND EXISTS (
     SELECT 1
       FROM payments earlier
      WHERE earlier.status = 'PENDING'
        AND earlier.payment_type = 'PROPERTY_CONTACT_UNLOCK'
        AND earlier.user_id = payments.user_id
        -- `IS` not `=`: property_id is nullable, and NULL = NULL is NULL.
        AND earlier.property_id IS payments.property_id
        AND (
          earlier.created_at < payments.created_at
          OR (earlier.created_at = payments.created_at AND earlier.id < payments.id)
        )
   );

-- The unlock rows that belonged to those attempts go with them. REVOKED, not
-- deleted: an unlock row is the record that an attempt happened.
UPDATE contact_unlocks
   SET status = 'REVOKED',
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE status = 'PENDING'
   AND payment_id IN (
     SELECT id FROM payments
      WHERE status = 'CANCELLED'
        AND failure_reason = 'superseded_duplicate_pending'
   );

-- --------------------------------------------------------------------------
-- 2. Make a second concurrent attempt impossible.
--
-- Partial, so it constrains only unsettled contact-unlock attempts: a user may
-- still hold many PAID payments across different properties, and many
-- payments of other types.
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX payments_pending_unlock_uq
  ON payments (user_id, property_id)
  WHERE status = 'PENDING' AND payment_type = 'PROPERTY_CONTACT_UNLOCK';
