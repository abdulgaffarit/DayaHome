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
       updated_at = '2026-01-01T00:00:00Z'
 WHERE status = 'PENDING'
   AND payment_type = 'PROPERTY_CONTACT_UNLOCK'
   AND id NOT IN (
     SELECT min_id FROM (
       SELECT id AS min_id
         FROM payments p
        WHERE p.status = 'PENDING'
          AND p.payment_type = 'PROPERTY_CONTACT_UNLOCK'
          AND p.created_at = (
            SELECT min(q.created_at)
              FROM payments q
             WHERE q.user_id = p.user_id
               AND q.property_id IS p.property_id
               AND q.status = 'PENDING'
               AND q.payment_type = 'PROPERTY_CONTACT_UNLOCK'
          )
        GROUP BY p.user_id, p.property_id
     )
   );

-- The unlock rows that belonged to those attempts go with them. REVOKED, not
-- deleted: an unlock row is the record that an attempt happened.
UPDATE contact_unlocks
   SET status = 'REVOKED',
       updated_at = '2026-01-01T00:00:00Z'
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
