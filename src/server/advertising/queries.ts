/**
 * Reads for the advertiser flow.
 *
 * Two kinds of query live here and they must not be confused:
 *
 *   * PUBLIC catalogue reads — the zones and packages on offer. These carry no
 *     advertiser data at all.
 *   * OWNER-SCOPED reads — everything about campaigns. Every one of these takes
 *     `advertiserId` and puts it in the WHERE clause, never in a post-filter,
 *     so there is no shape of caller mistake that returns another advertiser's
 *     rows.
 */
import { queryAll, queryOne } from "@/server/db/client";
import type { CampaignStatus } from "@/domain/advertising";

/* -------------------------------------------------------------------------- */
/* Public catalogue                                                            */
/* -------------------------------------------------------------------------- */

export interface ZoneOption {
  id: string;
  slug: string;
  name_bn: string;
  description_bn: string | null;
  desktop_size: string;
  mobile_size: string | null;
  base_price_bdt: number;
  max_active_ads: number;
}

/** Placements a business may buy. Disabled zones are never offered. */
export async function listPurchasableZones(db: D1Database): Promise<ZoneOption[]> {
  return queryAll<ZoneOption>(
    db,
    `SELECT id, slug, name_bn, description_bn, desktop_size, mobile_size,
            base_price_bdt, max_active_ads
       FROM advertisement_zones
      WHERE is_enabled = 1
      ORDER BY sort_order ASC`,
  );
}

export interface PackageOption {
  id: string;
  slug: string;
  name_bn: string;
  description_bn: string | null;
  zone_id: string | null;
  duration_days: number;
  price_bdt: number;
  max_creatives: number;
  is_exclusive: number;
}

/** Packages on sale. An inactive package is not purchasable and is not listed. */
export async function listPurchasablePackages(db: D1Database): Promise<PackageOption[]> {
  return queryAll<PackageOption>(
    db,
    `SELECT id, slug, name_bn, description_bn, zone_id, duration_days, price_bdt,
            max_creatives, is_exclusive
       FROM advertisement_packages
      WHERE is_active = 1
      ORDER BY sort_order ASC`,
  );
}

/* -------------------------------------------------------------------------- */
/* Owner-scoped campaign reads                                                 */
/* -------------------------------------------------------------------------- */

export interface CampaignSummary {
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
  pause_reason: string | null;
  created_at: string;
  zone_name_bn: string;
  zone_slug: string;
  package_name_bn: string | null;
  impressions: number;
  clicks: number;
  payment_status: string | null;
  gateway: string | null;
}

/**
 * The list query.
 *
 * Impressions and clicks come from the campaign's denormalised counters rather
 * than from COUNT(*) over the event tables: a dashboard listing twenty
 * campaigns would otherwise run forty aggregate scans.
 */
const SUMMARY_SELECT = `
  SELECT c.id, c.public_ref, c.title, c.status, c.destination_url, c.price_bdt,
         c.duration_days, c.start_at, c.end_at, c.rejection_reason, c.pause_reason,
         c.created_at,
         z.name_bn  AS zone_name_bn,
         z.slug     AS zone_slug,
         pk.name_bn AS package_name_bn,
         c.impressions_count AS impressions,
         c.clicks_count      AS clicks,
         pay.status  AS payment_status,
         pay.gateway AS gateway
    FROM advertisement_campaigns c
    JOIN advertisement_zones z         ON z.id  = c.zone_id
    LEFT JOIN advertisement_packages pk ON pk.id = c.package_id
    LEFT JOIN payments pay              ON pay.id = c.payment_id`;

export async function listAdvertiserCampaigns(
  db: D1Database,
  advertiserId: string,
): Promise<CampaignSummary[]> {
  return queryAll<CampaignSummary>(
    db,
    `${SUMMARY_SELECT} WHERE c.advertiser_id = ? ORDER BY c.created_at DESC`,
    [advertiserId],
  );
}

/** One campaign, scoped to its owner. Returns null for anyone else's. */
export async function getAdvertiserCampaign(
  db: D1Database,
  advertiserId: string,
  campaignId: string,
): Promise<CampaignSummary | null> {
  return queryOne<CampaignSummary>(
    db,
    `${SUMMARY_SELECT} WHERE c.id = ? AND c.advertiser_id = ?`,
    [campaignId, advertiserId],
  );
}

/**
 * Click-through rate as a percentage.
 *
 * Zero impressions yields 0, not NaN or Infinity — a brand-new campaign is the
 * normal case, not an error.
 */
export function ctr(impressions: number, clicks: number): number {
  if (!impressions || impressions <= 0) return 0;
  return Math.round((clicks / impressions) * 1000) / 10;
}

/** Campaigns grouped for the dashboard's sections. */
export interface CampaignGroups {
  active: CampaignSummary[];
  scheduled: CampaignSummary[];
  pending: CampaignSummary[];
  paused: CampaignSummary[];
  expired: CampaignSummary[];
  rejected: CampaignSummary[];
  draft: CampaignSummary[];
}

export function groupCampaigns(rows: CampaignSummary[]): CampaignGroups {
  const groups: CampaignGroups = {
    active: [], scheduled: [], pending: [], paused: [],
    expired: [], rejected: [], draft: [],
  };

  for (const row of rows) {
    switch (row.status) {
      case "ACTIVE": groups.active.push(row); break;
      case "SCHEDULED": groups.scheduled.push(row); break;
      case "PAUSED": groups.paused.push(row); break;
      case "EXPIRED": groups.expired.push(row); break;
      case "REJECTED": groups.rejected.push(row); break;
      case "DRAFT": groups.draft.push(row); break;
      // Everything between payment and approval is "in progress" to the
      // advertiser; the precise internal state is shown on the detail page.
      default: groups.pending.push(row); break;
    }
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export interface AdvertiserPayment {
  id: string;
  transaction_id: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  payment_type: string;
  description: string | null;
  created_at: string;
  paid_at: string | null;
  campaign_title: string | null;
  campaign_ref: number | null;
}

/**
 * The advertiser's payment history.
 *
 * Scoped by joining through the campaign to the advertiser, so a payment is
 * only visible to the advertiser whose campaign it belongs to — not to whoever
 * happens to share the user account.
 */
export async function listAdvertiserPayments(
  db: D1Database,
  advertiserId: string,
): Promise<AdvertiserPayment[]> {
  return queryAll<AdvertiserPayment>(
    db,
    `SELECT p.id, p.transaction_id, p.amount, p.currency, p.gateway, p.status,
            p.payment_type, p.description, p.created_at, p.paid_at,
            c.title AS campaign_title, c.public_ref AS campaign_ref
       FROM payments p
       JOIN advertisement_campaigns c ON c.id = p.advertisement_id
      WHERE c.advertiser_id = ?
      ORDER BY p.created_at DESC`,
    [advertiserId],
  );
}

/** Headline numbers for the dashboard. */
export interface AdvertiserStats {
  campaigns: number;
  active: number;
  impressions: number;
  clicks: number;
  spentBdt: number;
}

export async function getAdvertiserStats(
  db: D1Database,
  advertiserId: string,
): Promise<AdvertiserStats> {
  const row = await queryOne<{
    campaigns: number;
    active: number;
    impressions: number;
    clicks: number;
  }>(
    db,
    `SELECT count(*) AS campaigns,
            sum(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
            COALESCE(sum(impressions_count), 0) AS impressions,
            COALESCE(sum(clicks_count), 0) AS clicks
       FROM advertisement_campaigns WHERE advertiser_id = ?`,
    [advertiserId],
  );

  // Only settled payments count as money spent.
  const spent = await queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(sum(p.amount), 0) AS total
       FROM payments p
       JOIN advertisement_campaigns c ON c.id = p.advertisement_id
      WHERE c.advertiser_id = ? AND p.status = 'PAID'`,
    [advertiserId],
  );

  return {
    campaigns: row?.campaigns ?? 0,
    active: row?.active ?? 0,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    spentBdt: spent?.total ?? 0,
  };
}
