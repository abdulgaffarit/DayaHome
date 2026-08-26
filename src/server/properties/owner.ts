/**
 * Owner-scoped reads.
 *
 * Every query here is filtered by `owner_id = ?`, which is what makes an IDOR
 * impossible: passing another owner's property id simply returns nothing.
 */
import type { PropertyStatus } from "@/domain/enums";
import { queryAll, queryOne } from "@/server/db/client";
import { formatPublicId } from "./columns";

export interface OwnerPropertyRow {
  id: string;
  publicId: string;
  slug: string;
  title: string;
  status: PropertyStatus;
  price: number;
  pricePeriod: string;
  categoryNameBn: string;
  areaNameBn: string;
  viewsCount: number;
  uniqueViewsCount: number;
  unlocksCount: number;
  favoritesCount: number;
  isFeatured: boolean;
  rejectionReason: string | null;
  primaryImageKey: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface RawOwnerRow {
  id: string;
  public_ref: number;
  slug: string;
  title: string;
  status: PropertyStatus;
  price: number;
  price_period: string;
  category_name_bn: string;
  area_name_bn: string;
  views_count: number;
  unique_views_count: number;
  unlocks_count: number;
  favorites_count: number;
  is_featured: number;
  rejection_reason: string | null;
  primary_image_key: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function listOwnerProperties(
  db: D1Database,
  ownerId: string,
  status?: PropertyStatus,
): Promise<OwnerPropertyRow[]> {
  const params: (string | number)[] = [ownerId];
  let statusClause = "";
  if (status) {
    statusClause = ` AND p.status = ?`;
    params.push(status);
  }

  const rows = await queryAll<RawOwnerRow>(
    db,
    `SELECT p.id, p.public_ref, p.slug, p.title, p.status, p.price, p.price_period,
            c.name_bn AS category_name_bn, l.name_bn AS area_name_bn,
            p.views_count, p.unique_views_count, p.unlocks_count, p.favorites_count,
            p.is_featured, p.rejection_reason, p.expires_at, p.created_at,
            (SELECT COALESCE(pi.thumb_key, pi.object_key) FROM property_images pi
              WHERE pi.property_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS primary_image_key
       FROM properties p
       JOIN categories c ON c.id = p.category_id
       JOIN locations  l ON l.id = p.location_id
      WHERE p.owner_id = ?${statusClause}
      ORDER BY p.created_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    publicId: formatPublicId(r.public_ref),
    slug: r.slug,
    title: r.title,
    status: r.status,
    price: r.price,
    pricePeriod: r.price_period,
    categoryNameBn: r.category_name_bn,
    areaNameBn: r.area_name_bn,
    viewsCount: r.views_count,
    uniqueViewsCount: r.unique_views_count,
    unlocksCount: r.unlocks_count,
    favoritesCount: r.favorites_count,
    isFeatured: r.is_featured === 1,
    rejectionReason: r.rejection_reason,
    primaryImageKey: r.primary_image_key,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export interface OwnerStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  totalViews: number;
  totalUnlocks: number;
}

export async function getOwnerStats(db: D1Database, ownerId: string): Promise<OwnerStats> {
  const row = await queryOne<OwnerStats>(
    db,
    `SELECT COUNT(*)                                              AS total,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)  AS approved,
            SUM(CASE WHEN status = 'PENDING'  THEN 1 ELSE 0 END)  AS pending,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)  AS rejected,
            COALESCE(SUM(views_count), 0)                         AS totalViews,
            COALESCE(SUM(unlocks_count), 0)                       AS totalUnlocks
       FROM properties WHERE owner_id = ?`,
    [ownerId],
  );
  return (
    row ?? { total: 0, approved: 0, pending: 0, rejected: 0, totalViews: 0, totalUnlocks: 0 }
  );
}

/** Full listing (including private fields) for the owner's own edit screen. */
export async function getOwnerPropertyDetail(
  db: D1Database,
  ownerId: string,
  propertyId: string,
) {
  return queryOne<{
    id: string;
    title: string;
    description: string;
    status: PropertyStatus;
    exact_address: string;
    contact_phone: string;
    latitude: number | null;
    longitude: number | null;
    rejection_reason: string | null;
  }>(
    db,
    `SELECT id, title, description, status, exact_address, contact_phone, latitude, longitude, rejection_reason
       FROM properties WHERE id = ? AND owner_id = ?`,
    [propertyId, ownerId],
  );
}
