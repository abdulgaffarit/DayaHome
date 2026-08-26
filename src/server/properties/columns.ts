/**
 * The public/private column split for `properties`.
 *
 * PRIVACY BOUNDARY — read this before touching any property query.
 *
 * `PRIVATE_COLUMNS` may only appear in:
 *   - src/server/properties/contact.ts   (after an authorization check)
 *   - src/server/properties/owner.ts     (the owner's own listing)
 *   - src/server/admin/*                 (staff views)
 *
 * Every other query — the homepage, category pages, search, the public detail
 * page, sitemaps, JSON-LD — must build its SELECT from `PUBLIC_PROPERTY_COLUMNS`
 * so private values are never even loaded into memory on a public code path.
 * `tests/security/private-columns.test.ts` greps the public query module and
 * fails the build if a private column name appears in it.
 */
export const PRIVATE_COLUMNS = [
  "exact_address",
  "latitude",
  "longitude",
  "contact_phone",
] as const;

/** Column list for the full public detail projection. */
export const PUBLIC_PROPERTY_COLUMNS = `
  p.id                AS id,
  p.public_ref        AS public_ref,
  p.slug              AS slug,
  p.title             AS title,
  p.description       AS description,
  p.property_type     AS property_type,
  p.price             AS price,
  p.price_period      AS price_period,
  p.is_negotiable     AS is_negotiable,
  p.bedrooms          AS bedrooms,
  p.bathrooms         AS bathrooms,
  p.size_value        AS size_value,
  p.size_unit         AS size_unit,
  p.floor             AS floor,
  p.total_floors      AS total_floors,
  p.furnished         AS furnished,
  p.tenant_type       AS tenant_type,
  p.available_from    AS available_from,
  p.rules             AS rules,
  p.landmark          AS landmark,
  p.general_location  AS general_location,
  p.status            AS status,
  p.is_featured       AS is_featured,
  p.is_verified       AS is_verified,
  p.views_count       AS views_count,
  p.unlocks_count     AS unlocks_count,
  p.published_at      AS published_at,
  p.created_at        AS created_at,
  p.expires_at        AS expires_at,
  p.owner_name        AS owner_name,
  c.slug              AS category_slug,
  c.name_bn           AS category_name_bn,
  l.slug              AS area_slug,
  l.name_bn           AS area_name_bn
`;

/** Narrower list for cards, search results and sitemaps. */
export const PUBLIC_CARD_COLUMNS = `
  p.id            AS id,
  p.public_ref    AS public_ref,
  p.slug          AS slug,
  p.title         AS title,
  p.price         AS price,
  p.price_period  AS price_period,
  p.bedrooms      AS bedrooms,
  p.bathrooms     AS bathrooms,
  p.size_value    AS size_value,
  p.size_unit     AS size_unit,
  p.status        AS status,
  p.is_featured   AS is_featured,
  p.is_verified   AS is_verified,
  p.published_at  AS published_at,
  p.created_at    AS created_at,
  c.slug          AS category_slug,
  l.name_bn       AS area_name_bn
`;

/** `DP-1042` — the reference shown on the detail page and quoted to support. */
export function formatPublicId(publicRef: number): string {
  return `DP-${publicRef}`;
}

/**
 * Public owner label. The full legal name is private-ish information that adds
 * nothing before payment, so only the first name plus an initial is shown.
 */
export function maskOwnerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "মালিক";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1].charAt(0)}.`;
}
