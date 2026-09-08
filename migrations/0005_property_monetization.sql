-- ============================================================================
-- Property monetization: featured listings and boost
--
-- WHY THIS MIGRATION IS REQUIRED
--
-- `properties.is_featured` has existed since 0001 as a plain boolean with no
-- expiry. A paid feature therefore had no way to end: once set, the flag would
-- stay set forever, and an operator would have to remember to clear it by hand.
-- Boost had no representation at all.
--
-- This adds the two timestamps that make both states time-limited, so the
-- scheduled job in src/server/jobs/ can retire them the same way it retires
-- listings and campaigns.
--
-- SAFETY
-- Purely additive: three ADD COLUMN statements and two indexes. No table is
-- rebuilt, no row is rewritten, no data is deleted, and every new column is
-- nullable so existing rows remain valid. Re-running the migration is
-- prevented by Wrangler's own d1_migrations bookkeeping.
--
-- `is_featured` remains the authoritative flag that every existing query reads;
-- `featured_until` says when that flag should be cleared. Keeping both means no
-- existing query has to change to stay correct.
-- ============================================================================

-- When the paid featured placement ends. NULL = not featured.
ALTER TABLE properties ADD COLUMN featured_until TEXT;

-- When the paid boost ends. NULL = not boosted. Boost lifts a listing in the
-- default ordering; it never changes what the listing says or hides others.
ALTER TABLE properties ADD COLUMN boosted_until TEXT;

-- Cleared by the scheduled sweep alongside featured_until.
ALTER TABLE properties ADD COLUMN boosted_at TEXT;

-- The expiry sweeps: find rows whose paid window has closed, cheaply.
CREATE INDEX properties_featured_expiry_idx ON properties (featured_until)
  WHERE featured_until IS NOT NULL;
CREATE INDEX properties_boost_expiry_idx    ON properties (boosted_until)
  WHERE boosted_until IS NOT NULL;
