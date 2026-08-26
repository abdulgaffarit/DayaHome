/**
 * Test data factories.
 *
 * These go through the same insert paths the application uses wherever
 * possible, so a schema change that would break production breaks the tests
 * too rather than silently passing against hand-written fixtures.
 */
import type { Role } from "@/domain/enums";
import { execute, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { hashPassword } from "@/server/auth/password";
import type { AuthUser } from "@/server/auth/session";

export async function createUser(
  db: D1Database,
  overrides: Partial<{ name: string; phone: string; email: string; role: Role; password: string }> = {},
): Promise<AuthUser> {
  const id = newId("usr");
  const now = nowIso();
  const phone = overrides.phone ?? `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const name = overrides.name ?? "পরীক্ষামূলক ব্যবহারকারী";
  const role: Role = overrides.role ?? "USER";

  await execute(
    db,
    `INSERT INTO users (id, name, phone, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    [
      id,
      name,
      phone,
      overrides.email ?? null,
      // A low iteration count keeps the suite fast; the algorithm is identical.
      await hashPassword(overrides.password ?? "testpass123", 1000),
      role,
      now,
      now,
    ],
  );

  return { id, name, phone, email: overrides.email ?? null, role, status: "ACTIVE", isVerifiedOwner: false };
}

export async function createProperty(
  db: D1Database,
  overrides: Partial<{
    ownerId: string;
    status: string;
    title: string;
    price: number;
    phone: string;
    exactAddress: string;
    categoryId: string;
    locationId: string;
  }> = {},
): Promise<{ id: string; slug: string; publicRef: number }> {
  const ownerId = overrides.ownerId ?? (await createUser(db, { role: "OWNER" })).id;
  const refRow = await queryOne<{ value: number }>(
    db,
    `UPDATE sequences SET value = value + 1 WHERE name = 'property_ref' RETURNING value`,
  );
  const publicRef = refRow!.value;
  const id = newId("prp");
  const slug = `test-property-${publicRef}`;
  const now = nowIso();
  const status = overrides.status ?? "APPROVED";

  await execute(
    db,
    `INSERT INTO properties (
       id, public_ref, slug, owner_id, category_id, location_id,
       title, description, price, price_period,
       exact_address, latitude, longitude, contact_phone, owner_name,
       status, published_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MONTHLY', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      publicRef,
      slug,
      ownerId,
      overrides.categoryId ?? "cat_basha_vhara",
      overrides.locationId ?? "loc_college_road",
      overrides.title ?? "পরীক্ষামূলক বাসা ভাড়া",
      "এটি একটি পরীক্ষামূলক বিজ্ঞাপনের বিবরণ। কমপক্ষে ত্রিশ অক্ষর দরকার।",
      overrides.price ?? 9000,
      overrides.exactAddress ?? "বাড়ি নং ১, টেস্ট রোড, দয়ারামপুর",
      24.2069,
      89.0631,
      overrides.phone ?? "01700000999",
      "পরীক্ষামূলক মালিক",
      status,
      status === "APPROVED" ? now : null,
      now,
      now,
    ],
  );

  return { id, slug, publicRef };
}

/** Creates a settled payment plus the ACTIVE unlock it bought. */
export async function grantUnlock(
  db: D1Database,
  userId: string,
  propertyId: string,
  amount = 50,
): Promise<{ paymentId: string; unlockId: string }> {
  const paymentId = newId("pay");
  const unlockId = newId("unl");
  const now = nowIso();

  await execute(
    db,
    `INSERT INTO payments (id, transaction_id, user_id, property_id, amount, currency, gateway, status, validation_id, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'BDT', 'SSLCOMMERZ', 'PAID', ?, ?, ?, ?)`,
    [paymentId, `TXN-${paymentId}`, userId, propertyId, amount, `val-${paymentId}`, now, now, now],
  );
  await execute(
    db,
    `INSERT INTO contact_unlocks (id, user_id, property_id, payment_id, status, unlocked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [unlockId, userId, propertyId, paymentId, now, now, now],
  );

  return { paymentId, unlockId };
}

/** A payment that was created but never settled. */
export async function createPendingPayment(
  db: D1Database,
  userId: string,
  propertyId: string,
  transactionId: string,
  amount = 50,
): Promise<{ paymentId: string; unlockId: string }> {
  const paymentId = newId("pay");
  const unlockId = newId("unl");
  const now = nowIso();

  await execute(
    db,
    `INSERT INTO payments (id, transaction_id, user_id, property_id, amount, currency, gateway, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'BDT', 'SSLCOMMERZ', 'PENDING', ?, ?)`,
    [paymentId, transactionId, userId, propertyId, amount, now, now],
  );
  await execute(
    db,
    `INSERT INTO contact_unlocks (id, user_id, property_id, payment_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
    [unlockId, userId, propertyId, paymentId, now, now],
  );

  return { paymentId, unlockId };
}
