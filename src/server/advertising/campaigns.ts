/**
 * Campaign lifecycle.
 *
 * Invariants enforced here, mirroring the ones the payment layer already has:
 *
 *   1. Price, duration, priority and exclusivity are copied from the package
 *      row on the server. No request body can influence what a campaign costs
 *      or how much rotation weight it gets.
 *   2. Paying for a campaign never publishes it. Settlement moves the campaign
 *      to PENDING_REVIEW; only `approveCampaign` opens the serving window.
 *   3. Every transition goes through `CAMPAIGN_TRANSITIONS`, and each write is
 *      a conditional `UPDATE ... WHERE status = ?`, so a replayed request or a
 *      race changes the row at most once.
 *   4. A rejection carries a reason — enforced by the service and again by a
 *      CHECK constraint, so no code path can produce a reasonless rejection.
 *   5. Advertiser-scoped reads always carry `AND advertiser_id = ?`.
 */
import type { CampaignStatus, AdTargetDevice } from "@/domain/advertising";
import { canTransition } from "@/domain/advertising";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { DAY, nowIso } from "@/lib/time";

export interface CampaignRow {
  id: string;
  public_ref: number;
  advertiser_id: string;
  zone_id: string;
  package_id: string | null;
  payment_id: string | null;
  title: string;
  destination_url: string;
  status: CampaignStatus;
  price_bdt: number;
  currency: string;
  duration_days: number;
  priority: number;
  is_exclusive: number;
  requested_start_at: string | null;
  start_at: string | null;
  end_at: string | null;
  target_location_id: string | null;
  target_category_id: string | null;
  target_device: AdTargetDevice;
  rejection_reason: string | null;
  renewed_from_id: string | null;
  renewal_count: number;
  impressions_count: number;
  clicks_count: number;
  created_at: string;
}

const COLUMNS = `id, public_ref, advertiser_id, zone_id, package_id, payment_id, title,
                 destination_url, status, price_bdt, currency, duration_days, priority,
                 is_exclusive, requested_start_at, start_at, end_at, target_location_id,
                 target_category_id, target_device, rejection_reason, renewed_from_id,
                 renewal_count, impressions_count, clicks_count, created_at`;

export interface CreateCampaignInput {
  advertiserId: string;
  zoneId: string;
  packageId: string;
  title: string;
  destinationUrl: string;
  requestedStartAt?: string | null;
  targetLocationId?: string | null;
  targetCategoryId?: string | null;
  targetDevice?: AdTargetDevice;
}

export type CreateCampaignResult =
  | { ok: true; campaign: CampaignRow }
  | { ok: false; reason: "UNKNOWN_PACKAGE" | "UNKNOWN_ZONE" | "ZONE_DISABLED" | "PACKAGE_ZONE_MISMATCH" };

interface PackageRow {
  id: string;
  zone_id: string | null;
  duration_days: number;
  price_bdt: number;
  priority: number;
  is_exclusive: number;
  is_active: number;
}

/**
 * Creates a DRAFT campaign.
 *
 * Note what is NOT a parameter: price, duration, priority and exclusivity.
 * They are read from the package row, so the cost of a campaign is decided
 * entirely on the server — the same rule the contact-unlock price follows.
 */
export async function createCampaign(
  db: D1Database,
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const pkg = await queryOne<PackageRow>(
    db,
    `SELECT id, zone_id, duration_days, price_bdt, priority, is_exclusive, is_active
       FROM advertisement_packages WHERE id = ? AND is_active = 1`,
    [input.packageId],
  );
  if (!pkg) return { ok: false, reason: "UNKNOWN_PACKAGE" };

  const zone = await queryOne<{ id: string; is_enabled: number }>(
    db,
    `SELECT id, is_enabled FROM advertisement_zones WHERE id = ?`,
    [input.zoneId],
  );
  if (!zone) return { ok: false, reason: "UNKNOWN_ZONE" };
  if (zone.is_enabled !== 1) return { ok: false, reason: "ZONE_DISABLED" };

  // A package tied to one placement cannot be redirected to a cheaper zone.
  if (pkg.zone_id && pkg.zone_id !== input.zoneId) {
    return { ok: false, reason: "PACKAGE_ZONE_MISMATCH" };
  }

  const refRow = await queryOne<{ value: number }>(
    db,
    `UPDATE sequences SET value = value + 1 WHERE name = 'ad_campaign_ref' RETURNING value`,
  );
  const id = newId("adc");
  const now = nowIso();

  await execute(
    db,
    `INSERT INTO advertisement_campaigns
       (id, public_ref, advertiser_id, zone_id, package_id, title, destination_url,
        status, price_bdt, currency, duration_days, priority, is_exclusive,
        requested_start_at, target_location_id, target_category_id, target_device,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'BDT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      refRow!.value,
      input.advertiserId,
      input.zoneId,
      pkg.id,
      input.title,
      input.destinationUrl,
      // ---- server-decided, from the package ----
      pkg.price_bdt,
      pkg.duration_days,
      pkg.priority,
      pkg.is_exclusive,
      // ------------------------------------------
      input.requestedStartAt ?? null,
      input.targetLocationId ?? null,
      input.targetCategoryId ?? null,
      input.targetDevice ?? "ALL",
      now,
      now,
    ],
  );

  return { ok: true, campaign: (await getCampaignById(db, id))! };
}

export async function getCampaignById(db: D1Database, id: string): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(
    db,
    `SELECT ${COLUMNS} FROM advertisement_campaigns WHERE id = ?`,
    [id],
  );
}

/**
 * A campaign, but only if it belongs to this advertiser.
 *
 * The ownership predicate is part of the query rather than a check on the
 * result, so there is no shape of caller mistake that returns someone else's
 * row.
 */
export async function getOwnedCampaign(
  db: D1Database,
  advertiserId: string,
  campaignId: string,
): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(
    db,
    `SELECT ${COLUMNS} FROM advertisement_campaigns WHERE id = ? AND advertiser_id = ?`,
    [campaignId, advertiserId],
  );
}

export async function listCampaignsForAdvertiser(
  db: D1Database,
  advertiserId: string,
): Promise<CampaignRow[]> {
  return queryAll<CampaignRow>(
    db,
    `SELECT ${COLUMNS} FROM advertisement_campaigns
      WHERE advertiser_id = ? ORDER BY created_at DESC`,
    [advertiserId],
  );
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" | "ILLEGAL_TRANSITION" | "REASON_REQUIRED" };

/**
 * The single writer for `status`.
 *
 * The legality check runs against the table in src/domain/advertising.ts, and
 * the UPDATE is conditional on the status we read — so if another request moved
 * the campaign in between, this one reports ILLEGAL_TRANSITION rather than
 * overwriting the newer state.
 */
async function transition(
  db: D1Database,
  campaignId: string,
  to: CampaignStatus,
  extraSql = "",
  extraParams: (string | number | null)[] = [],
): Promise<TransitionResult> {
  const current = await queryOne<{ status: CampaignStatus }>(
    db,
    `SELECT status FROM advertisement_campaigns WHERE id = ?`,
    [campaignId],
  );
  if (!current) return { ok: false, reason: "NOT_FOUND" };
  if (!canTransition(current.status, to)) return { ok: false, reason: "ILLEGAL_TRANSITION" };

  const result = await execute(
    db,
    `UPDATE advertisement_campaigns
        SET status = ?${extraSql ? `, ${extraSql}` : ""}, updated_at = ?
      WHERE id = ? AND status = ?`,
    [to, ...extraParams, nowIso(), campaignId, current.status],
  );

  return changes(result) === 1 ? { ok: true } : { ok: false, reason: "ILLEGAL_TRANSITION" };
}

/** Exposed for the admin screens and tests; the guarded transitions below are preferred. */
export const transitionCampaign = transition;

/** Submits a campaign for review after payment has settled. */
export async function submitForReview(
  db: D1Database,
  campaignId: string,
): Promise<TransitionResult> {
  return transition(db, campaignId, "PENDING_REVIEW");
}

/**
 * Staff approval. This is the only function that opens a serving window.
 *
 * The window starts at the advertiser's requested date when that is still in
 * the future, otherwise now, and runs for the duration bought.
 */
export async function approveCampaign(
  db: D1Database,
  args: { campaignId: string; adminId: string; startAt?: string },
): Promise<TransitionResult> {
  const campaign = await getCampaignById(db, args.campaignId);
  if (!campaign) return { ok: false, reason: "NOT_FOUND" };

  const now = nowIso();
  const requested = args.startAt ?? campaign.requested_start_at;
  const start = requested && Date.parse(requested) > Date.now() ? requested : now;
  const end = nowIso(new Date(Date.parse(start) + campaign.duration_days * DAY));

  // Approving a future-dated campaign parks it in SCHEDULED; the activation
  // sweep starts it when its window opens.
  const target: CampaignStatus = Date.parse(start) > Date.now() ? "SCHEDULED" : "ACTIVE";

  const result = await transition(
    db,
    args.campaignId,
    "APPROVED",
    `reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL`,
    [args.adminId, now],
  );
  if (!result.ok) return result;

  return transition(
    db,
    args.campaignId,
    target,
    `start_at = ?, end_at = ?${target === "ACTIVE" ? ", activated_at = ?" : ""}`,
    target === "ACTIVE" ? [start, end, now] : [start, end],
  );
}

/** Staff rejection. A reason is mandatory and is shown to the advertiser. */
export async function rejectCampaign(
  db: D1Database,
  args: { campaignId: string; adminId: string; reason: string },
): Promise<TransitionResult> {
  const reason = args.reason.trim();
  if (!reason) return { ok: false, reason: "REASON_REQUIRED" };

  return transition(
    db,
    args.campaignId,
    "REJECTED",
    `rejection_reason = ?, reviewed_by = ?, reviewed_at = ?`,
    [reason.slice(0, 500), args.adminId, nowIso()],
  );
}

export async function pauseCampaign(
  db: D1Database,
  args: { campaignId: string; byUserId: string; reason?: string },
): Promise<TransitionResult> {
  return transition(
    db,
    args.campaignId,
    "PAUSED",
    `paused_at = ?, paused_by = ?, pause_reason = ?`,
    [nowIso(), args.byUserId, args.reason?.slice(0, 500) ?? null],
  );
}

/**
 * Resume.
 *
 * A campaign whose window has already closed while paused goes to EXPIRED
 * rather than back on the page — resuming must not resurrect a finished
 * campaign. One that has not started yet returns to SCHEDULED.
 */
export async function resumeCampaign(
  db: D1Database,
  campaignId: string,
): Promise<TransitionResult> {
  const campaign = await getCampaignById(db, campaignId);
  if (!campaign) return { ok: false, reason: "NOT_FOUND" };

  const now = Date.now();
  if (campaign.end_at && Date.parse(campaign.end_at) <= now) {
    return transition(db, campaignId, "EXPIRED", `expired_at = ?`, [nowIso()]);
  }
  const target: CampaignStatus =
    campaign.start_at && Date.parse(campaign.start_at) > now ? "SCHEDULED" : "ACTIVE";

  return transition(
    db,
    campaignId,
    target,
    `paused_at = NULL, paused_by = NULL, pause_reason = NULL`,
  );
}

export async function cancelCampaign(
  db: D1Database,
  campaignId: string,
): Promise<TransitionResult> {
  return transition(db, campaignId, "CANCELLED", `cancelled_at = ?`, [nowIso()]);
}

/**
 * Starts campaigns whose window has opened and ends those whose window has
 * closed. Safe to call repeatedly — both statements are status-conditional —
 * and intended for a scheduled Worker.
 */
export async function runCampaignSchedule(
  db: D1Database,
): Promise<{ activated: number; expired: number }> {
  const now = nowIso();

  const activated = await execute(
    db,
    `UPDATE advertisement_campaigns
        SET status = 'ACTIVE', activated_at = COALESCE(activated_at, ?), updated_at = ?
      WHERE status = 'SCHEDULED' AND start_at <= ? AND end_at > ?`,
    [now, now, now, now],
  );

  const expired = await execute(
    db,
    `UPDATE advertisement_campaigns
        SET status = 'EXPIRED', expired_at = ?, updated_at = ?
      WHERE status IN ('ACTIVE','SCHEDULED','PAUSED') AND end_at IS NOT NULL AND end_at <= ?`,
    [now, now, now],
  );

  return { activated: changes(activated), expired: changes(expired) };
}

/* -------------------------------------------------------------------------- */
/* Renewal                                                                     */
/* -------------------------------------------------------------------------- */

export type RenewResult =
  | { ok: true; campaign: CampaignRow }
  | { ok: false; reason: "NOT_FOUND" | "NOT_RENEWABLE" | "UNKNOWN_PACKAGE" };

/**
 * Renews a finished campaign.
 *
 * A renewal is a NEW campaign row that points back at the one it continues,
 * rather than an edit that extends the old window. That keeps each period's
 * price, dates and statistics intact, and means a renewal is paid for and
 * reviewed like any other campaign.
 */
export async function renewCampaign(
  db: D1Database,
  args: { campaignId: string; advertiserId: string; packageId?: string; requestedStartAt?: string },
): Promise<RenewResult> {
  const previous = await getOwnedCampaign(db, args.advertiserId, args.campaignId);
  if (!previous) return { ok: false, reason: "NOT_FOUND" };

  // Only a campaign that actually ran can be renewed. A rejected or cancelled
  // one is started afresh instead.
  if (previous.status !== "EXPIRED" && previous.status !== "ACTIVE") {
    return { ok: false, reason: "NOT_RENEWABLE" };
  }

  const packageId = args.packageId ?? previous.package_id;
  if (!packageId) return { ok: false, reason: "UNKNOWN_PACKAGE" };

  // Prices are re-read from the package, so a renewal is charged at today's
  // rate rather than at whatever the campaign was originally sold for.
  const created = await createCampaign(db, {
    advertiserId: previous.advertiser_id,
    zoneId: previous.zone_id,
    packageId,
    title: previous.title,
    destinationUrl: previous.destination_url,
    requestedStartAt: args.requestedStartAt ?? previous.end_at,
    targetLocationId: previous.target_location_id,
    targetCategoryId: previous.target_category_id,
    targetDevice: previous.target_device,
  });
  if (!created.ok) return { ok: false, reason: "UNKNOWN_PACKAGE" };

  await execute(
    db,
    `UPDATE advertisement_campaigns
        SET renewed_from_id = ?, renewal_count = ?, updated_at = ?
      WHERE id = ?`,
    [previous.id, previous.renewal_count + 1, nowIso(), created.campaign.id],
  );

  return { ok: true, campaign: (await getCampaignById(db, created.campaign.id))! };
}
