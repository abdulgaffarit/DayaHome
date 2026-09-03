/**
 * Banner creatives.
 *
 * A creative is an image plus alternative text. It is deliberately NOT markup:
 * there is no field here, and no column in the schema, that could carry HTML,
 * a script, or a third-party ad tag. An advertiser therefore has no channel
 * through which to inject anything into a page.
 *
 * The upload path reuses the property-image validation wholesale — magic-byte
 * sniffing and server-generated object keys — rather than reimplementing it.
 * The client-supplied filename and Content-Type are ignored entirely.
 */
import {
  buildObjectKey,
  readDimensions,
  sniffImageType,
  type AllowedMime,
} from "@/server/storage/images";
import type { CreativeVariant } from "@/domain/advertising";
import { execute, queryAll, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/** Banners are display assets, not photo galleries; 2 MB is generous. */
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;

/** Enough for two variants plus a spare, unless the package says otherwise. */
export const DEFAULT_MAX_CREATIVES = 2;

export interface CreativeRow {
  id: string;
  campaign_id: string;
  variant: CreativeVariant;
  object_key: string;
  mime_type: AllowedMime;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_bn: string;
  destination_url: string | null;
  status: string;
  rejection_reason: string | null;
  is_active: number;
  sort_order: number;
}

const COLUMNS = `id, campaign_id, variant, object_key, mime_type, size_bytes, width,
                 height, alt_bn, destination_url, status, rejection_reason,
                 is_active, sort_order`;

export type AddCreativeResult =
  | { ok: true; creative: CreativeRow }
  | {
      ok: false;
      reason:
        | "NOT_FOUND"
        | "NOT_EDITABLE"
        | "TOO_LARGE"
        | "EMPTY"
        | "UNSUPPORTED_TYPE"
        | "TOO_MANY";
    };

/** Statuses in which an advertiser may still change the artwork. */
const EDITABLE_STATUSES = ["DRAFT", "PENDING_PAYMENT", "PAID", "PENDING_REVIEW", "REJECTED"];

/**
 * Validates and stores one banner.
 *
 * `advertiserId` is a query predicate, so a signed-in user cannot attach a
 * banner to somebody else's campaign. The bytes are written to R2 only after
 * they have been recognised as a real JPEG, PNG or WebP.
 */
export async function addCreative(
  db: D1Database,
  bucket: R2Bucket,
  args: {
    advertiserId: string;
    campaignId: string;
    uploadedBy: string;
    variant: CreativeVariant;
    altBn: string;
    bytes: Uint8Array;
  },
): Promise<AddCreativeResult> {
  const campaign = await queryOne<{ id: string; status: string; package_id: string | null }>(
    db,
    `SELECT id, status, package_id FROM advertisement_campaigns
      WHERE id = ? AND advertiser_id = ?`,
    [args.campaignId, args.advertiserId],
  );
  if (!campaign) return { ok: false, reason: "NOT_FOUND" };

  // An approved or running campaign cannot have its artwork swapped: the
  // banner on the page must be the one that was reviewed.
  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return { ok: false, reason: "NOT_EDITABLE" };
  }

  if (args.bytes.length === 0) return { ok: false, reason: "EMPTY" };
  if (args.bytes.length > MAX_BANNER_BYTES) return { ok: false, reason: "TOO_LARGE" };

  // The real content type, from the bytes. A .png extension on a PHP file, or
  // an image/webp Content-Type on an SVG, gets no further than this.
  const sniffed = sniffImageType(args.bytes);
  if (!sniffed.ok) return { ok: false, reason: "UNSUPPORTED_TYPE" };

  const limit = await creativeLimitFor(db, campaign.package_id);
  const existing = await queryOne<{ c: number }>(
    db,
    `SELECT count(*) AS c FROM advertisement_creatives WHERE campaign_id = ?`,
    [args.campaignId],
  );
  if ((existing?.c ?? 0) >= limit) return { ok: false, reason: "TOO_MANY" };

  // Entirely server-generated: no part of the advertiser's filename survives,
  // which removes path traversal and key collision outright.
  const objectKey = buildObjectKey(args.uploadedBy, sniffed.ext, "ads");
  const dimensions = readDimensions(args.bytes, sniffed.mime);

  await bucket.put(objectKey, args.bytes as unknown as ArrayBuffer, {
    httpMetadata: {
      contentType: sniffed.mime,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: { uploadedBy: args.uploadedBy, campaignId: args.campaignId },
  });

  const id = newId("crv");
  const now = nowIso();
  await execute(
    db,
    `INSERT INTO advertisement_creatives
       (id, campaign_id, uploaded_by, variant, object_key, mime_type, size_bytes,
        width, height, alt_bn, status, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', 1, ?, ?, ?)`,
    [
      id,
      args.campaignId,
      args.uploadedBy,
      args.variant,
      objectKey,
      sniffed.mime,
      args.bytes.length,
      dimensions?.width ?? null,
      dimensions?.height ?? null,
      args.altBn.slice(0, 200),
      existing?.c ?? 0,
      now,
      now,
    ],
  );

  return { ok: true, creative: (await getCreative(db, id))! };
}

async function creativeLimitFor(db: D1Database, packageId: string | null): Promise<number> {
  if (!packageId) return DEFAULT_MAX_CREATIVES;
  const row = await queryOne<{ max_creatives: number }>(
    db,
    `SELECT max_creatives FROM advertisement_packages WHERE id = ?`,
    [packageId],
  );
  return row?.max_creatives ?? DEFAULT_MAX_CREATIVES;
}

export async function getCreative(db: D1Database, id: string): Promise<CreativeRow | null> {
  return queryOne<CreativeRow>(
    db,
    `SELECT ${COLUMNS} FROM advertisement_creatives WHERE id = ?`,
    [id],
  );
}

export async function listCreatives(
  db: D1Database,
  campaignId: string,
): Promise<CreativeRow[]> {
  return queryAll<CreativeRow>(
    db,
    `SELECT ${COLUMNS} FROM advertisement_creatives
      WHERE campaign_id = ? ORDER BY variant ASC, sort_order ASC`,
    [campaignId],
  );
}

/**
 * Removes a banner the advertiser has not yet submitted for review.
 *
 * The R2 object is deleted only after the row is gone: an orphaned object
 * costs a fraction of a penny, whereas a row pointing at a deleted object
 * renders a broken advert on a page someone paid for.
 */
export async function removeCreative(
  db: D1Database,
  bucket: R2Bucket,
  args: { advertiserId: string; creativeId: string },
): Promise<boolean> {
  const row = await queryOne<{ object_key: string; status: string }>(
    db,
    `SELECT c.object_key, camp.status
       FROM advertisement_creatives c
       JOIN advertisement_campaigns camp ON camp.id = c.campaign_id
      WHERE c.id = ? AND camp.advertiser_id = ?`,
    [args.creativeId, args.advertiserId],
  );
  if (!row || !EDITABLE_STATUSES.includes(row.status)) return false;

  await execute(db, `DELETE FROM advertisement_creatives WHERE id = ?`, [args.creativeId]);
  try {
    await bucket.delete(row.object_key);
  } catch (error) {
    console.error("[advertising] failed to delete banner object", row.object_key, error);
  }
  return true;
}

/** Staff decision on one banner. A rejection must say why. */
export async function reviewCreative(
  db: D1Database,
  args: { creativeId: string; adminId: string; approve: boolean; reason?: string },
): Promise<boolean> {
  if (!args.approve && !args.reason?.trim()) return false;

  const result = await execute(
    db,
    `UPDATE advertisement_creatives
        SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      args.approve ? "APPROVED" : "REJECTED",
      args.approve ? null : args.reason!.trim().slice(0, 500),
      args.adminId,
      nowIso(),
      nowIso(),
      args.creativeId,
    ],
  );
  return (result.meta?.changes ?? 0) === 1;
}
