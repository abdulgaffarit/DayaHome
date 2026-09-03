-- ============================================================================
-- Payment abstraction
--
-- Generalises the payment layer away from SSLCOMMERZ:
--   * payments gain payment_type and an optional advertisement link, so one
--     ledger serves contact unlocks, featured/boost listings, advertising and
--     subscriptions.
--   * payment_gateways records which adapters exist, whether they are enabled,
--     and which is primary/fallback.
--
-- SECRETS ARE NEVER STORED HERE. Store ids, API keys and passwords live in
-- Cloudflare Worker secrets (`wrangler secret put`). These tables hold only
-- non-secret operational configuration.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Reference: payment types
--
-- A lookup table rather than a CHECK constraint: SQLite cannot add a CHECK to
-- an existing table, but a REFERENCES gives the same integrity guarantee and
-- matches how `roles` already works.
-- --------------------------------------------------------------------------
CREATE TABLE payment_types (
  name        TEXT PRIMARY KEY,
  label_bn    TEXT NOT NULL,
  -- Which entity the payment is about, for reporting and the admin UI.
  subject     TEXT NOT NULL CHECK (subject IN ('PROPERTY', 'ADVERTISEMENT', 'ACCOUNT')),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO payment_types (name, label_bn, subject, sort_order) VALUES
  ('PROPERTY_CONTACT_UNLOCK', 'যোগাযোগের তথ্য আনলক',  'PROPERTY',      1),
  ('FEATURED_PROPERTY',       'ফিচার্ড বিজ্ঞাপন',      'PROPERTY',      2),
  ('PROPERTY_BOOST',          'বিজ্ঞাপন বুস্ট',         'PROPERTY',      3),
  ('ADVERTISEMENT',           'বিজ্ঞাপন ক্যাম্পেইন',    'ADVERTISEMENT', 4),
  ('ADVERTISEMENT_RENEWAL',   'ক্যাম্পেইন নবায়ন',      'ADVERTISEMENT', 5),
  ('SUBSCRIPTION',            'সাবস্ক্রিপশন',           'ACCOUNT',       6);

-- --------------------------------------------------------------------------
-- Rebuild `payments`
--
-- `property_id` was NOT NULL because every payment used to be a contact
-- unlock. Advertising payments have no property, so it must become nullable —
-- which in SQLite means rebuilding the table.
--
-- `contact_unlocks.payment_id` references `payments` with ON DELETE SET NULL,
-- and DROP TABLE performs an implicit DELETE that FIRES that action. Dropping
-- the old table therefore silently nulls the payment link on every unlock —
-- which would make hasActiveUnlock() fail for every customer who has already
-- paid, revoking access they bought. Verified against seeded data: 4 linked
-- unlocks became 0.
--
-- So the mapping is stashed before the drop and restored after the rename.
-- `defer_foreign_keys` holds enforcement until COMMIT, which then re-validates
-- that every restored payment_id resolves.
-- --------------------------------------------------------------------------
PRAGMA defer_foreign_keys = TRUE;

-- Survives the DROP so the unlock -> payment links can be put back.
CREATE TABLE _unlock_payment_backup (
  unlock_id  TEXT PRIMARY KEY,
  payment_id TEXT
);
INSERT INTO _unlock_payment_backup (unlock_id, payment_id)
SELECT id, payment_id FROM contact_unlocks WHERE payment_id IS NOT NULL;

CREATE TABLE payments_new (
  id               TEXT PRIMARY KEY,
  transaction_id   TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Now nullable: an advertising or subscription payment has no property.
  property_id      TEXT REFERENCES properties(id) ON DELETE RESTRICT,
  -- Links an advertising payment to its campaign. No FK: the advertising
  -- tables arrive in a later migration. Enforced in src/server/payments/.
  advertisement_id TEXT,
  payment_type     TEXT NOT NULL DEFAULT 'PROPERTY_CONTACT_UNLOCK'
                     REFERENCES payment_types(name) ON UPDATE CASCADE,
  -- What the payment bought, in words, for the admin transaction list.
  description      TEXT,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  currency         TEXT NOT NULL DEFAULT 'BDT',
  gateway          TEXT NOT NULL DEFAULT 'SSLCOMMERZ',
  status           TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED')),
  validation_id    TEXT UNIQUE,
  bank_tran_id     TEXT,
  card_type        TEXT,
  risk_level       TEXT,
  gateway_status   TEXT,
  failure_reason   TEXT,
  refunded_at      TEXT,
  refund_ref       TEXT,
  raw_payload      TEXT,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  updated_at       TEXT NOT NULL,
  -- A payment is about at most one subject.
  CHECK (property_id IS NULL OR advertisement_id IS NULL)
);

-- Every existing row is a contact unlock, so the constants backfill correctly.
INSERT INTO payments_new (
  id, transaction_id, user_id, property_id, advertisement_id, payment_type,
  description, amount, currency, gateway, status, validation_id, bank_tran_id,
  card_type, risk_level, gateway_status, failure_reason, refunded_at,
  refund_ref, raw_payload, created_at, paid_at, updated_at
)
SELECT
  id, transaction_id, user_id, property_id, NULL, 'PROPERTY_CONTACT_UNLOCK',
  NULL, amount, currency, gateway, status, validation_id, bank_tran_id,
  card_type, risk_level, gateway_status, failure_reason, refunded_at,
  refund_ref, raw_payload, created_at, paid_at, updated_at
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

-- Put back the links the implicit DELETE nulled out.
UPDATE contact_unlocks
   SET payment_id = (
     SELECT b.payment_id FROM _unlock_payment_backup b WHERE b.unlock_id = contact_unlocks.id
   )
 WHERE payment_id IS NULL
   AND id IN (SELECT unlock_id FROM _unlock_payment_backup);

DROP TABLE _unlock_payment_backup;

-- Recreate every index the original table had, plus the new ones.
CREATE INDEX payments_user_idx     ON payments (user_id, created_at DESC);
CREATE INDEX payments_property_idx ON payments (property_id);
CREATE INDEX payments_status_idx   ON payments (status, created_at DESC);
CREATE INDEX payments_user_property_status_idx ON payments (user_id, property_id, status);
CREATE INDEX payments_type_idx     ON payments (payment_type, status, created_at DESC);
CREATE INDEX payments_ad_idx       ON payments (advertisement_id);
CREATE INDEX payments_gateway_idx  ON payments (gateway, status);

-- --------------------------------------------------------------------------
-- Payment gateways
--
-- Whether a gateway's secrets are present is NOT stored: it is resolved at
-- runtime from the Worker bindings, so the database can never disagree with
-- reality. This table holds the operator's intent and non-secret settings.
-- --------------------------------------------------------------------------
CREATE TABLE payment_gateways (
  id            TEXT PRIMARY KEY,   -- SSLCOMMERZ | BKASH | NAGAD | ROCKET | MANUAL
  display_name  TEXT NOT NULL,
  label_bn      TEXT NOT NULL,
  is_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  is_primary    INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_fallback   INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- Non-secret operational settings as JSON: sandbox flags, payout
  -- instructions, reference prefixes. NEVER credentials.
  settings_json TEXT NOT NULL DEFAULT '{}',
  notes         TEXT,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL
);

-- At most one primary and one fallback across the whole table.
CREATE UNIQUE INDEX payment_gateways_primary_uq  ON payment_gateways (is_primary)  WHERE is_primary = 1;
CREATE UNIQUE INDEX payment_gateways_fallback_uq ON payment_gateways (is_fallback) WHERE is_fallback = 1;

INSERT INTO payment_gateways (id, display_name, label_bn, is_enabled, is_primary, is_fallback, sort_order, settings_json, notes, updated_at) VALUES
  ('SSLCOMMERZ', 'SSLCOMMERZ', 'এসএসএলকমার্জ', 1, 1, 0, 1, '{}',
   'Cards, mobile banking and net banking via SSLCOMMERZ.', '2026-01-01T00:00:00Z'),
  ('MANUAL', 'Manual payment', 'ম্যানুয়াল পেমেন্ট', 0, 0, 0, 2,
   '{"instructions_bn":"বিকাশ/নগদ পার্সোনাল নম্বরে টাকা পাঠিয়ে ট্রানজেকশন আইডি জমা দিন।","account_number":""}',
   'Customer pays out of band and submits a reference; an admin confirms it.', '2026-01-01T00:00:00Z'),
  ('BKASH',  'bKash',  'বিকাশ', 0, 0, 0, 3, '{}',
   'Adapter interface only — awaiting real bKash merchant credentials.', '2026-01-01T00:00:00Z'),
  ('NAGAD',  'Nagad',  'নগদ',  0, 0, 0, 4, '{}',
   'Adapter interface only — awaiting real Nagad merchant credentials.', '2026-01-01T00:00:00Z'),
  ('ROCKET', 'Rocket', 'রকেট', 0, 0, 0, 5, '{}',
   'Adapter interface only — awaiting real Rocket merchant credentials.', '2026-01-01T00:00:00Z');

-- --------------------------------------------------------------------------
-- Configurable monetization pricing
--
-- Prices and durations are editable by a SUPER_ADMIN, never hardcoded.
-- --------------------------------------------------------------------------
CREATE TABLE monetization_plans (
  id            TEXT PRIMARY KEY,
  payment_type  TEXT NOT NULL REFERENCES payment_types(name) ON UPDATE CASCADE,
  label_bn      TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price_bdt     INTEGER NOT NULL CHECK (price_bdt >= 0),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE INDEX monetization_plans_type_idx ON monetization_plans (payment_type, is_active, sort_order);

INSERT INTO monetization_plans (id, payment_type, label_bn, duration_days, price_bdt, is_active, sort_order, updated_at) VALUES
  ('plan_feat_7',   'FEATURED_PROPERTY', 'ফিচার্ড — ৭ দিন',  7,  300, 1, 1, '2026-01-01T00:00:00Z'),
  ('plan_feat_15',  'FEATURED_PROPERTY', 'ফিচার্ড — ১৫ দিন', 15, 500, 1, 2, '2026-01-01T00:00:00Z'),
  ('plan_feat_30',  'FEATURED_PROPERTY', 'ফিচার্ড — ৩০ দিন', 30, 900, 1, 3, '2026-01-01T00:00:00Z'),
  ('plan_boost_7',  'PROPERTY_BOOST',    'বুস্ট — ৭ দিন',    7,  150, 1, 4, '2026-01-01T00:00:00Z'),
  ('plan_boost_15', 'PROPERTY_BOOST',    'বুস্ট — ১৫ দিন',   15, 250, 1, 5, '2026-01-01T00:00:00Z'),
  ('plan_boost_30', 'PROPERTY_BOOST',    'বুস্ট — ৩০ দিন',   30, 450, 1, 6, '2026-01-01T00:00:00Z');
