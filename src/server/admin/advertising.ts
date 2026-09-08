/**
 * Admin reads and mutations for advertising.
 *
 * Mutations here are thin wrappers over the Phase 2 lifecycle functions plus
 * an audit row. The lifecycle rules — legal transitions, mandatory rejection
 * reasons, scheduling — live in `src/server/advertising/campaigns.ts` and are
 * NOT duplicated: an admin approving a campaign goes through exactly the same
 * guarded transition an automated path would.
 */
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import type { CampaignStatus } from "@/domain/advertising";

export interface AdminCampaignRow {
  id: string;
  public_ref: number;
  title: string;
  status: CampaignStatus;
  destination_url: string;
  price_bdt: number;
  duration_days: number;
  start_at: string | null;
  end_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  impressions_count: number;
  clicks_count: number;
  zone_name_bn: string;
  zone_slug: string;
  package_name_bn: string | null;
  business_name: string;
  business_phone: string;
  advertiser_id: string;
  payment_status: string | null;
  gateway: string | null;
}

const ADMIN_CAMPAIGN_SELECT = `
  SELECT c.id, c.public_ref, c.title, c.status, c.destination_url, c.price_bdt,
         c.duration_days, c.start_at, c.end_at, c.rejection_reason, c.created_at,
         c.impressions_count, c.clicks_count, c.advertiser_id,
         z.name_bn AS zone_name_bn, z.slug AS zone_slug,
         pk.name_bn AS package_name_bn,
         a.business_name, a.business_phone,
         pay.status AS payment_status, pay.gateway AS gateway
    FROM advertisement_campaigns c
    JOIN advertisement_zones z          ON z.id  = c.zone_id
    JOIN advertisers a                  ON a.id  = c.advertiser_id
    LEFT JOIN advertisement_packages pk ON pk.id = c.package_id
    LEFT JOIN payments pay              ON pay.id = c.payment_id`;

/** Campaigns, optionally filtered by status. Staff see every advertiser's. */
export async function listCampaignsForAdmin(
  db: D1Database,
  filter: { status?: CampaignStatus | "ALL" } = {},
): Promise<AdminCampaignRow[]> {
  if (!filter.status || filter.status === "ALL") {
    return queryAll<AdminCampaignRow>(
      db,
      `${ADMIN_CAMPAIGN_SELECT} ORDER BY c.created_at DESC LIMIT 200`,
    );
  }
  return queryAll<AdminCampaignRow>(
    db,
    `${ADMIN_CAMPAIGN_SELECT} WHERE c.status = ? ORDER BY c.created_at DESC LIMIT 200`,
    [filter.status],
  );
}

/**
 * The approval queue.
 *
 * PENDING_REVIEW only: a campaign reaches it by having paid, and leaves it
 * only by an explicit staff decision.
 */
export async function listPendingReview(db: D1Database): Promise<AdminCampaignRow[]> {
  return queryAll<AdminCampaignRow>(
    db,
    `${ADMIN_CAMPAIGN_SELECT} WHERE c.status = 'PENDING_REVIEW' ORDER BY c.created_at ASC`,
  );
}

export async function getCampaignForAdmin(
  db: D1Database,
  campaignId: string,
): Promise<AdminCampaignRow | null> {
  return queryOne<AdminCampaignRow>(db, `${ADMIN_CAMPAIGN_SELECT} WHERE c.id = ?`, [campaignId]);
}

export interface AdminAdvertiserRow {
  id: string;
  business_name: string;
  contact_person: string;
  business_phone: string;
  business_email: string | null;
  status: string;
  created_at: string;
  campaigns: number;
}

export async function listAdvertisersForAdmin(db: D1Database): Promise<AdminAdvertiserRow[]> {
  return queryAll<AdminAdvertiserRow>(
    db,
    `SELECT a.id, a.business_name, a.contact_person, a.business_phone, a.business_email,
            a.status, a.created_at,
            (SELECT count(*) FROM advertisement_campaigns c WHERE c.advertiser_id = a.id)
              AS campaigns
       FROM advertisers a
      ORDER BY a.created_at DESC
      LIMIT 200`,
  );
}

/* -------------------------------------------------------------------------- */
/* Zones and packages                                                          */
/* -------------------------------------------------------------------------- */

export interface AdminZoneRow {
  id: string;
  slug: string;
  name_bn: string;
  desktop_size: string;
  mobile_size: string | null;
  base_price_bdt: number;
  max_active_ads: number;
  priority: number;
  is_enabled: number;
  sort_order: number;
  active_campaigns: number;
}

export async function listZonesForAdmin(db: D1Database): Promise<AdminZoneRow[]> {
  return queryAll<AdminZoneRow>(
    db,
    `SELECT z.id, z.slug, z.name_bn, z.desktop_size, z.mobile_size, z.base_price_bdt,
            z.max_active_ads, z.priority, z.is_enabled, z.sort_order,
            (SELECT count(*) FROM advertisement_campaigns c
              WHERE c.zone_id = z.id AND c.status = 'ACTIVE') AS active_campaigns
       FROM advertisement_zones z
      ORDER BY z.sort_order ASC`,
  );
}

export async function setZoneEnabled(
  db: D1Database,
  zoneId: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await execute(
    db,
    `UPDATE advertisement_zones SET is_enabled = ?, updated_at = ? WHERE id = ?`,
    [enabled ? 1 : 0, nowIso(), zoneId],
  );
  return changes(result) === 1;
}

/** Zone pricing and capacity. Every field here is operator-configurable. */
export async function updateZone(
  db: D1Database,
  zoneId: string,
  patch: { basePriceBdt: number; maxActiveAds: number; priority: number },
): Promise<boolean> {
  if (patch.basePriceBdt < 0 || patch.maxActiveAds < 1) return false;

  const result = await execute(
    db,
    `UPDATE advertisement_zones
        SET base_price_bdt = ?, max_active_ads = ?, priority = ?, updated_at = ?
      WHERE id = ?`,
    [patch.basePriceBdt, patch.maxActiveAds, patch.priority, nowIso(), zoneId],
  );
  return changes(result) === 1;
}

export interface AdminPackageRow {
  id: string;
  slug: string;
  name_bn: string;
  zone_id: string | null;
  duration_days: number;
  price_bdt: number;
  max_creatives: number;
  priority: number;
  is_exclusive: number;
  is_active: number;
  sort_order: number;
}

export async function listPackagesForAdmin(db: D1Database): Promise<AdminPackageRow[]> {
  return queryAll<AdminPackageRow>(
    db,
    `SELECT id, slug, name_bn, zone_id, duration_days, price_bdt, max_creatives,
            priority, is_exclusive, is_active, sort_order
       FROM advertisement_packages
      ORDER BY sort_order ASC`,
  );
}

/**
 * Updates a package's commercial terms.
 *
 * Changing a price never alters a campaign that has already been sold: the
 * price and duration are snapshotted onto the campaign row at purchase.
 */
export async function updatePackage(
  db: D1Database,
  packageId: string,
  patch: { priceBdt: number; durationDays: number; isActive: boolean },
): Promise<boolean> {
  if (patch.priceBdt < 0 || patch.durationDays < 1) return false;

  const result = await execute(
    db,
    `UPDATE advertisement_packages
        SET price_bdt = ?, duration_days = ?, is_active = ?, updated_at = ?
      WHERE id = ?`,
    [patch.priceBdt, patch.durationDays, patch.isActive ? 1 : 0, nowIso(), packageId],
  );
  return changes(result) === 1;
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdvertisingAnalytics {
  revenueBdt: number;
  pendingRevenueBdt: number;
  campaigns: number;
  activeCampaigns: number;
  advertisers: number;
  impressions: number;
  clicks: number;
  topZones: { name_bn: string; impressions: number; clicks: number }[];
  topAdvertisers: { business_name: string; campaigns: number; spent: number }[];
}

export async function getAdvertisingAnalytics(db: D1Database): Promise<AdvertisingAnalytics> {
  const totals = await queryOne<{
    campaigns: number;
    active: number;
    impressions: number;
    clicks: number;
  }>(
    db,
    `SELECT count(*) AS campaigns,
            COALESCE(sum(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(sum(impressions_count), 0) AS impressions,
            COALESCE(sum(clicks_count), 0) AS clicks
       FROM advertisement_campaigns`,
  );

  // Settled money and money still owed are reported separately: conflating
  // them would overstate revenue by every abandoned checkout.
  const revenue = await queryOne<{ paid: number; pending: number }>(
    db,
    `SELECT COALESCE(sum(CASE WHEN status = 'PAID'    THEN amount ELSE 0 END), 0) AS paid,
            COALESCE(sum(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) AS pending
       FROM payments
      WHERE payment_type IN ('ADVERTISEMENT', 'ADVERTISEMENT_RENEWAL')`,
  );

  const advertisers = await queryOne<{ total: number }>(
    db,
    `SELECT count(*) AS total FROM advertisers`,
  );

  const topZones = await queryAll<{ name_bn: string; impressions: number; clicks: number }>(
    db,
    `SELECT z.name_bn,
            COALESCE(sum(c.impressions_count), 0) AS impressions,
            COALESCE(sum(c.clicks_count), 0)      AS clicks
       FROM advertisement_zones z
       LEFT JOIN advertisement_campaigns c ON c.zone_id = z.id
      GROUP BY z.id
      ORDER BY impressions DESC
      LIMIT 5`,
  );

  const topAdvertisers = await queryAll<{
    business_name: string;
    campaigns: number;
    spent: number;
  }>(
    db,
    `SELECT a.business_name,
            count(DISTINCT c.id) AS campaigns,
            COALESCE(sum(CASE WHEN p.status = 'PAID' THEN p.amount ELSE 0 END), 0) AS spent
       FROM advertisers a
       LEFT JOIN advertisement_campaigns c ON c.advertiser_id = a.id
       LEFT JOIN payments p ON p.advertisement_id = c.id
      GROUP BY a.id
      ORDER BY spent DESC
      LIMIT 5`,
  );

  return {
    revenueBdt: revenue?.paid ?? 0,
    pendingRevenueBdt: revenue?.pending ?? 0,
    campaigns: totals?.campaigns ?? 0,
    activeCampaigns: totals?.active ?? 0,
    advertisers: advertisers?.total ?? 0,
    impressions: totals?.impressions ?? 0,
    clicks: totals?.clicks ?? 0,
    topZones,
    topAdvertisers,
  };
}
