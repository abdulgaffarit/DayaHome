/**
 * Listing creation, moderation, ownership and the public/private query split.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser } from "../helpers/factories";
import { createProperty as createViaService } from "@/server/properties/mutations";
import { archiveProperty, setOwnerPropertyStatus } from "@/server/properties/mutations";
import { approveProperty, rejectProperty } from "@/server/admin/moderation";
import {
  getPublicPropertyBySlug,
  searchProperties,
} from "@/server/properties/queries";
import { addFavorite, listFavorites, removeFavorite } from "@/server/properties/favorites";
import { createReport } from "@/server/properties/reports";
import { recordPropertyView } from "@/server/properties/views";
import { execute, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

/** Registers an unattached image so the create flow has something to claim. */
async function uploadImage(db: D1Database, userId: string): Promise<string> {
  const id = newId("img");
  await execute(
    db,
    `INSERT INTO property_images (id, property_id, uploaded_by, object_key, mime_type, size_bytes, created_at)
     VALUES (?, NULL, ?, ?, 'image/jpeg', 1024, ?)`,
    [id, userId, `properties/2026/01/${id}.jpg`, nowIso()],
  );
  return id;
}

const BASE_INPUT = {
  categorySlug: "basha-vhara" as const,
  title: "পরীক্ষামূলক বাসা ভাড়া দয়ারামপুরে",
  propertyType: "ফ্ল্যাট",
  areaSlug: "college-road",
  landmark: undefined,
  generalLocation: undefined,
  exactAddress: "বাড়ি নং ১, টেস্ট রোড, দয়ারামপুর",
  latitude: 24.2069,
  longitude: 89.0631,
  price: 9000,
  pricePeriod: "MONTHLY" as const,
  isNegotiable: false,
  bedrooms: 2,
  bathrooms: 1,
  sizeValue: 800,
  sizeUnit: "স্কয়ার ফুট",
  floor: 2,
  totalFloors: 4,
  furnished: "UNFURNISHED" as const,
  tenantType: "FAMILY" as const,
  availableFrom: undefined,
  amenitySlugs: ["gas", "water"],
  description: "এটি একটি পরীক্ষামূলক বিজ্ঞাপনের বিবরণ যা যথেষ্ট লম্বা।",
  rules: undefined,
  ownerName: "পরীক্ষামূলক মালিক",
  phone: "01700000999",
  submit: true,
};

describe("property creation", () => {
  it("always starts a submitted listing as PENDING, never APPROVED", async () => {
    const owner = await createUser(ctx.db);
    const imageId = await uploadImage(ctx.db, owner.id);

    const result = await createViaService(ctx.db, owner.id, {
      ...BASE_INPUT,
      imageIds: [imageId],
    });

    expect(result).toMatchObject({ ok: true, status: "PENDING" });
  });

  it("promotes a plain USER to OWNER on their first listing", async () => {
    const user = await createUser(ctx.db, { role: "USER" });
    const imageId = await uploadImage(ctx.db, user.id);

    await createViaService(ctx.db, user.id, { ...BASE_INPUT, imageIds: [imageId] });

    const stored = await queryOne<{ role: string }>(
      ctx.db,
      `SELECT role FROM users WHERE id = ?`,
      [user.id],
    );
    expect(stored?.role).toBe("OWNER");
  });

  it("CRITICAL: cannot attach another user's uploaded images", async () => {
    const owner = await createUser(ctx.db);
    const stranger = await createUser(ctx.db);
    const strangersImage = await uploadImage(ctx.db, stranger.id);

    const result = await createViaService(ctx.db, owner.id, {
      ...BASE_INPUT,
      imageIds: [strangersImage],
    });

    expect(result).toEqual({ ok: false, reason: "NO_VALID_IMAGES" });

    // The image is still unattached and still belongs to the stranger.
    const image = await queryOne<{ property_id: string | null; uploaded_by: string }>(
      ctx.db,
      `SELECT property_id, uploaded_by FROM property_images WHERE id = ?`,
      [strangersImage],
    );
    expect(image).toMatchObject({ property_id: null, uploaded_by: stranger.id });
  });

  it("gives each listing a unique public reference and slug", async () => {
    const owner = await createUser(ctx.db);
    const first = await createViaService(ctx.db, owner.id, {
      ...BASE_INPUT,
      imageIds: [await uploadImage(ctx.db, owner.id)],
    });
    const second = await createViaService(ctx.db, owner.id, {
      ...BASE_INPUT,
      imageIds: [await uploadImage(ctx.db, owner.id)],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.publicRef).not.toBe(second.publicRef);
    expect(first.slug).not.toBe(second.slug);
  });

  it("rejects an unknown category or area", async () => {
    const owner = await createUser(ctx.db);
    const imageId = await uploadImage(ctx.db, owner.id);

    await expect(
      createViaService(ctx.db, owner.id, {
        ...BASE_INPUT,
        categorySlug: "not-a-category",
        imageIds: [imageId],
      }),
    ).resolves.toEqual({ ok: false, reason: "UNKNOWN_CATEGORY" });

    await expect(
      createViaService(ctx.db, owner.id, {
        ...BASE_INPUT,
        areaSlug: "not-an-area",
        imageIds: [imageId],
      }),
    ).resolves.toEqual({ ok: false, reason: "UNKNOWN_AREA" });
  });

  it("notifies the owner and every admin when a listing is submitted", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const owner = await createUser(ctx.db);

    await createViaService(ctx.db, owner.id, {
      ...BASE_INPUT,
      imageIds: [await uploadImage(ctx.db, owner.id)],
    });

    const ownerNote = await queryOne<{ type: string }>(
      ctx.db,
      `SELECT type FROM notifications WHERE user_id = ?`,
      [owner.id],
    );
    const adminNote = await queryOne<{ type: string }>(
      ctx.db,
      `SELECT type FROM notifications WHERE user_id = ?`,
      [admin.id],
    );

    expect(ownerNote?.type).toBe("LISTING_SUBMITTED");
    expect(adminNote?.type).toBe("ADMIN_NEW_PENDING_PROPERTY");
  });
});

describe("moderation", () => {
  it("approving publishes the listing and notifies the owner", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "PENDING" });

    const result = await approveProperty(ctx.db, admin.id, property.id);
    expect(result.ok).toBe(true);

    const stored = await queryOne<{ status: string; approved_by: string; expires_at: string }>(
      ctx.db,
      `SELECT status, approved_by, expires_at FROM properties WHERE id = ?`,
      [property.id],
    );
    expect(stored?.status).toBe("APPROVED");
    expect(stored?.approved_by).toBe(admin.id);
    expect(stored?.expires_at).toBeTruthy();

    const note = await queryOne<{ type: string }>(
      ctx.db,
      `SELECT type FROM notifications WHERE user_id = ?`,
      [owner.id],
    );
    expect(note?.type).toBe("LISTING_APPROVED");
  });

  it("rejecting stores the reason and tells the owner what it was", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "PENDING" });

    await rejectProperty(ctx.db, admin.id, property.id, "ছবিগুলো স্পষ্ট নয়।");

    const stored = await queryOne<{ status: string; rejection_reason: string }>(
      ctx.db,
      `SELECT status, rejection_reason FROM properties WHERE id = ?`,
      [property.id],
    );
    expect(stored).toMatchObject({
      status: "REJECTED",
      rejection_reason: "ছবিগুলো স্পষ্ট নয়।",
    });

    const note = await queryOne<{ body_bn: string }>(
      ctx.db,
      `SELECT body_bn FROM notifications WHERE user_id = ?`,
      [owner.id],
    );
    expect(note?.body_bn).toContain("ছবিগুলো স্পষ্ট নয়।");
  });

  it("writes an audit entry for both approval and rejection", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const approved = await createProperty(ctx.db, { status: "PENDING" });
    const rejected = await createProperty(ctx.db, { status: "PENDING" });

    await approveProperty(ctx.db, admin.id, approved.id);
    await rejectProperty(ctx.db, admin.id, rejected.id, "যথেষ্ট তথ্য নেই।");

    const logs = await queryOne<{ total: number }>(
      ctx.db,
      `SELECT COUNT(*) AS total FROM admin_logs WHERE admin_id = ?`,
      [admin.id],
    );
    expect(logs?.total).toBe(2);
  });
});

describe("owner authorization", () => {
  it("CRITICAL: an owner cannot change another owner's listing", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const attacker = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });

    await expect(
      setOwnerPropertyStatus(ctx.db, attacker.id, property.id, "PAUSED"),
    ).resolves.toMatchObject({ ok: false });
    await expect(archiveProperty(ctx.db, attacker.id, property.id)).resolves.toBe(false);

    const stored = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM properties WHERE id = ?`,
      [property.id],
    );
    expect(stored?.status).toBe("APPROVED");
  });

  it("CRITICAL: an owner cannot self-approve a pending listing", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "PENDING" });

    await expect(
      setOwnerPropertyStatus(ctx.db, owner.id, property.id, "APPROVED"),
    ).resolves.toMatchObject({ ok: false });

    const stored = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM properties WHERE id = ?`,
      [property.id],
    );
    expect(stored?.status).toBe("PENDING");
  });

  it("an owner may pause and then resume a listing an admin approved", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "PENDING" });
    await approveProperty(ctx.db, admin.id, property.id);

    await expect(
      setOwnerPropertyStatus(ctx.db, owner.id, property.id, "PAUSED"),
    ).resolves.toEqual({ ok: true });
    await expect(
      setOwnerPropertyStatus(ctx.db, owner.id, property.id, "APPROVED"),
    ).resolves.toEqual({ ok: true });
  });
});

describe("public queries", () => {
  it("CRITICAL: the public projection contains no private field", async () => {
    const property = await createProperty(ctx.db, {
      status: "APPROVED",
      phone: "01799887766",
      exactAddress: "গোপন ঠিকানা ১২৩",
    });

    const publicProperty = await getPublicPropertyBySlug(ctx.db, property.slug);
    expect(publicProperty).not.toBeNull();

    const serialised = JSON.stringify(publicProperty);
    expect(serialised).not.toContain("01799887766");
    expect(serialised).not.toContain("গোপন ঠিকানা ১২৩");
    expect(serialised).not.toContain("24.2069");
    expect(Object.keys(publicProperty!)).not.toContain("phone");
    expect(Object.keys(publicProperty!)).not.toContain("latitude");
  });

  it("only APPROVED listings are publicly readable", async () => {
    for (const status of ["PENDING", "REJECTED", "PAUSED", "DRAFT", "ARCHIVED"]) {
      const property = await createProperty(ctx.db, { status });
      await expect(getPublicPropertyBySlug(ctx.db, property.slug)).resolves.toBeNull();
    }
  });

  it("search returns only APPROVED listings and no private data", async () => {
    await createProperty(ctx.db, { status: "APPROVED", title: "প্রকাশিত বাসা" });
    await createProperty(ctx.db, { status: "PENDING", title: "অপ্রকাশিত বাসা" });

    const results = await searchProperties(ctx.db, {});
    expect(results.total).toBe(1);
    expect(results.items[0].title).toBe("প্রকাশিত বাসা");
    expect(JSON.stringify(results)).not.toContain("contact_phone");
  });

  it("filters by price range and area", async () => {
    await createProperty(ctx.db, { price: 5000, locationId: "loc_college_road" });
    await createProperty(ctx.db, { price: 15000, locationId: "loc_college_road" });
    await createProperty(ctx.db, { price: 8000, locationId: "loc_bazar" });

    await expect(searchProperties(ctx.db, { maxPrice: 9000 })).resolves.toMatchObject({ total: 2 });
    await expect(searchProperties(ctx.db, { minPrice: 6000 })).resolves.toMatchObject({ total: 2 });
    await expect(
      searchProperties(ctx.db, { area: "college-road" }),
    ).resolves.toMatchObject({ total: 2 });
  });

  it("treats a LIKE wildcard in the search term as a literal character", async () => {
    await createProperty(ctx.db, { title: "সাধারণ বাসা" });

    // '%' must not match everything.
    const results = await searchProperties(ctx.db, { q: "%" });
    expect(results.total).toBe(0);
  });

  it("is not vulnerable to SQL injection through the search term", async () => {
    await createProperty(ctx.db, { title: "নিরাপদ বাসা" });

    const results = await searchProperties(ctx.db, { q: "'; DROP TABLE properties; --" });
    expect(results.total).toBe(0);

    // The table is still there.
    const still = await queryOne<{ total: number }>(
      ctx.db,
      `SELECT COUNT(*) AS total FROM properties`,
    );
    expect(still?.total).toBe(1);
  });
});

describe("favorites", () => {
  it("is idempotent and scoped to the user", async () => {
    const user = await createUser(ctx.db);
    const other = await createUser(ctx.db);
    const property = await createProperty(ctx.db);

    await expect(addFavorite(ctx.db, user.id, property.id)).resolves.toEqual({
      ok: true,
      already: false,
    });
    await expect(addFavorite(ctx.db, user.id, property.id)).resolves.toEqual({
      ok: true,
      already: true,
    });

    await expect(listFavorites(ctx.db, user.id)).resolves.toHaveLength(1);
    await expect(listFavorites(ctx.db, other.id)).resolves.toHaveLength(0);
  });

  it("removing someone else's favourite is a no-op", async () => {
    const user = await createUser(ctx.db);
    const attacker = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await addFavorite(ctx.db, user.id, property.id);

    await removeFavorite(ctx.db, attacker.id, property.id);
    await expect(listFavorites(ctx.db, user.id)).resolves.toHaveLength(1);
  });
});

describe("reports", () => {
  it("accepts one open report per user per listing", async () => {
    const reporter = await createUser(ctx.db);
    const property = await createProperty(ctx.db);

    await expect(
      createReport(ctx.db, { propertyId: property.id, reporterId: reporter.id, reason: "SCAM" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      createReport(ctx.db, { propertyId: property.id, reporterId: reporter.id, reason: "SCAM" }),
    ).resolves.toEqual({ ok: false, reason: "DUPLICATE" });
  });

  it("cannot report a listing that is not public", async () => {
    const reporter = await createUser(ctx.db);
    const hidden = await createProperty(ctx.db, { status: "PENDING" });

    await expect(
      createReport(ctx.db, { propertyId: hidden.id, reporterId: reporter.id, reason: "SCAM" }),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("view counting", () => {
  it("counts every visit but only one unique view per visitor per day", async () => {
    const property = await createProperty(ctx.db);

    const first = await recordPropertyView(ctx.db, {
      propertyId: property.id,
      userId: null,
      sessionHash: "visitor-a",
    });
    const second = await recordPropertyView(ctx.db, {
      propertyId: property.id,
      userId: null,
      sessionHash: "visitor-a",
    });
    const other = await recordPropertyView(ctx.db, {
      propertyId: property.id,
      userId: null,
      sessionHash: "visitor-b",
    });

    expect(first.counted).toBe(true);
    expect(second.counted).toBe(false); // a refresh
    expect(other.counted).toBe(true);

    const counts = await queryOne<{ views_count: number; unique_views_count: number }>(
      ctx.db,
      `SELECT views_count, unique_views_count FROM properties WHERE id = ?`,
      [property.id],
    );
    expect(counts).toMatchObject({ views_count: 3, unique_views_count: 2 });
  });
});
