-- ============================================================================
-- UddoktaPay becomes the automated gateway
--
-- WHAT THIS DOES
--
--   * registers UDDOKTAPAY in payment_gateways;
--   * makes it the primary gateway;
--   * keeps MANUAL as the fallback, so a payer is never left without a route
--     to pay if the API is unreachable;
--   * disables SSLCOMMERZ, which is being replaced. The row is KEPT, not
--     deleted: existing payments carry `gateway = 'SSLCOMMERZ'` and must still
--     resolve their adapter for verification, refunds and the admin screens.
--
-- NO SCHEMA CHANGE. `payment_gateways.id` and `payments.gateway` are plain TEXT
-- with no CHECK constraint, so a new gateway is data, not DDL. Existing payment
-- rows are not read or written by this migration.
--
-- SECRETS. Enabling a gateway here cannot make it usable on its own: the
-- registry treats a gateway as usable only when the row is enabled AND the
-- adapter reports its credentials present. UddoktaPay stays unusable until
-- `wrangler secret put UDDOKTAPAY_API_KEY` has been run for the environment,
-- at which point payments route to it with no further change.
-- ============================================================================

INSERT INTO payment_gateways
  (id, display_name, label_bn, is_enabled, is_primary, is_fallback, sort_order,
   settings_json, notes, updated_at)
VALUES
  ('UDDOKTAPAY', 'UddoktaPay', 'উদ্যোক্তাপে', 1, 0, 0, 0, '{}',
   'Hosted checkout via UddoktaPay. Requires the UDDOKTAPAY_API_KEY Worker binding.',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- --------------------------------------------------------------------------
-- Primary and fallback are each guarded by a partial unique index
-- (payment_gateways_primary_uq / _fallback_uq), so the existing holder must be
-- cleared before the new one is set. Statements run in order within the
-- migration, so no intermediate state is ever visible to a reader.
-- --------------------------------------------------------------------------
UPDATE payment_gateways
   SET is_primary = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE is_primary = 1;

UPDATE payment_gateways
   SET is_primary = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE id = 'UDDOKTAPAY';

-- MANUAL stays available so an operator can still take money out of band.
UPDATE payment_gateways
   SET is_fallback = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE is_fallback = 1 AND id <> 'MANUAL';

UPDATE payment_gateways
   SET is_enabled = 1,
       is_fallback = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE id = 'MANUAL';

-- SSLCOMMERZ is switched off. Disabled, never deleted: the adapter must stay
-- reachable for payments that were taken through it.
UPDATE payment_gateways
   SET is_enabled = 0,
       is_primary = 0,
       is_fallback = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE id = 'SSLCOMMERZ';
