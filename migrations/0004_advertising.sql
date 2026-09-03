-- ============================================================================
-- Advertising platform
--
-- Seven tables plus one rebuild of `payments`:
--
--   advertisers                 a business account, owned by exactly one user
--   advertisement_zones         the 12 placements a banner can occupy
--   advertisement_packages      what is for sale: duration, price, priority
--   advertisement_campaigns     one purchase, with its lifecycle and schedule
--   advertisement_creatives     the banner images (desktop / mobile)
--   advertisement_impressions   deduplicated views
--   advertisement_clicks        deduplicated clicks
--
-- STRUCTURAL SECURITY NOTE
-- There is deliberately NO column anywhere in this migration that holds HTML,
-- JavaScript, CSS or a third-party ad tag. A creative is an image in R2 plus a
-- destination URL, so an advertiser has no channel through which to inject
-- markup or script into a page. Adding such a column would be a design change,
-- not a feature.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Public reference numbers for campaigns, from the existing counter table.
-- --------------------------------------------------------------------------
INSERT INTO sequences (name, value) VALUES ('ad_campaign_ref', 500);

-- --------------------------------------------------------------------------
-- Advertisers
--
-- A business profile attached to a user account. One per user: the unique
-- index is what makes "the advertiser owning this campaign" unambiguous, and
-- ownership checks elsewhere are always `AND advertiser_id = ?`.
--
-- The contact columns are named `business_*` rather than `contact_phone` so
-- they can never be confused with the property privacy boundary enforced by
-- tests/security/private-columns.test.ts.
-- --------------------------------------------------------------------------
CREATE TABLE advertisers (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name     TEXT NOT NULL,
  contact_person    TEXT NOT NULL,
  business_phone    TEXT NOT NULL,
  business_email    TEXT,
  business_address  TEXT,
  website_url       TEXT,
  trade_licence_no  TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','SUSPENDED','REJECTED')),
  rejection_reason  TEXT,
  admin_notes       TEXT,
  approved_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- A rejection must say why; the advertiser is shown this text.
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE UNIQUE INDEX advertisers_user_uq   ON advertisers (user_id);
CREATE INDEX        advertisers_status_idx ON advertisers (status, created_at DESC);

-- --------------------------------------------------------------------------
-- Ad zones
--
-- Placements, not adverts. `max_active_ads` is the rotation pool size for the
-- zone and `priority` breaks ties between zones of equal weight. Every field
-- is editable by a SUPER_ADMIN — nothing about a zone is hardcoded in the app.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_zones (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name_bn         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description_bn  TEXT,
  -- Recommended banner dimensions, 'WIDTHxHEIGHT'. Advisory: the real upload
  -- limits are enforced in code against the creative's decoded dimensions.
  desktop_size    TEXT NOT NULL,
  mobile_size     TEXT,
  pricing_model   TEXT NOT NULL DEFAULT 'FLAT'
                    CHECK (pricing_model IN ('FLAT','CPM','CPC')),
  base_price_bdt  INTEGER NOT NULL CHECK (base_price_bdt >= 0),
  max_active_ads  INTEGER NOT NULL DEFAULT 1 CHECK (max_active_ads > 0),
  priority        INTEGER NOT NULL DEFAULT 0,
  is_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX advertisement_zones_enabled_idx ON advertisement_zones (is_enabled, sort_order);

-- --------------------------------------------------------------------------
-- Packages
--
-- `zone_id` NULL means the package may be bought for any zone; a non-NULL
-- value restricts it to one placement. Prices here are the operator's default
-- price list and are expected to be reviewed in the admin screen before the
-- advertising flow is opened to the public.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_packages (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name_bn          TEXT NOT NULL,
  description_bn   TEXT,
  zone_id          TEXT REFERENCES advertisement_zones(id) ON DELETE SET NULL,
  duration_days    INTEGER NOT NULL CHECK (duration_days > 0),
  price_bdt        INTEGER NOT NULL CHECK (price_bdt >= 0),
  -- NULL = uncapped, which is what a flat-rate package means.
  impression_limit INTEGER CHECK (impression_limit IS NULL OR impression_limit > 0),
  click_limit      INTEGER CHECK (click_limit IS NULL OR click_limit > 0),
  max_creatives    INTEGER NOT NULL DEFAULT 2 CHECK (max_creatives > 0),
  -- Rotation weight a campaign inherits at purchase.
  priority         INTEGER NOT NULL DEFAULT 0,
  -- Sole occupancy of the zone for the campaign's window.
  is_exclusive     INTEGER NOT NULL DEFAULT 0 CHECK (is_exclusive IN (0,1)),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX advertisement_packages_active_idx ON advertisement_packages (is_active, sort_order);
CREATE INDEX advertisement_packages_zone_idx   ON advertisement_packages (zone_id, is_active);

-- --------------------------------------------------------------------------
-- Campaigns
--
-- The lifecycle, and why the money states come first:
--
--   DRAFT -> PENDING_PAYMENT -> PAID -> PENDING_REVIEW
--         -> APPROVED -> SCHEDULED -> ACTIVE -> EXPIRED
--
-- Payment does NOT publish an advert. A paid campaign lands in PENDING_REVIEW
-- and only staff approval moves it on, so nothing an advertiser can buy puts
-- an unreviewed banner on the site. PAUSED is reversible; REJECTED, EXPIRED
-- and CANCELLED are terminal.
--
-- Price and duration are copied from the package at purchase rather than
-- joined at read time: a later price change must not alter what someone has
-- already bought.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_campaigns (
  id                 TEXT PRIMARY KEY,
  public_ref         INTEGER NOT NULL UNIQUE,
  advertiser_id      TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  zone_id            TEXT NOT NULL REFERENCES advertisement_zones(id) ON DELETE RESTRICT,
  -- Nullable: a campaign an admin creates directly need not come from the
  -- public price list.
  package_id         TEXT REFERENCES advertisement_packages(id) ON DELETE RESTRICT,
  -- The payment that most recently paid for this campaign. The full history,
  -- including renewals, is `payments WHERE advertisement_id = campaigns.id`.
  payment_id         TEXT REFERENCES payments(id) ON DELETE SET NULL,

  title              TEXT NOT NULL,
  destination_url    TEXT NOT NULL,

  status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                       'DRAFT','PENDING_PAYMENT','PAID','PENDING_REVIEW','APPROVED',
                       'SCHEDULED','ACTIVE','PAUSED','REJECTED','EXPIRED','CANCELLED')),

  -- Agreed price, frozen at purchase. Whole taka, like every other amount.
  price_bdt          INTEGER NOT NULL CHECK (price_bdt >= 0),
  currency           TEXT NOT NULL DEFAULT 'BDT',
  duration_days      INTEGER NOT NULL CHECK (duration_days > 0),
  priority           INTEGER NOT NULL DEFAULT 0,
  is_exclusive       INTEGER NOT NULL DEFAULT 0 CHECK (is_exclusive IN (0,1)),

  -- Scheduling. `requested_start_at` is the advertiser's wish; start_at/end_at
  -- are the committed window, set when the campaign is approved.
  requested_start_at TEXT,
  start_at           TEXT,
  end_at             TEXT,

  -- Targeting. NULL means "no restriction on this axis".
  target_location_id TEXT REFERENCES locations(id)  ON DELETE SET NULL,
  target_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  target_device      TEXT NOT NULL DEFAULT 'ALL'
                       CHECK (target_device IN ('ALL','DESKTOP','MOBILE')),

  -- Moderation
  reviewed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        TEXT,
  rejection_reason   TEXT,

  -- Pause / resume
  paused_at          TEXT,
  paused_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  pause_reason       TEXT,

  -- Renewal: a renewal is a NEW campaign row pointing back at the one it
  -- continues, so each period keeps its own price, window and statistics.
  renewed_from_id    TEXT REFERENCES advertisement_campaigns(id) ON DELETE SET NULL,
  renewal_count      INTEGER NOT NULL DEFAULT 0,

  -- Denormalised counters for the dashboards; the event tables stay canonical.
  impressions_count  INTEGER NOT NULL DEFAULT 0,
  clicks_count       INTEGER NOT NULL DEFAULT 0,

  activated_at       TEXT,
  expired_at         TEXT,
  cancelled_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  -- A window must be ordered.
  CHECK (start_at IS NULL OR end_at IS NULL OR end_at > start_at),
  -- A rejection must record why. The advertiser is shown this text.
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  -- Anything scheduled or running has a committed window.
  CHECK (status NOT IN ('SCHEDULED','ACTIVE','EXPIRED')
         OR (start_at IS NOT NULL AND end_at IS NOT NULL))
);

-- Ad serving: enabled zone, running status, inside the window, by weight.
CREATE INDEX advertisement_campaigns_serving_idx
  ON advertisement_campaigns (zone_id, status, start_at, end_at, priority DESC);
-- The advertiser's own dashboard.
CREATE INDEX advertisement_campaigns_advertiser_idx
  ON advertisement_campaigns (advertiser_id, created_at DESC);
-- The admin approval queue and the status filters beside it.
CREATE INDEX advertisement_campaigns_status_idx
  ON advertisement_campaigns (status, created_at DESC);
-- The expiry sweep.
CREATE INDEX advertisement_campaigns_expiry_idx
  ON advertisement_campaigns (status, end_at);
CREATE INDEX advertisement_campaigns_payment_idx
  ON advertisement_campaigns (payment_id);
CREATE INDEX advertisement_campaigns_renewal_idx
  ON advertisement_campaigns (renewed_from_id);

-- --------------------------------------------------------------------------
-- Creatives
--
-- One campaign may carry several banners: a desktop and a mobile variant at
-- minimum, and more than one of each if the package allows rotation.
--
-- `mime_type` is constrained to the three formats the platform accepts. This
-- is the schema half of the rule; the upload path additionally verifies the
-- magic bytes, because a declared MIME type is attacker-controlled.
-- `object_key` is server-generated and unique, so a sanitised filename can
-- never collide with or overwrite another advertiser's object.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_creatives (
  id               TEXT PRIMARY KEY,
  campaign_id      TEXT NOT NULL REFERENCES advertisement_campaigns(id) ON DELETE CASCADE,
  uploaded_by      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant          TEXT NOT NULL DEFAULT 'DESKTOP'
                     CHECK (variant IN ('DESKTOP','MOBILE')),
  object_key       TEXT NOT NULL UNIQUE,
  mime_type        TEXT NOT NULL
                     CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0),
  width            INTEGER,
  height           INTEGER,
  -- Bangla alternative text. Required: a banner is content, not decoration.
  alt_bn           TEXT NOT NULL,
  -- Optional per-creative override; falls back to the campaign's URL.
  destination_url  TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                     CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
  rejection_reason TEXT,
  reviewed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE INDEX advertisement_creatives_campaign_idx
  ON advertisement_creatives (campaign_id, variant, is_active, sort_order);
CREATE INDEX advertisement_creatives_review_idx
  ON advertisement_creatives (status, created_at DESC);

-- --------------------------------------------------------------------------
-- Impressions
--
-- Deduplicated exactly as `property_views` is: one row per campaign, zone,
-- visitor and UTC day. A refresh loop therefore cannot inflate the count the
-- advertiser is shown, and the unique index — not application logic — is what
-- guarantees it.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_impressions (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES advertisement_campaigns(id) ON DELETE CASCADE,
  creative_id  TEXT REFERENCES advertisement_creatives(id) ON DELETE SET NULL,
  zone_id      TEXT NOT NULL REFERENCES advertisement_zones(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Salted hash of the session or of ip+user-agent. Never a raw IP.
  session_hash TEXT NOT NULL,
  device       TEXT NOT NULL DEFAULT 'UNKNOWN'
                 CHECK (device IN ('DESKTOP','MOBILE','UNKNOWN')),
  page_path    TEXT,
  view_date    TEXT NOT NULL,          -- YYYY-MM-DD, UTC
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX advertisement_impressions_daily_uq
  ON advertisement_impressions (campaign_id, zone_id, session_hash, view_date);
CREATE INDEX advertisement_impressions_campaign_idx
  ON advertisement_impressions (campaign_id, view_date);
CREATE INDEX advertisement_impressions_zone_idx
  ON advertisement_impressions (zone_id, view_date);

-- --------------------------------------------------------------------------
-- Clicks
--
-- Every click is recorded, but only the first from a visitor on a given day is
-- billable. The partial unique index enforces that: a second click inserts
-- with is_billable = 0 rather than being dropped, so click fraud stays visible
-- in the data instead of being silently discarded.
-- --------------------------------------------------------------------------
CREATE TABLE advertisement_clicks (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES advertisement_campaigns(id) ON DELETE CASCADE,
  creative_id  TEXT REFERENCES advertisement_creatives(id) ON DELETE SET NULL,
  zone_id      TEXT NOT NULL REFERENCES advertisement_zones(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_hash TEXT NOT NULL,
  ip_hash      TEXT,
  device       TEXT NOT NULL DEFAULT 'UNKNOWN'
                 CHECK (device IN ('DESKTOP','MOBILE','UNKNOWN')),
  referer_path TEXT,
  click_date   TEXT NOT NULL,          -- YYYY-MM-DD, UTC
  is_billable  INTEGER NOT NULL DEFAULT 1 CHECK (is_billable IN (0,1)),
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX advertisement_clicks_billable_daily_uq
  ON advertisement_clicks (campaign_id, session_hash, click_date) WHERE is_billable = 1;
CREATE INDEX advertisement_clicks_campaign_idx
  ON advertisement_clicks (campaign_id, click_date);
CREATE INDEX advertisement_clicks_zone_idx
  ON advertisement_clicks (zone_id, click_date);

-- ============================================================================
-- Give `payments.advertisement_id` a real foreign key
--
-- Migration 0003 left the column unconstrained because the advertising tables
-- did not exist yet. They do now, so the reference becomes enforced by the
-- database rather than by application code.
--
-- ON DELETE RESTRICT, deliberately: a campaign that has taken money cannot be
-- deleted out from under its payment record. Campaigns are CANCELLED, never
-- removed.
--
-- The same hazard as in 0003 applies and is handled the same way. DROP TABLE
-- performs an implicit DELETE that FIRES referencing actions, and
-- `contact_unlocks.payment_id` is ON DELETE SET NULL — so dropping the old
-- table would silently unlink every unlock from the payment that bought it and
-- revoke access customers had already paid for. The mapping is stashed before
-- the drop and restored after the rename.
--
-- `advertisement_campaigns.payment_id` is also ON DELETE SET NULL but the
-- table was created empty moments ago, so it has nothing to lose.
-- ============================================================================
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE _unlock_payment_backup_0004 (
  unlock_id  TEXT PRIMARY KEY,
  payment_id TEXT
);
INSERT INTO _unlock_payment_backup_0004 (unlock_id, payment_id)
SELECT id, payment_id FROM contact_unlocks WHERE payment_id IS NOT NULL;

CREATE TABLE payments_new (
  id               TEXT PRIMARY KEY,
  transaction_id   TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  property_id      TEXT REFERENCES properties(id) ON DELETE RESTRICT,
  -- Now enforced.
  advertisement_id TEXT REFERENCES advertisement_campaigns(id) ON DELETE RESTRICT,
  payment_type     TEXT NOT NULL DEFAULT 'PROPERTY_CONTACT_UNLOCK'
                     REFERENCES payment_types(name) ON UPDATE CASCADE,
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

INSERT INTO payments_new (
  id, transaction_id, user_id, property_id, advertisement_id, payment_type,
  description, amount, currency, gateway, status, validation_id, bank_tran_id,
  card_type, risk_level, gateway_status, failure_reason, refunded_at,
  refund_ref, raw_payload, created_at, paid_at, updated_at
)
SELECT
  id, transaction_id, user_id, property_id, advertisement_id, payment_type,
  description, amount, currency, gateway, status, validation_id, bank_tran_id,
  card_type, risk_level, gateway_status, failure_reason, refunded_at,
  refund_ref, raw_payload, created_at, paid_at, updated_at
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

-- Put back the links the implicit DELETE nulled out.
UPDATE contact_unlocks
   SET payment_id = (
     SELECT b.payment_id FROM _unlock_payment_backup_0004 b WHERE b.unlock_id = contact_unlocks.id
   )
 WHERE payment_id IS NULL
   AND id IN (SELECT unlock_id FROM _unlock_payment_backup_0004);

DROP TABLE _unlock_payment_backup_0004;

CREATE INDEX payments_user_idx     ON payments (user_id, created_at DESC);
CREATE INDEX payments_property_idx ON payments (property_id);
CREATE INDEX payments_status_idx   ON payments (status, created_at DESC);
CREATE INDEX payments_user_property_status_idx ON payments (user_id, property_id, status);
CREATE INDEX payments_type_idx     ON payments (payment_type, status, created_at DESC);
CREATE INDEX payments_ad_idx       ON payments (advertisement_id);
CREATE INDEX payments_gateway_idx  ON payments (gateway, status);

-- ============================================================================
-- Reference data: the twelve placements and the default price list
--
-- This is configuration, not sample content: every environment needs the zones
-- to exist before an advert can be sold for one. Nothing here is a fabricated
-- advertiser, campaign or payment.
--
-- Prices are the operator's starting point and are editable in the admin
-- screen. Review them before the advertising flow is opened to the public.
-- ============================================================================
INSERT INTO advertisement_zones
  (id, slug, name_bn, name_en, description_bn, desktop_size, mobile_size,
   pricing_model, base_price_bdt, max_active_ads, priority, is_enabled, sort_order,
   created_at, updated_at)
VALUES
  ('zone_home_top', 'home-top', 'হোম পেজ — উপরের ব্যানার', 'Homepage top banner',
   'হোম পেজের একদম উপরে, হেডারের নিচে।', '970x90', '320x100', 'FLAT', 1500, 1, 100, 1, 1,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_home_hero', 'home-hero-under', 'হোম পেজ — সার্চ বক্সের নিচে', 'Homepage below search',
   'সার্চ বক্স ও ক্যাটাগরি তালিকার মাঝখানে।', '728x90', '320x100', 'FLAT', 1200, 1, 90, 1, 2,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_home_mid', 'home-mid', 'হোম পেজ — মাঝের ব্যানার', 'Homepage mid banner',
   'সাম্প্রতিক বিজ্ঞাপনের তালিকার মাঝখানে।', '728x90', '320x100', 'FLAT', 900, 2, 70, 1, 3,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_home_sidebar', 'home-sidebar', 'হোম পেজ — সাইডবার', 'Homepage sidebar',
   'হোম পেজের ডান পাশের কলাম।', '300x250', NULL, 'FLAT', 800, 3, 60, 1, 4,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_home_bottom', 'home-bottom', 'হোম পেজ — নিচের ব্যানার', 'Homepage bottom banner',
   'ফুটারের ঠিক উপরে।', '970x90', '320x100', 'FLAT', 600, 2, 40, 1, 5,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_category_top', 'category-top', 'ক্যাটাগরি পেজ — উপরের ব্যানার', 'Category top banner',
   'যেকোনো ক্যাটাগরির তালিকা পেজের উপরে।', '728x90', '320x100', 'FLAT', 1000, 1, 85, 1, 6,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_category_inline', 'category-inline', 'ক্যাটাগরি পেজ — তালিকার ভেতরে', 'Category inline',
   'বিজ্ঞাপন কার্ডের সারির মাঝখানে।', '728x90', '300x250', 'FLAT', 700, 3, 55, 1, 7,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_category_sidebar', 'category-sidebar', 'ক্যাটাগরি পেজ — সাইডবার', 'Category sidebar',
   'ফিল্টারের নিচে ডান পাশের কলাম।', '300x600', NULL, 'FLAT', 750, 3, 50, 1, 8,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_search_inline', 'search-inline', 'সার্চ ফলাফল — তালিকার ভেতরে', 'Search results inline',
   'সার্চ ফলাফলের মাঝখানে।', '728x90', '300x250', 'FLAT', 700, 3, 45, 1, 9,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_property_top', 'property-top', 'বিজ্ঞাপন পেজ — উপরের ব্যানার', 'Property detail top',
   'একক বিজ্ঞাপনের বিস্তারিত পেজের উপরে।', '728x90', '320x100', 'FLAT', 900, 1, 80, 1, 10,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_property_sidebar', 'property-sidebar', 'বিজ্ঞাপন পেজ — সাইডবার', 'Property detail sidebar',
   'যোগাযোগ বক্সের নিচে ডান পাশের কলাম।', '300x250', NULL, 'FLAT', 850, 3, 65, 1, 11,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('zone_site_footer', 'site-footer', 'সব পেজ — ফুটার ব্যানার', 'Site-wide footer banner',
   'প্রতিটি পেজের ফুটারে দেখানো হয়।', '970x90', '320x100', 'FLAT', 500, 2, 30, 1, 12,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Default price list. `zone_id` is NULL, so these may be bought for any zone;
-- the zone's own base_price_bdt is what varies the final quote.
INSERT INTO advertisement_packages
  (id, slug, name_bn, description_bn, zone_id, duration_days, price_bdt,
   impression_limit, click_limit, max_creatives, priority, is_exclusive,
   is_active, sort_order, created_at, updated_at)
VALUES
  ('adpkg_basic',    'basic',    'বেসিক — ৭ দিন',
   'সাত দিনের জন্য একটি জোনে বিজ্ঞাপন।', NULL, 7,  500,  NULL, NULL, 2, 10, 0, 1, 1,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('adpkg_standard', 'standard', 'স্ট্যান্ডার্ড — ১৫ দিন',
   'পনেরো দিন, রোটেশনে অগ্রাধিকার সহ।', NULL, 15, 900,  NULL, NULL, 3, 20, 0, 1, 2,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('adpkg_premium',  'premium',  'প্রিমিয়াম — ৩০ দিন',
   'ত্রিশ দিন, সর্বোচ্চ অগ্রাধিকার।', NULL, 30, 1500, NULL, NULL, 4, 30, 0, 1, 3,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  -- Sole occupancy of a zone. Left inactive: the operator must price
  -- exclusivity per zone before offering it, since it blocks all other sales
  -- there for the whole window.
  ('adpkg_exclusive', 'exclusive', 'এক্সক্লুসিভ — ৩০ দিন',
   'ত্রিশ দিন একটি জোন সম্পূর্ণ এককভাবে।', NULL, 30, 5000, NULL, NULL, 4, 90, 1, 0, 4,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
