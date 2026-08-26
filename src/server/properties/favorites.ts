import type { PropertyCardData } from "@/domain/property";
import type { PricePeriod, PropertyStatus } from "@/domain/enums";
import { changes, execute, isUniqueViolation, queryAll } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { formatPublicId } from "./columns";

/**
 * Favourites.
 *
 * Both operations are idempotent: adding twice is a no-op (the unique index
 * catches it) and removing something that is not saved succeeds quietly. That
 * keeps the heart button correct even with a double tap on a slow connection.
 */
export async function addFavorite(
  db: D1Database,
  userId: string,
  propertyId: string,
): Promise<{ ok: boolean; already: boolean }> {
  try {
    await execute(
      db,
      `INSERT INTO favorites (id, user_id, property_id, created_at) VALUES (?, ?, ?, ?)`,
      [newId("fav"), userId, propertyId, nowIso()],
    );
    await execute(
      db,
      `UPDATE properties SET favorites_count = favorites_count + 1 WHERE id = ?`,
      [propertyId],
    );
    return { ok: true, already: false };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: true, already: true };
    throw error;
  }
}

export async function removeFavorite(
  db: D1Database,
  userId: string,
  propertyId: string,
): Promise<{ ok: boolean }> {
  const result = await execute(
    db,
    `DELETE FROM favorites WHERE user_id = ? AND property_id = ?`,
    [userId, propertyId],
  );
  if (changes(result) === 1) {
    await execute(
      db,
      `UPDATE properties SET favorites_count = MAX(0, favorites_count - 1) WHERE id = ?`,
      [propertyId],
    );
  }
  return { ok: true };
}

interface FavoriteRow {
  id: string;
  public_ref: number;
  slug: string;
  title: string;
  price: number;
  price_period: PricePeriod;
  bedrooms: number | null;
  bathrooms: number | null;
  size_value: number | null;
  size_unit: string | null;
  status: PropertyStatus;
  is_featured: number;
  is_verified: number;
  published_at: string | null;
  created_at: string;
  category_slug: string;
  area_name_bn: string;
  primary_image_key: string | null;
}

/**
 * The user's saved listings.
 *
 * Listings that are no longer public are still shown (with their real status)
 * so a user understands why something they saved has disappeared, rather than
 * finding it silently gone.
 */
export async function listFavorites(
  db: D1Database,
  userId: string,
): Promise<PropertyCardData[]> {
  const rows = await queryAll<FavoriteRow>(
    db,
    `SELECT p.id, p.public_ref, p.slug, p.title, p.price, p.price_period,
            p.bedrooms, p.bathrooms, p.size_value, p.size_unit,
            p.status, p.is_featured, p.is_verified, p.published_at, p.created_at,
            c.slug AS category_slug, l.name_bn AS area_name_bn,
            (SELECT COALESCE(pi.thumb_key, pi.object_key) FROM property_images pi
              WHERE pi.property_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS primary_image_key
       FROM favorites f
       JOIN properties p ON p.id = f.property_id
       JOIN categories c ON c.id = p.category_id
       JOIN locations  l ON l.id = p.location_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.id,
    publicId: formatPublicId(r.public_ref),
    slug: r.slug,
    title: r.title,
    categorySlug: r.category_slug,
    price: r.price,
    pricePeriod: r.price_period,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    sizeValue: r.size_value,
    sizeUnit: r.size_unit,
    areaNameBn: r.area_name_bn,
    status: r.status,
    isFeatured: r.is_featured === 1,
    isVerified: r.is_verified === 1,
    primaryImageKey: r.primary_image_key,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  }));
}
