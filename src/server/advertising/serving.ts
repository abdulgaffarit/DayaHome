/**
 * Ad serving.
 *
 * Selecting which banner to show is the one place where a mistake is visible
 * to the whole internet, so the eligibility rules are written once, here, as a
 * single SQL predicate — not spread across callers who might each forget a
 * different one.
 *
 * A campaign is servable only when ALL of these hold:
 *
 *   1. status = 'ACTIVE'          — approval happened, and it is not paused,
 *                                   rejected, expired or cancelled;
 *   2. now is inside [start_at, end_at)  — the window it paid for;
 *   3. the zone matches and the zone is enabled;
 *   4. it has an APPROVED, active creative for the requested device;
 *   5. its payment settled  — `payments.status = 'PAID'`;
 *   6. targeting matches, where targeting is set.
 *
 * Rule 5 is deliberately re-checked at serve time rather than trusted from the
 * status. Status and payment are separate facts, and an advert that runs
 * without a settled payment is revenue quietly lost.
 */
import { queryAll, queryOne } from "@/server/db/client";
import type { AdDevice } from "@/domain/advertising";
import { nowIso } from "@/lib/time";

export interface ServedAd {
  campaignId: string;
  creativeId: string;
  zoneId: string;
  /** R2 object key. The caller builds the image URL; no advertiser HTML exists. */
  objectKey: string;
  altBn: string;
  width: number | null;
  height: number | null;
  /** Where the click endpoint will send the visitor. Never rendered as a raw href. */
  destinationUrl: string;
  priority: number;
  isExclusive: boolean;
}

export interface ServeContext {
  zoneSlug: string;
  device: AdDevice;
  /**
   * The page's location and category, for targeted campaigns. Either the id or
   * the slug may be given: the public property type deliberately exposes only
   * slugs, and widening it just to serve an advert would be the wrong trade.
   */
  locationId?: string | null;
  categoryId?: string | null;
  locationSlug?: string | null;
  categorySlug?: string | null;
  /** Stable per-visitor value; also what makes rotation deterministic. */
  sessionHash?: string | null;
}

interface CandidateRow {
  campaign_id: string;
  creative_id: string;
  zone_id: string;
  object_key: string;
  alt_bn: string;
  width: number | null;
  height: number | null;
  destination_url: string;
  priority: number;
  is_exclusive: number;
}

/**
 * Every campaign eligible to appear in this zone right now.
 *
 * The device match is worth reading carefully: a campaign targeting ALL is
 * eligible on any device, and a creative is chosen for the requesting device
 * with the DESKTOP variant as the fallback when no MOBILE banner was uploaded.
 */
async function findCandidates(db: D1Database, context: ServeContext): Promise<CandidateRow[]> {
  const now = nowIso();
  const device = context.device === "UNKNOWN" ? "DESKTOP" : context.device;

  return queryAll<CandidateRow>(
    db,
    `SELECT c.id AS campaign_id,
            cr.id AS creative_id,
            c.zone_id,
            cr.object_key,
            cr.alt_bn,
            cr.width,
            cr.height,
            COALESCE(cr.destination_url, c.destination_url) AS destination_url,
            c.priority,
            c.is_exclusive
       FROM advertisement_campaigns c
       JOIN advertisement_zones z ON z.id = c.zone_id AND z.is_enabled = 1
       JOIN advertisement_creatives cr
         ON cr.campaign_id = c.id
        AND cr.is_active = 1
        AND cr.status = 'APPROVED'
        AND cr.variant = (
              CASE WHEN ? = 'MOBILE'
                        AND EXISTS (SELECT 1 FROM advertisement_creatives m
                                     WHERE m.campaign_id = c.id AND m.variant = 'MOBILE'
                                       AND m.is_active = 1 AND m.status = 'APPROVED')
                   THEN 'MOBILE' ELSE 'DESKTOP' END)
       JOIN payments pay ON pay.id = c.payment_id AND pay.status = 'PAID'
      WHERE z.slug = ?
        AND c.status = 'ACTIVE'
        AND c.start_at IS NOT NULL AND c.start_at <= ?
        AND c.end_at   IS NOT NULL AND c.end_at   >  ?
        AND (c.target_device = 'ALL' OR c.target_device = ?)
        AND (c.target_location_id IS NULL
             OR c.target_location_id = ?
             OR c.target_location_id = (SELECT id FROM locations  WHERE slug = ?))
        AND (c.target_category_id IS NULL
             OR c.target_category_id = ?
             OR c.target_category_id = (SELECT id FROM categories WHERE slug = ?))
      ORDER BY c.is_exclusive DESC, c.priority DESC, c.id ASC`,
    [
      device,
      context.zoneSlug,
      now,
      now,
      device,
      context.locationId ?? null,
      context.locationSlug ?? null,
      context.categoryId ?? null,
      context.categorySlug ?? null,
    ],
  );
}

/**
 * Picks one advert for this zone.
 *
 * Rotation is weighted and deterministic per visitor-and-hour:
 *
 *   * an exclusive campaign takes the zone alone — that is what exclusivity
 *     was sold as;
 *   * otherwise each campaign gets `priority + 1` tickets, so a premium
 *     package appears more often than a basic one WITHOUT ever monopolising:
 *     every eligible campaign keeps a non-zero share;
 *   * the winning ticket is chosen from a hash of (visitor, zone, hour), so a
 *     single visitor sees a stable advert while reloading a page, different
 *     visitors see different adverts, and everyone's rotates each hour.
 *
 * Deterministic rather than random on purpose: it makes the choice reproducible
 * in a test, and it stops a refresh loop from cycling adverts to inflate
 * impressions.
 */
export async function selectAd(
  db: D1Database,
  context: ServeContext,
): Promise<ServedAd | null> {
  const candidates = await findCandidates(db, context);
  if (candidates.length === 0) return null;

  // Exclusivity: the ORDER BY already put exclusive campaigns first.
  const exclusive = candidates.filter((row) => row.is_exclusive === 1);
  const pool = exclusive.length > 0 ? exclusive : candidates;

  const tickets = pool.reduce((sum, row) => sum + row.priority + 1, 0);
  const roll = rotationSeed(context) % tickets;

  let cursor = 0;
  for (const row of pool) {
    cursor += row.priority + 1;
    if (roll < cursor) return toServedAd(row);
  }
  // Unreachable while tickets > 0; kept so the function is total.
  return toServedAd(pool[0]);
}

/** Several adverts for a zone that shows more than one, without repeats. */
export async function selectAds(
  db: D1Database,
  context: ServeContext,
  count: number,
): Promise<ServedAd[]> {
  const candidates = await findCandidates(db, context);
  if (candidates.length === 0 || count <= 0) return [];

  const exclusive = candidates.filter((row) => row.is_exclusive === 1);
  if (exclusive.length > 0) return [toServedAd(exclusive[0])];

  // Rotate the starting offset so the same campaign is not always first.
  const offset = rotationSeed(context) % candidates.length;
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  return ordered.slice(0, count).map(toServedAd);
}

function toServedAd(row: CandidateRow): ServedAd {
  return {
    campaignId: row.campaign_id,
    creativeId: row.creative_id,
    zoneId: row.zone_id,
    objectKey: row.object_key,
    altBn: row.alt_bn,
    width: row.width,
    height: row.height,
    destinationUrl: row.destination_url,
    priority: row.priority,
    isExclusive: row.is_exclusive === 1,
  };
}

/**
 * A stable non-negative integer for (visitor, zone, hour).
 *
 * A plain string hash is enough: this decides which advert to show, not
 * anything security-sensitive, and it must be cheap because it runs on every
 * page render.
 */
export function rotationSeed(context: ServeContext, at: Date = new Date()): number {
  const hourBucket = at.toISOString().slice(0, 13);
  const input = `${context.sessionHash ?? "anon"}|${context.zoneSlug}|${hourBucket}`;

  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** The enabled zone for a slug, so a page can skip rendering a disabled one. */
export async function getServableZone(
  db: D1Database,
  slug: string,
): Promise<{ id: string; slug: string; max_active_ads: number } | null> {
  return queryOne(
    db,
    `SELECT id, slug, max_active_ads FROM advertisement_zones
      WHERE slug = ? AND is_enabled = 1`,
    [slug],
  );
}
