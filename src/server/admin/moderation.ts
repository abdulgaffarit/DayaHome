/**
 * Listing moderation.
 *
 * Every function takes the acting admin's id, writes an `admin_logs` entry, and
 * notifies the owner. Approval is the only path by which a listing becomes
 * publicly visible.
 */
import type { PropertyStatus } from "@/domain/enums";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { DAY, isoPlus, nowIso } from "@/lib/time";
import { notify } from "@/server/notifications/notify";
import { recordAdminAction } from "./audit";
import { DEFAULT_LISTING_DAYS } from "@/server/properties/mutations";

interface OwnerRef {
  owner_id: string;
  title: string;
  slug: string;
}

export async function approveProperty(
  db: D1Database,
  adminId: string,
  propertyId: string,
  opts: { ipHash?: string | null; listingDays?: number } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const property = await queryOne<OwnerRef>(
    db,
    `SELECT owner_id, title, slug FROM properties WHERE id = ?`,
    [propertyId],
  );
  if (!property) return { ok: false, reason: "NOT_FOUND" };

  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE properties
        SET status = 'APPROVED',
            rejection_reason = NULL,
            approved_by = ?, approved_at = ?,
            published_at = COALESCE(published_at, ?),
            expires_at = ?,
            updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'REJECTED', 'PAUSED', 'EXPIRED')`,
    [
      adminId,
      now,
      now,
      isoPlus((opts.listingDays ?? DEFAULT_LISTING_DAYS) * DAY),
      now,
      propertyId,
    ],
  );
  if (changes(result) !== 1) return { ok: false, reason: "INVALID_STATE" };

  await recordAdminAction(db, {
    adminId,
    action: "PROPERTY_APPROVED",
    entityType: "property",
    entityId: propertyId,
    metadata: { title: property.title },
    ipHash: opts.ipHash,
  });
  await notify(db, {
    userId: property.owner_id,
    type: "LISTING_APPROVED",
    titleBn: "বিজ্ঞাপন অনুমোদিত হয়েছে",
    bodyBn: `"${property.title}" এখন সাইটে দেখা যাচ্ছে।`,
    link: `/property/${property.slug}`,
    entityType: "property",
    entityId: propertyId,
  });
  return { ok: true };
}

export async function rejectProperty(
  db: D1Database,
  adminId: string,
  propertyId: string,
  reason: string,
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const property = await queryOne<OwnerRef>(
    db,
    `SELECT owner_id, title, slug FROM properties WHERE id = ?`,
    [propertyId],
  );
  if (!property) return { ok: false, reason: "NOT_FOUND" };

  const result = await execute(
    db,
    `UPDATE properties SET status = 'REJECTED', rejection_reason = ?, updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'APPROVED', 'PAUSED')`,
    [reason, nowIso(), propertyId],
  );
  if (changes(result) !== 1) return { ok: false, reason: "INVALID_STATE" };

  await recordAdminAction(db, {
    adminId,
    action: "PROPERTY_REJECTED",
    entityType: "property",
    entityId: propertyId,
    metadata: { title: property.title, reason },
    ipHash: opts.ipHash,
  });
  // The owner must be able to see *why*, so the reason is carried into the
  // notification as well as stored on the listing.
  await notify(db, {
    userId: property.owner_id,
    type: "LISTING_REJECTED",
    titleBn: "বিজ্ঞাপন প্রত্যাখ্যান করা হয়েছে",
    bodyBn: `"${property.title}" — কারণ: ${reason}`,
    link: "/dashboard/properties",
    entityType: "property",
    entityId: propertyId,
  });
  return { ok: true };
}

export async function setFeatured(
  db: D1Database,
  adminId: string,
  propertyId: string,
  featured: boolean,
  opts: { ipHash?: string | null } = {},
): Promise<boolean> {
  const result = await execute(
    db,
    `UPDATE properties SET is_featured = ?, updated_at = ? WHERE id = ?`,
    [featured ? 1 : 0, nowIso(), propertyId],
  );
  if (changes(result) !== 1) return false;
  await recordAdminAction(db, {
    adminId,
    action: featured ? "PROPERTY_FEATURED" : "PROPERTY_UNFEATURED",
    entityType: "property",
    entityId: propertyId,
    ipHash: opts.ipHash,
  });
  return true;
}

export async function setVerified(
  db: D1Database,
  adminId: string,
  propertyId: string,
  verified: boolean,
  opts: { ipHash?: string | null } = {},
): Promise<boolean> {
  // "Verified" means a human on the team checked the listing against the owner.
  // It is deliberately a separate, manual flag — never set automatically.
  const result = await execute(
    db,
    `UPDATE properties SET is_verified = ?, updated_at = ? WHERE id = ?`,
    [verified ? 1 : 0, nowIso(), propertyId],
  );
  if (changes(result) !== 1) return false;
  await recordAdminAction(db, {
    adminId,
    action: "PROPERTY_STATUS_CHANGED",
    entityType: "property",
    entityId: propertyId,
    metadata: { isVerified: verified },
    ipHash: opts.ipHash,
  });
  return true;
}

export async function setPropertyStatus(
  db: D1Database,
  adminId: string,
  propertyId: string,
  status: PropertyStatus,
  opts: { ipHash?: string | null } = {},
): Promise<boolean> {
  const result = await execute(
    db,
    `UPDATE properties SET status = ?, updated_at = ? WHERE id = ?`,
    [status, nowIso(), propertyId],
  );
  if (changes(result) !== 1) return false;
  await recordAdminAction(db, {
    adminId,
    action: "PROPERTY_STATUS_CHANGED",
    entityType: "property",
    entityId: propertyId,
    metadata: { status },
    ipHash: opts.ipHash,
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Admin listing queries                                                       */
/* -------------------------------------------------------------------------- */

export interface AdminPropertyRow {
  id: string;
  public_ref: number;
  slug: string;
  title: string;
  status: PropertyStatus;
  price: number;
  is_featured: number;
  is_verified: number;
  created_at: string;
  owner_name: string;
  owner_id: string;
  owner_phone: string | null;
  category_name_bn: string;
  area_name_bn: string;
  image_count: number;
}

export async function listAdminProperties(
  db: D1Database,
  filters: { status?: PropertyStatus; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminPropertyRow[]; total: number }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    clauses.push(`p.status = ?`);
    params.push(filters.status);
  }
  if (filters.q) {
    const term = `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(`(p.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')`);
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const countRow = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM properties p JOIN users u ON u.id = p.owner_id ${where}`,
    params,
  );

  const rows = await queryAll<AdminPropertyRow>(
    db,
    `SELECT p.id, p.public_ref, p.slug, p.title, p.status, p.price,
            p.is_featured, p.is_verified, p.created_at,
            u.name AS owner_name, u.id AS owner_id, u.phone AS owner_phone,
            c.name_bn AS category_name_bn, l.name_bn AS area_name_bn,
            (SELECT COUNT(*) FROM property_images pi WHERE pi.property_id = p.id) AS image_count
       FROM properties p
       JOIN users u ON u.id = p.owner_id
       JOIN categories c ON c.id = p.category_id
       JOIN locations  l ON l.id = p.location_id
       ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 25, filters.offset ?? 0],
  );

  return { rows, total: countRow?.total ?? 0 };
}
