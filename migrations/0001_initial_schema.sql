-- ============================================================================
-- dayarampur.com — initial schema
--
-- Conventions
--   * Ids are opaque random TEXT (see src/lib/ids.ts) so nothing is guessable.
--   * Timestamps are ISO-8601 UTC TEXT ('2026-08-26T10:00:00Z') — SQLite has no
--     native date type and TEXT sorts correctly for this format.
--   * Booleans are INTEGER 0/1.
--   * Every status column carries a CHECK constraint mirroring src/domain/enums.ts.
--   * Money is stored as INTEGER BDT (whole taka). No floats anywhere near money.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Reference: roles
-- --------------------------------------------------------------------------
CREATE TABLE roles (
  name        TEXT PRIMARY KEY,
  rank        INTEGER NOT NULL,
  label_bn    TEXT NOT NULL
);

INSERT INTO roles (name, rank, label_bn) VALUES
  ('VISITOR',     0, 'দর্শনার্থী'),
  ('USER',        1, 'ব্যবহারকারী'),
  ('OWNER',       2, 'মালিক'),
  ('ADMIN',       3, 'অ্যাডমিন'),
  ('SUPER_ADMIN', 4, 'সুপার অ্যাডমিন');

-- --------------------------------------------------------------------------
-- Monotonic counters (public listing reference numbers)
-- --------------------------------------------------------------------------
CREATE TABLE sequences (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT INTO sequences (name, value) VALUES ('property_ref', 1000);

-- --------------------------------------------------------------------------
-- Users
-- --------------------------------------------------------------------------
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  -- Either phone or email may be absent, but at least one must exist. Both are
  -- unique when present (SQLite treats NULLs as distinct in a UNIQUE index).
  phone              TEXT UNIQUE,
  email              TEXT UNIQUE,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'USER'
                       REFERENCES roles(name) ON UPDATE CASCADE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  suspension_reason  TEXT,
  phone_verified_at  TEXT,
  email_verified_at  TEXT,
  is_verified_owner  INTEGER NOT NULL DEFAULT 0 CHECK (is_verified_owner IN (0, 1)),
  last_login_at      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX users_role_idx     ON users (role);
CREATE INDEX users_status_idx   ON users (status);
CREATE INDEX users_created_idx  ON users (created_at DESC);

-- --------------------------------------------------------------------------
-- Sessions
--
-- `id` is the SHA-256 of the cookie token, never the token itself: a database
-- dump therefore cannot be replayed as a set of live sessions.
-- --------------------------------------------------------------------------
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  ip_hash         TEXT,
  user_agent      TEXT
);

CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expiry_idx  ON sessions (expires_at);

-- --------------------------------------------------------------------------
-- One-time tokens: email/phone verification and password reset
-- --------------------------------------------------------------------------
CREATE TABLE verification_tokens (
  id          TEXT PRIMARY KEY,      -- SHA-256 of the emailed token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('EMAIL_VERIFY', 'PHONE_VERIFY', 'PASSWORD_RESET')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX verification_tokens_user_idx ON verification_tokens (user_id, purpose);

-- --------------------------------------------------------------------------
-- Categories and locations
-- --------------------------------------------------------------------------
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name_bn     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('RENT', 'SALE')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name_bn     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  parent_id   TEXT REFERENCES locations(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX locations_parent_idx ON locations (parent_id);

CREATE TABLE amenities (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name_bn     TEXT NOT NULL,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- Properties
--
-- PRIVACY BOUNDARY: exact_address, latitude, longitude and contact_phone are
-- "private columns". No public query in src/server/properties/queries.ts may
-- select them; they are read only by the authorized contact resolver and by
-- admin/owner views.
-- --------------------------------------------------------------------------
CREATE TABLE properties (
  id                TEXT PRIMARY KEY,
  public_ref        INTEGER NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id       TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  location_id       TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,

  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  property_type     TEXT,

  price             INTEGER NOT NULL CHECK (price >= 0),
  price_period      TEXT NOT NULL
                      CHECK (price_period IN ('MONTHLY','YEARLY','TOTAL','PER_KATHA','PER_DECIMAL')),
  is_negotiable     INTEGER NOT NULL DEFAULT 0 CHECK (is_negotiable IN (0, 1)),

  bedrooms          INTEGER,
  bathrooms         INTEGER,
  size_value        REAL,
  size_unit         TEXT,
  floor             INTEGER,
  total_floors      INTEGER,
  furnished         TEXT CHECK (furnished IS NULL OR furnished IN ('UNFURNISHED','SEMI_FURNISHED','FURNISHED')),
  tenant_type       TEXT CHECK (tenant_type IS NULL OR tenant_type IN ('ANY','FAMILY','BACHELOR','OFFICE','STUDENT')),
  available_from    TEXT,
  rules             TEXT,

  -- Public location information (coarse).
  landmark          TEXT,
  general_location  TEXT,

  -- ---- PRIVATE COLUMNS — paid unlock required ----
  exact_address     TEXT NOT NULL,
  latitude          REAL,
  longitude         REAL,
  contact_phone     TEXT NOT NULL,
  owner_name        TEXT NOT NULL,
  -- ------------------------------------------------

  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','RENTED','SOLD','EXPIRED','ARCHIVED')),
  rejection_reason  TEXT,
  is_featured       INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  is_verified       INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),

  views_count       INTEGER NOT NULL DEFAULT 0,
  unique_views_count INTEGER NOT NULL DEFAULT 0,
  unlocks_count     INTEGER NOT NULL DEFAULT 0,
  favorites_count   INTEGER NOT NULL DEFAULT 0,

  approved_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TEXT,
  published_at      TEXT,
  expires_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- The listing grid is always filtered by status first, then category/location,
-- then sorted. These composite indexes match that access pattern.
CREATE INDEX properties_public_listing_idx
  ON properties (status, category_id, published_at DESC);
CREATE INDEX properties_public_location_idx
  ON properties (status, location_id, published_at DESC);
CREATE INDEX properties_price_idx      ON properties (status, price);
CREATE INDEX properties_owner_idx      ON properties (owner_id, created_at DESC);
CREATE INDEX properties_status_idx     ON properties (status, created_at DESC);
CREATE INDEX properties_featured_idx   ON properties (status, is_featured, published_at DESC);
CREATE INDEX properties_expiry_idx     ON properties (status, expires_at);

-- --------------------------------------------------------------------------
-- Property images (R2 object keys only — never binary data)
-- --------------------------------------------------------------------------
CREATE TABLE property_images (
  id           TEXT PRIMARY KEY,
  property_id  TEXT REFERENCES properties(id) ON DELETE CASCADE,
  -- Uploads happen before the property row exists, so the uploader is recorded
  -- to authorize the later attach step.
  uploaded_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key   TEXT NOT NULL UNIQUE,
  thumb_key    TEXT,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  alt_bn       TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at   TEXT NOT NULL
);

CREATE INDEX property_images_property_idx ON property_images (property_id, sort_order);
CREATE INDEX property_images_orphan_idx   ON property_images (uploaded_by, property_id);

-- --------------------------------------------------------------------------
-- Property ↔ amenity join
-- --------------------------------------------------------------------------
CREATE TABLE property_amenities (
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  amenity_id   TEXT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, amenity_id)
);

CREATE INDEX property_amenities_amenity_idx ON property_amenities (amenity_id);

-- --------------------------------------------------------------------------
-- Favorites
-- --------------------------------------------------------------------------
CREATE TABLE favorites (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX favorites_user_property_uq ON favorites (user_id, property_id);
CREATE INDEX favorites_property_idx ON favorites (property_id);

-- --------------------------------------------------------------------------
-- Property views
--
-- `session_hash` is a salted hash of (session id | ip + user agent). The unique
-- index on (property_id, session_hash, view_date) is what stops a refresh loop
-- from inflating the unique-view count; total views are counted separately.
-- --------------------------------------------------------------------------
CREATE TABLE property_views (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_hash  TEXT NOT NULL,
  view_date     TEXT NOT NULL,           -- YYYY-MM-DD, UTC
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX property_views_unique_daily_uq
  ON property_views (property_id, session_hash, view_date);
CREATE INDEX property_views_property_idx ON property_views (property_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Payments
-- --------------------------------------------------------------------------
CREATE TABLE payments (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,       -- our id, sent to the gateway
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  currency       TEXT NOT NULL DEFAULT 'BDT',
  gateway        TEXT NOT NULL DEFAULT 'SSLCOMMERZ',
  status         TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED')),
  validation_id  TEXT UNIQUE,                -- SSLCOMMERZ val_id
  bank_tran_id   TEXT,
  card_type      TEXT,
  risk_level     TEXT,
  gateway_status TEXT,
  failure_reason TEXT,
  refunded_at    TEXT,
  refund_ref     TEXT,
  -- Raw gateway payload kept for dispute resolution. Contains no card data:
  -- SSLCOMMERZ never sends PAN/CVV in the IPN.
  raw_payload    TEXT,
  created_at     TEXT NOT NULL,
  paid_at        TEXT,
  updated_at     TEXT NOT NULL
);

CREATE INDEX payments_user_idx     ON payments (user_id, created_at DESC);
CREATE INDEX payments_property_idx ON payments (property_id);
CREATE INDEX payments_status_idx   ON payments (status, created_at DESC);
CREATE INDEX payments_user_property_status_idx ON payments (user_id, property_id, status);

-- --------------------------------------------------------------------------
-- Contact unlocks
--
-- The partial unique index is the anti-duplicate guarantee required by the
-- spec: a given user can hold at most ONE active unlock per property, enforced
-- by the database rather than by application logic.
-- --------------------------------------------------------------------------
CREATE TABLE contact_unlocks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  payment_id   TEXT REFERENCES payments(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  unlocked_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX contact_unlocks_active_uq
  ON contact_unlocks (user_id, property_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX contact_unlocks_payment_uq
  ON contact_unlocks (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX contact_unlocks_user_idx     ON contact_unlocks (user_id, created_at DESC);
CREATE INDEX contact_unlocks_property_idx ON contact_unlocks (property_id);

-- --------------------------------------------------------------------------
-- Reports
-- --------------------------------------------------------------------------
CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reporter_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL
                    CHECK (reason IN ('FAKE_PROPERTY','WRONG_PRICE','WRONG_INFORMATION','WRONG_LOCATION','SCAM','DUPLICATE','ALREADY_RENTED','OTHER')),
  details         TEXT,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED','DISMISSED')),
  resolution_note TEXT,
  resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX reports_status_idx   ON reports (status, created_at DESC);
CREATE INDEX reports_property_idx ON reports (property_id);

-- --------------------------------------------------------------------------
-- Notifications
-- --------------------------------------------------------------------------
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title_bn     TEXT NOT NULL,
  body_bn      TEXT,
  link         TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX notifications_user_idx        ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, read_at);

-- --------------------------------------------------------------------------
-- Admin audit log (append-only; never updated or deleted by the app)
-- --------------------------------------------------------------------------
CREATE TABLE admin_logs (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  metadata     TEXT,        -- JSON
  ip_hash      TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX admin_logs_admin_idx  ON admin_logs (admin_id, created_at DESC);
CREATE INDEX admin_logs_entity_idx ON admin_logs (entity_type, entity_id);
CREATE INDEX admin_logs_created_idx ON admin_logs (created_at DESC);

-- --------------------------------------------------------------------------
-- Settings (SUPER_ADMIN editable platform configuration)
-- --------------------------------------------------------------------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);

-- --------------------------------------------------------------------------
-- Rate limiting
--
-- A fixed-window counter table. D1 is the only durable store bound to this
-- Worker, and login/registration volume for one upazila is far below the point
-- where this would need KV or a Durable Object.
-- --------------------------------------------------------------------------
CREATE TABLE rate_limits (
  bucket_key    TEXT PRIMARY KEY,   -- '<action>:<subject-hash>:<window-start>'
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,   -- epoch ms
  expires_at    INTEGER NOT NULL    -- epoch ms; swept opportunistically
);

CREATE INDEX rate_limits_expiry_idx ON rate_limits (expires_at);
