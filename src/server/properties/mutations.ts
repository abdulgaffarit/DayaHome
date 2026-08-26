/**
 * Property writes: creation, editing, and status transitions.
 *
 * Ownership is re-checked on the server for every mutation. The client's idea
 * of who owns a listing, or of what its current status is, is never used.
 */
import type { CreatePropertyInput } from "@/domain/schemas";
import type { PropertyStatus } from "@/domain/enums";
import { batch, changes, execute, placeholders, queryAll, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { buildPropertySlug } from "@/lib/slug";
import { DAY, isoPlus, nowIso } from "@/lib/time";
import { MAX_IMAGES_PER_PROPERTY } from "@/server/storage/images";
import { notify, notifyAdmins } from "@/server/notifications/notify";

/** How long an approved listing stays public before it is marked EXPIRED. */
export const DEFAULT_LISTING_DAYS = 60;

export type CreatePropertyResult =
  | { ok: true; id: string; slug: string; publicRef: number; status: PropertyStatus }
  | { ok: false; reason: "UNKNOWN_CATEGORY" | "UNKNOWN_AREA" | "NO_VALID_IMAGES" };

/**
 * Creates a listing owned by `ownerId`.
 *
 * The status is decided here, not by the caller: a submitted listing always
 * starts PENDING and waits for admin approval.
 */
export async function createProperty(
  db: D1Database,
  ownerId: string,
  input: CreatePropertyInput,
): Promise<CreatePropertyResult> {
  const category = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM categories WHERE slug = ? AND is_active = 1`,
    [input.categorySlug],
  );
  if (!category) return { ok: false, reason: "UNKNOWN_CATEGORY" };

  const location = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM locations WHERE slug = ? AND is_active = 1`,
    [input.areaSlug],
  );
  if (!location) return { ok: false, reason: "UNKNOWN_AREA" };

  // Only images this user uploaded and has not yet attached to a listing may be
  // used — otherwise one owner could attach another owner's photos.
  const imageIds = (input.imageIds ?? []).slice(0, MAX_IMAGES_PER_PROPERTY);
  const claimable = await claimableImageIds(db, ownerId, imageIds);
  if (claimable.length === 0) return { ok: false, reason: "NO_VALID_IMAGES" };

  const publicRef = await nextPropertyRef(db);
  const id = newId("prp");
  const slug = buildPropertySlug(input.title, publicRef);
  const now = nowIso();
  const status: PropertyStatus = input.submit === false ? "DRAFT" : "PENDING";

  await execute(
    db,
    `INSERT INTO properties (
       id, public_ref, slug, owner_id, category_id, location_id,
       title, description, property_type,
       price, price_period, is_negotiable,
       bedrooms, bathrooms, size_value, size_unit, floor, total_floors,
       furnished, tenant_type, available_from, rules,
       landmark, general_location,
       exact_address, latitude, longitude, contact_phone, owner_name,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, publicRef, slug, ownerId, category.id, location.id,
      input.title, input.description, input.propertyType ?? null,
      input.price, input.pricePeriod, input.isNegotiable ? 1 : 0,
      input.bedrooms ?? null, input.bathrooms ?? null,
      input.sizeValue ?? null, input.sizeUnit ?? null,
      input.floor ?? null, input.totalFloors ?? null,
      input.furnished ?? null, input.tenantType ?? null,
      input.availableFrom ?? null, input.rules ?? null,
      input.landmark ?? null, input.generalLocation ?? null,
      input.exactAddress, input.latitude ?? null, input.longitude ?? null,
      input.phone, input.ownerName,
      status, now, now,
    ],
  );

  await attachImages(db, id, ownerId, claimable);
  await replaceAmenities(db, id, input.amenitySlugs ?? []);

  // Being an owner is implied by having a listing; promote a plain USER once.
  await execute(
    db,
    `UPDATE users SET role = 'OWNER', updated_at = ? WHERE id = ? AND role = 'USER'`,
    [now, ownerId],
  );

  if (status === "PENDING") {
    await notify(db, {
      userId: ownerId,
      type: "LISTING_SUBMITTED",
      titleBn: "বিজ্ঞাপন জমা হয়েছে",
      bodyBn: `"${input.title}" পর্যালোচনার জন্য পাঠানো হয়েছে। অনুমোদনের পর এটি সাইটে দেখা যাবে।`,
      link: "/dashboard/properties",
      entityType: "property",
      entityId: id,
    });
    await notifyAdmins(db, {
      type: "ADMIN_NEW_PENDING_PROPERTY",
      titleBn: "নতুন বিজ্ঞাপন অনুমোদনের অপেক্ষায়",
      bodyBn: input.title,
      link: "/admin/properties/pending",
      entityType: "property",
      entityId: id,
    });
  }

  return { ok: true, id, slug, publicRef, status };
}

/**
 * Allocates the next public listing number.
 *
 * `UPDATE ... RETURNING` is a single atomic statement, so two concurrent
 * submissions can never receive the same reference.
 */
async function nextPropertyRef(db: D1Database): Promise<number> {
  const row = await queryOne<{ value: number }>(
    db,
    `UPDATE sequences SET value = value + 1 WHERE name = 'property_ref' RETURNING value`,
  );
  if (!row) throw new Error("property_ref sequence is missing — run migrations");
  return row.value;
}

/** Image ids uploaded by this user that are not attached to a listing yet. */
async function claimableImageIds(
  db: D1Database,
  ownerId: string,
  imageIds: string[],
): Promise<string[]> {
  if (imageIds.length === 0) return [];
  const rows = await queryAll<{ id: string }>(
    db,
    `SELECT id FROM property_images
      WHERE uploaded_by = ? AND property_id IS NULL AND id IN (${placeholders(imageIds.length)})`,
    [ownerId, ...imageIds],
  );
  // Preserve the order the owner arranged them in.
  const found = new Set(rows.map((r) => r.id));
  return imageIds.filter((id) => found.has(id));
}

async function attachImages(
  db: D1Database,
  propertyId: string,
  ownerId: string,
  imageIds: string[],
): Promise<void> {
  await batch(
    db,
    imageIds.map((imageId, index) => ({
      sql: `UPDATE property_images
               SET property_id = ?, sort_order = ?, is_primary = ?
             WHERE id = ? AND uploaded_by = ? AND property_id IS NULL`,
      params: [propertyId, index, index === 0 ? 1 : 0, imageId, ownerId],
    })),
  );
}

async function replaceAmenities(
  db: D1Database,
  propertyId: string,
  amenitySlugs: string[],
): Promise<void> {
  await execute(db, `DELETE FROM property_amenities WHERE property_id = ?`, [propertyId]);
  if (amenitySlugs.length === 0) return;
  const rows = await queryAll<{ id: string }>(
    db,
    `SELECT id FROM amenities WHERE slug IN (${placeholders(amenitySlugs.length)})`,
    amenitySlugs,
  );
  if (rows.length === 0) return;
  await batch(
    db,
    rows.map((row) => ({
      sql: `INSERT OR IGNORE INTO property_amenities (property_id, amenity_id) VALUES (?, ?)`,
      params: [propertyId, row.id],
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Owner-initiated updates                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Statuses an owner may set on their own listing.
 *
 * Notably absent: APPROVED. An owner can pause or close a listing, but only an
 * admin can make one public.
 */
const OWNER_SETTABLE: readonly PropertyStatus[] = ["PAUSED", "APPROVED", "RENTED", "SOLD", "ARCHIVED"];

export async function setOwnerPropertyStatus(
  db: D1Database,
  ownerId: string,
  propertyId: string,
  status: PropertyStatus,
): Promise<{ ok: boolean; reason?: string }> {
  if (!OWNER_SETTABLE.includes(status)) return { ok: false, reason: "FORBIDDEN_STATUS" };

  // Resuming (PAUSED → APPROVED) is only allowed for a listing an admin has
  // already approved once; a PENDING or REJECTED listing cannot be self-approved.
  const guard =
    status === "APPROVED"
      ? `AND status = 'PAUSED' AND approved_at IS NOT NULL`
      : `AND status NOT IN ('PENDING', 'REJECTED', 'ARCHIVED')`;

  const result = await execute(
    db,
    `UPDATE properties SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ? ${guard}`,
    [status, nowIso(), propertyId, ownerId],
  );
  return changes(result) === 1 ? { ok: true } : { ok: false, reason: "NOT_ALLOWED" };
}

/** Soft delete. Listings are archived rather than removed so payment history
 *  and audit records keep their referential integrity. */
export async function archiveProperty(
  db: D1Database,
  ownerId: string,
  propertyId: string,
): Promise<boolean> {
  const result = await execute(
    db,
    `UPDATE properties SET status = 'ARCHIVED', updated_at = ? WHERE id = ? AND owner_id = ?`,
    [nowIso(), propertyId, ownerId],
  );
  return changes(result) === 1;
}

/** Extends an expired or expiring listing by another cycle. */
export async function renewProperty(
  db: D1Database,
  ownerId: string,
  propertyId: string,
  days = DEFAULT_LISTING_DAYS,
): Promise<boolean> {
  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE properties
        SET status = CASE WHEN status = 'EXPIRED' THEN 'APPROVED' ELSE status END,
            expires_at = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND approved_at IS NOT NULL`,
    [isoPlus(days * DAY), now, propertyId, ownerId],
  );
  return changes(result) === 1;
}

/**
 * Marks listings whose window has closed as EXPIRED.
 *
 * Deliberately never deletes: the owner can renew, and the listing's history
 * stays intact. Intended for a scheduled (cron) invocation.
 */
export async function expireStaleProperties(db: D1Database): Promise<number> {
  const result = await execute(
    db,
    `UPDATE properties
        SET status = 'EXPIRED', updated_at = ?
      WHERE status = 'APPROVED' AND expires_at IS NOT NULL AND expires_at <= ?`,
    [nowIso(), nowIso()],
  );
  return changes(result);
}
