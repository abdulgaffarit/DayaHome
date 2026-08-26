/**
 * Public property reads.
 *
 * PRIVACY: this module must never mention `contact_phone`, `exact_address`,
 * `latitude` or `longitude`. See src/server/properties/columns.ts.
 */
import type { PropertyCardData, PropertyImage, PublicProperty } from "@/domain/property";
import type { FurnishedState, PricePeriod, PropertyStatus, TenantType } from "@/domain/enums";
import type { SearchQuery } from "@/domain/schemas";
import { type Bindable, placeholders, queryAll, queryOne } from "@/server/db/client";
import {
  PUBLIC_CARD_COLUMNS,
  PUBLIC_PROPERTY_COLUMNS,
  formatPublicId,
  maskOwnerName,
} from "./columns";

export const PAGE_SIZE = 12;

/** Only APPROVED listings are public. Everything else 404s for a visitor. */
const PUBLIC_STATUS_CLAUSE = `p.status = 'APPROVED'`;

const FROM_PUBLIC = `
  FROM properties p
  JOIN categories c ON c.id = p.category_id
  JOIN locations  l ON l.id = p.location_id
`;

interface PublicRow {
  id: string;
  public_ref: number;
  slug: string;
  title: string;
  description: string;
  property_type: string | null;
  price: number;
  price_period: PricePeriod;
  is_negotiable: number;
  bedrooms: number | null;
  bathrooms: number | null;
  size_value: number | null;
  size_unit: string | null;
  floor: number | null;
  total_floors: number | null;
  furnished: FurnishedState | null;
  tenant_type: TenantType | null;
  available_from: string | null;
  rules: string | null;
  landmark: string | null;
  general_location: string | null;
  status: PropertyStatus;
  is_featured: number;
  is_verified: number;
  views_count: number;
  unlocks_count: number;
  published_at: string | null;
  created_at: string;
  expires_at: string | null;
  owner_name: string;
  category_slug: string;
  category_name_bn: string;
  area_slug: string;
  area_name_bn: string;
}

interface CardRow {
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

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

export async function getPublicPropertyBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicProperty | null> {
  const row = await queryOne<PublicRow>(
    db,
    `SELECT ${PUBLIC_PROPERTY_COLUMNS} ${FROM_PUBLIC} WHERE p.slug = ? AND ${PUBLIC_STATUS_CLAUSE}`,
    [slug],
  );
  if (!row) return null;
  const [images, amenities] = await Promise.all([
    getPropertyImages(db, row.id),
    getPropertyAmenities(db, row.id),
  ]);
  return toPublicProperty(row, images, amenities);
}

export async function getPropertyImages(
  db: D1Database,
  propertyId: string,
): Promise<PropertyImage[]> {
  const rows = await queryAll<{
    id: string;
    object_key: string;
    thumb_key: string | null;
    width: number | null;
    height: number | null;
    alt_bn: string | null;
    sort_order: number;
    is_primary: number;
  }>(
    db,
    `SELECT id, object_key, thumb_key, width, height, alt_bn, sort_order, is_primary
       FROM property_images
      WHERE property_id = ?
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
    [propertyId],
  );
  return rows.map((r) => ({
    id: r.id,
    objectKey: r.object_key,
    thumbKey: r.thumb_key,
    width: r.width,
    height: r.height,
    altBn: r.alt_bn,
    sortOrder: r.sort_order,
    isPrimary: r.is_primary === 1,
  }));
}

export async function getPropertyAmenities(
  db: D1Database,
  propertyId: string,
): Promise<{ slug: string; nameBn: string }[]> {
  const rows = await queryAll<{ slug: string; name_bn: string }>(
    db,
    `SELECT a.slug, a.name_bn
       FROM property_amenities pa
       JOIN amenities a ON a.id = pa.amenity_id
      WHERE pa.property_id = ?
      ORDER BY a.sort_order ASC`,
    [propertyId],
  );
  return rows.map((r) => ({ slug: r.slug, nameBn: r.name_bn }));
}

function toPublicProperty(
  row: PublicRow,
  images: PropertyImage[],
  amenities: { slug: string; nameBn: string }[],
): PublicProperty {
  return {
    id: row.id,
    publicId: formatPublicId(row.public_ref),
    slug: row.slug,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    categoryNameBn: row.category_name_bn,
    propertyType: row.property_type,
    price: row.price,
    pricePeriod: row.price_period,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sizeValue: row.size_value,
    sizeUnit: row.size_unit,
    floor: row.floor,
    totalFloors: row.total_floors,
    furnished: row.furnished,
    tenantType: row.tenant_type,
    availableFrom: row.available_from,
    areaNameBn: row.area_name_bn,
    areaSlug: row.area_slug,
    generalLocation: row.general_location,
    landmark: row.landmark,
    rules: row.rules,
    amenities,
    images,
    status: row.status,
    isFeatured: row.is_featured === 1,
    isVerified: row.is_verified === 1,
    viewsCount: row.views_count,
    unlocksCount: row.unlocks_count,
    ownerDisplayName: maskOwnerName(row.owner_name),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toCard(row: CardRow): PropertyCardData {
  return {
    id: row.id,
    publicId: formatPublicId(row.public_ref),
    slug: row.slug,
    title: row.title,
    categorySlug: row.category_slug,
    price: row.price,
    pricePeriod: row.price_period,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sizeValue: row.size_value,
    sizeUnit: row.size_unit,
    areaNameBn: row.area_name_bn,
    status: row.status,
    isFeatured: row.is_featured === 1,
    isVerified: row.is_verified === 1,
    primaryImageKey: row.primary_image_key,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

/**
 * Correlated subquery for the card thumbnail. Cheaper than a LEFT JOIN with
 * GROUP BY, and D1 plans it well against `property_images_property_idx`.
 */
const PRIMARY_IMAGE_SUBQUERY = `
  (SELECT COALESCE(pi.thumb_key, pi.object_key)
     FROM property_images pi
    WHERE pi.property_id = p.id
    ORDER BY pi.is_primary DESC, pi.sort_order ASC
    LIMIT 1) AS primary_image_key
`;

/* -------------------------------------------------------------------------- */
/* Search / listing                                                            */
/* -------------------------------------------------------------------------- */

export interface SearchResult {
  items: PropertyCardData[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface WhereClause {
  sql: string;
  params: Bindable[];
}

/**
 * Builds the filter predicate.
 *
 * Every user-supplied value becomes a bound parameter; only fixed SQL fragments
 * chosen by the code are concatenated, so this cannot be injected into even
 * though it assembles SQL dynamically.
 */
function buildWhere(query: Partial<SearchQuery>): WhereClause {
  const clauses: string[] = [PUBLIC_STATUS_CLAUSE];
  const params: Bindable[] = [];

  if (query.category) {
    clauses.push(`c.slug = ?`);
    params.push(query.category);
  }
  if (query.area) {
    clauses.push(`l.slug = ?`);
    params.push(query.area);
  }
  if (query.propertyType) {
    clauses.push(`p.property_type = ?`);
    params.push(query.propertyType);
  }
  if (query.minPrice !== undefined) {
    clauses.push(`p.price >= ?`);
    params.push(query.minPrice);
  }
  if (query.maxPrice !== undefined) {
    clauses.push(`p.price <= ?`);
    params.push(query.maxPrice);
  }
  if (query.bedrooms !== undefined) {
    // "3+ bedrooms" is what the filter chip means.
    clauses.push(`p.bedrooms >= ?`);
    params.push(query.bedrooms);
  }
  if (query.bathrooms !== undefined) {
    clauses.push(`p.bathrooms >= ?`);
    params.push(query.bathrooms);
  }
  if (query.minSize !== undefined) {
    clauses.push(`p.size_value >= ?`);
    params.push(query.minSize);
  }
  if (query.maxSize !== undefined) {
    clauses.push(`p.size_value <= ?`);
    params.push(query.maxSize);
  }
  if (query.floor !== undefined) {
    clauses.push(`p.floor = ?`);
    params.push(query.floor);
  }
  if (query.furnished) {
    clauses.push(`p.furnished = ?`);
    params.push(query.furnished);
  }
  if (query.tenantType) {
    // A listing open to ANY tenant matches every specific tenant filter.
    clauses.push(`(p.tenant_type = ? OR p.tenant_type = 'ANY')`);
    params.push(query.tenantType);
  }
  if (query.availableFrom) {
    clauses.push(`(p.available_from IS NULL OR p.available_from <= ?)`);
    params.push(query.availableFrom);
  }
  if (query.q) {
    // LIKE with a leading wildcard cannot use an index, but the corpus for one
    // upazila is small. Escape the LIKE metacharacters so a user typing '%'
    // does not match everything.
    const term = `%${escapeLike(query.q)}%`;
    clauses.push(
      `(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR l.name_bn LIKE ? ESCAPE '\\' OR p.landmark LIKE ? ESCAPE '\\')`,
    );
    params.push(term, term, term, term);
  }

  return { sql: clauses.join(" AND "), params };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const ORDER_BY: Record<string, string> = {
  newest: `p.is_featured DESC, COALESCE(p.published_at, p.created_at) DESC`,
  price_asc: `p.is_featured DESC, p.price ASC`,
  price_desc: `p.is_featured DESC, p.price DESC`,
  popular: `p.is_featured DESC, p.views_count DESC, COALESCE(p.published_at, p.created_at) DESC`,
};

export async function searchProperties(
  db: D1Database,
  query: Partial<SearchQuery>,
  pageSize: number = PAGE_SIZE,
): Promise<SearchResult> {
  const page = Math.max(1, query.page ?? 1);
  const where = buildWhere(query);
  // `sort` comes from a Zod enum, so this lookup can only yield a known fragment.
  const orderBy = ORDER_BY[query.sort ?? "newest"] ?? ORDER_BY.newest;

  const countRow = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total ${FROM_PUBLIC} WHERE ${where.sql}`,
    where.params,
  );
  const total = countRow?.total ?? 0;

  const rows = await queryAll<CardRow>(
    db,
    `SELECT ${PUBLIC_CARD_COLUMNS}, ${PRIMARY_IMAGE_SUBQUERY}
     ${FROM_PUBLIC}
     WHERE ${where.sql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...where.params, pageSize, (page - 1) * pageSize],
  );

  return {
    items: rows.map(toCard),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getLatestProperties(
  db: D1Database,
  limit = 8,
): Promise<PropertyCardData[]> {
  const rows = await queryAll<CardRow>(
    db,
    `SELECT ${PUBLIC_CARD_COLUMNS}, ${PRIMARY_IMAGE_SUBQUERY}
     ${FROM_PUBLIC}
     WHERE ${PUBLIC_STATUS_CLAUSE}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(toCard);
}

export async function getFeaturedProperties(
  db: D1Database,
  limit = 4,
): Promise<PropertyCardData[]> {
  const rows = await queryAll<CardRow>(
    db,
    `SELECT ${PUBLIC_CARD_COLUMNS}, ${PRIMARY_IMAGE_SUBQUERY}
     ${FROM_PUBLIC}
     WHERE ${PUBLIC_STATUS_CLAUSE} AND p.is_featured = 1
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(toCard);
}

/** "Similar listings" strip: same category, same area first, excluding self. */
export async function getRelatedProperties(
  db: D1Database,
  property: Pick<PublicProperty, "id" | "categorySlug" | "areaSlug">,
  limit = 4,
): Promise<PropertyCardData[]> {
  const rows = await queryAll<CardRow>(
    db,
    `SELECT ${PUBLIC_CARD_COLUMNS}, ${PRIMARY_IMAGE_SUBQUERY}
     ${FROM_PUBLIC}
     WHERE ${PUBLIC_STATUS_CLAUSE} AND c.slug = ? AND p.id <> ?
     ORDER BY (l.slug = ?) DESC, COALESCE(p.published_at, p.created_at) DESC
     LIMIT ?`,
    [property.categorySlug, property.id, property.areaSlug, limit],
  );
  return rows.map(toCard);
}

/* -------------------------------------------------------------------------- */
/* Aggregates for the homepage and category headers                            */
/* -------------------------------------------------------------------------- */

export async function getCategoryCounts(
  db: D1Database,
): Promise<Record<string, number>> {
  const rows = await queryAll<{ slug: string; total: number }>(
    db,
    `SELECT c.slug AS slug, COUNT(p.id) AS total
       FROM categories c
       LEFT JOIN properties p ON p.category_id = c.id AND p.status = 'APPROVED'
      GROUP BY c.slug`,
  );
  return Object.fromEntries(rows.map((r) => [r.slug, r.total]));
}

export interface SiteStats {
  activeListings: number;
  totalOwners: number;
  totalAreas: number;
  totalUnlocks: number;
}

export async function getSiteStats(db: D1Database): Promise<SiteStats> {
  const row = await queryOne<SiteStats>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM properties WHERE status = 'APPROVED')            AS activeListings,
       (SELECT COUNT(DISTINCT owner_id) FROM properties WHERE status = 'APPROVED') AS totalOwners,
       (SELECT COUNT(*) FROM locations WHERE is_active = 1 AND parent_id IS NOT NULL) AS totalAreas,
       (SELECT COUNT(*) FROM contact_unlocks WHERE status = 'ACTIVE')          AS totalUnlocks`,
  );
  return row ?? { activeListings: 0, totalOwners: 0, totalAreas: 0, totalUnlocks: 0 };
}

export async function listActiveAreas(
  db: D1Database,
): Promise<{ slug: string; nameBn: string }[]> {
  const rows = await queryAll<{ slug: string; name_bn: string }>(
    db,
    `SELECT slug, name_bn FROM locations
      WHERE is_active = 1 AND parent_id IS NOT NULL
      ORDER BY sort_order ASC, name_bn ASC`,
  );
  return rows.map((r) => ({ slug: r.slug, nameBn: r.name_bn }));
}

export async function listAmenities(
  db: D1Database,
): Promise<{ id: string; slug: string; nameBn: string }[]> {
  const rows = await queryAll<{ id: string; slug: string; name_bn: string }>(
    db,
    `SELECT id, slug, name_bn FROM amenities ORDER BY sort_order ASC`,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, nameBn: r.name_bn }));
}

/** Distinct `property_type` values actually in use, for the filter dropdown. */
export async function listPropertyTypes(
  db: D1Database,
  categorySlug?: string,
): Promise<string[]> {
  const params: Bindable[] = [];
  let sql = `SELECT DISTINCT p.property_type AS t
               FROM properties p
               JOIN categories c ON c.id = p.category_id
              WHERE p.status = 'APPROVED' AND p.property_type IS NOT NULL`;
  if (categorySlug) {
    sql += ` AND c.slug = ?`;
    params.push(categorySlug);
  }
  sql += ` ORDER BY t ASC`;
  const rows = await queryAll<{ t: string }>(db, sql, params);
  return rows.map((r) => r.t);
}

/** Slugs + timestamps for the sitemap. */
export async function listSitemapEntries(
  db: D1Database,
  limit = 5000,
): Promise<{ slug: string; updatedAt: string }[]> {
  const rows = await queryAll<{ slug: string; updated_at: string }>(
    db,
    `SELECT p.slug AS slug, p.updated_at AS updated_at
       FROM properties p
      WHERE p.status = 'APPROVED'
      ORDER BY p.updated_at DESC
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
}

/** Which of these property ids the given user has favourited. */
export async function getFavoritedIds(
  db: D1Database,
  userId: string,
  propertyIds: string[],
): Promise<Set<string>> {
  if (propertyIds.length === 0) return new Set();
  const rows = await queryAll<{ property_id: string }>(
    db,
    `SELECT property_id FROM favorites
      WHERE user_id = ? AND property_id IN (${placeholders(propertyIds.length)})`,
    [userId, ...propertyIds],
  );
  return new Set(rows.map((r) => r.property_id));
}
