/**
 * Impression and click recording.
 *
 * Both are deduplicated by the database rather than by application logic: the
 * unique indexes from migration 0004 are what actually stop a refresh loop
 * inflating an advertiser's numbers, so a future caller that forgets to check
 * still cannot double-count.
 *
 * Neither function ever throws into a page render. An advert is decoration on
 * somebody else's content; failing to record a view must never turn a working
 * property page into an error page.
 */
import { batch, execute, isUniqueViolation, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso, todayIsoDate } from "@/lib/time";
import type { AdDevice } from "@/domain/advertising";

export interface TrackContext {
  campaignId: string;
  creativeId?: string | null;
  zoneId: string;
  userId?: string | null;
  /** Salted hash of session or ip+user-agent. Never a raw IP. */
  sessionHash: string;
  device?: AdDevice;
  pagePath?: string | null;
}

/**
 * Records one impression.
 *
 * Returns true only when a NEW row was written, so the counter and the event
 * table can never drift apart. A repeat view from the same visitor on the same
 * day trips the unique index, which is treated as success-already-counted.
 */
export async function recordImpression(
  db: D1Database,
  context: TrackContext,
): Promise<boolean> {
  const now = nowIso();

  try {
    await batch(db, [
      {
        sql: `INSERT INTO advertisement_impressions
                (id, campaign_id, creative_id, zone_id, user_id, session_hash,
                 device, page_path, view_date, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId("imp"),
          context.campaignId,
          context.creativeId ?? null,
          context.zoneId,
          context.userId ?? null,
          context.sessionHash,
          context.device ?? "UNKNOWN",
          context.pagePath?.slice(0, 200) ?? null,
          todayIsoDate(),
          now,
        ],
      },
      {
        // Only reached when the insert above succeeded, because D1 runs a
        // batch as one transaction.
        sql: `UPDATE advertisement_campaigns
                 SET impressions_count = impressions_count + 1, updated_at = ?
               WHERE id = ?`,
        params: [now, context.campaignId],
      },
    ]);
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false; // already counted today
    console.error("[advertising] impression not recorded", error);
    return false;
  }
}

export type ClickOutcome =
  | { ok: true; destinationUrl: string; billable: boolean }
  | { ok: false; reason: "NOT_SERVABLE" };

/**
 * Validates a click and returns where to send the visitor.
 *
 * The destination comes from the DATABASE, never from the request. That is
 * what makes the click endpoint safe: there is no parameter an attacker can
 * set to turn it into an open redirect. The worst they can do is name a
 * campaign id and be sent where that campaign's advertiser already paid to
 * send people.
 *
 * The same eligibility rules as serving apply, so a click on a stale page
 * cannot revive a paused, expired or unpaid campaign.
 */
export async function recordClick(
  db: D1Database,
  context: TrackContext & { ipHash?: string | null; refererPath?: string | null },
): Promise<ClickOutcome> {
  const now = nowIso();

  const campaign = await queryOne<{ destination_url: string; zone_id: string }>(
    db,
    `SELECT COALESCE(cr.destination_url, c.destination_url) AS destination_url,
            c.zone_id
       FROM advertisement_campaigns c
       JOIN payments pay ON pay.id = c.payment_id AND pay.status = 'PAID'
       LEFT JOIN advertisement_creatives cr
              ON cr.id = ? AND cr.campaign_id = c.id
      WHERE c.id = ?
        AND c.status = 'ACTIVE'
        AND c.start_at IS NOT NULL AND c.start_at <= ?
        AND c.end_at   IS NOT NULL AND c.end_at   >  ?`,
    [context.creativeId ?? "", context.campaignId, now, now],
  );

  if (!campaign) return { ok: false, reason: "NOT_SERVABLE" };

  // The first click from a visitor on a given day is billable. A repeat is
  // still recorded — with is_billable = 0 — so click fraud stays visible in
  // the data instead of being silently dropped.
  const billable = await insertClick(db, context, campaign.zone_id, 1);
  if (!billable) await insertClick(db, context, campaign.zone_id, 0);

  if (billable) {
    await execute(
      db,
      `UPDATE advertisement_campaigns
          SET clicks_count = clicks_count + 1, updated_at = ?
        WHERE id = ?`,
      [now, context.campaignId],
    );
  }

  return { ok: true, destinationUrl: campaign.destination_url, billable };
}

async function insertClick(
  db: D1Database,
  context: TrackContext & { ipHash?: string | null; refererPath?: string | null },
  zoneId: string,
  billable: 0 | 1,
): Promise<boolean> {
  try {
    await execute(
      db,
      `INSERT INTO advertisement_clicks
         (id, campaign_id, creative_id, zone_id, user_id, session_hash, ip_hash,
          device, referer_path, click_date, is_billable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("clk"),
        context.campaignId,
        context.creativeId ?? null,
        zoneId,
        context.userId ?? null,
        context.sessionHash,
        context.ipHash ?? null,
        context.device ?? "UNKNOWN",
        context.refererPath?.slice(0, 200) ?? null,
        todayIsoDate(),
        billable,
        nowIso(),
      ],
    );
    return true;
  } catch (error) {
    // The partial unique index on billable clicks is the dedup gate.
    if (isUniqueViolation(error)) return false;
    console.error("[advertising] click not recorded", error);
    return false;
  }
}
