/**
 * Authorized access to private property contact information.
 *
 * This is the ONLY module in the codebase that reads `contact_phone`,
 * `exact_address`, `latitude` or `longitude` for a non-owner, and every path
 * into it runs the full authorization chain first. Nothing here is ever called
 * from a public page render — the private payload reaches the browser only as
 * the body of `GET /api/properties/[id]/contact`, fetched after the user has
 * paid, so it is absent from the HTML, from the RSC payload, from metadata and
 * from JSON-LD.
 */
import type { AuthUser } from "@/server/auth/session";
import type { ContactResponse, PrivateContact } from "@/domain/property";
import { queryOne } from "@/server/db/client";
import { hasAtLeastRole } from "@/domain/enums";

export type UnlockDecision =
  | { allowed: true; via: "PAID_UNLOCK" | "OWNER" | "STAFF" }
  | { allowed: false; reason: "AUTH_REQUIRED" | "PAYMENT_REQUIRED" | "NOT_FOUND" };

interface PrivateRow {
  id: string;
  owner_id: string;
  status: string;
  contact_phone: string;
  owner_name: string;
  exact_address: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * True when `userId` holds an ACTIVE unlock for `propertyId` **and** the
 * payment behind it is PAID.
 *
 * The join against `payments` is deliberate redundancy: even if a bug or a
 * manual database edit flipped an unlock to ACTIVE without a settled payment,
 * the contact details would still stay locked.
 */
export async function hasActiveUnlock(
  db: D1Database,
  userId: string,
  propertyId: string,
): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok
       FROM contact_unlocks u
       JOIN payments pay ON pay.id = u.payment_id
      WHERE u.user_id = ?
        AND u.property_id = ?
        AND u.status = 'ACTIVE'
        AND pay.status = 'PAID'
        AND pay.user_id = u.user_id
        AND pay.property_id = u.property_id
      LIMIT 1`,
    [userId, propertyId],
  );
  return row !== null;
}

/**
 * Decides whether `user` may see the private contact details of `propertyId`.
 *
 * Order matters: identity first, then existence, then entitlement.
 */
export async function decideUnlock(
  db: D1Database,
  propertyId: string,
  user: AuthUser | null,
): Promise<{ decision: UnlockDecision; row: PrivateRow | null }> {
  // 1. Authenticate. An anonymous visitor can never reach private data, and we
  //    do not even look the property up for them — that would let an attacker
  //    probe for the existence of non-public listings.
  if (!user) return { decision: { allowed: false, reason: "AUTH_REQUIRED" }, row: null };

  // 2. Verify the property exists.
  const row = await queryOne<PrivateRow>(
    db,
    `SELECT id, owner_id, status, contact_phone, owner_name, exact_address, latitude, longitude
       FROM properties
      WHERE id = ?`,
    [propertyId],
  );
  if (!row) return { decision: { allowed: false, reason: "NOT_FOUND" }, row: null };

  // 3. The owner always sees their own listing's details.
  if (row.owner_id === user.id) {
    return { decision: { allowed: true, via: "OWNER" }, row };
  }

  // 4. Staff need the details to moderate listings and resolve reports; every
  //    such view is recorded by the caller in `admin_logs`.
  if (hasAtLeastRole(user.role, "ADMIN")) {
    return { decision: { allowed: true, via: "STAFF" }, row };
  }

  // 5. A non-owner may only reach a publicly visible listing.
  if (row.status !== "APPROVED") {
    return { decision: { allowed: false, reason: "NOT_FOUND" }, row: null };
  }

  // 6. Entitlement: an ACTIVE unlock owned by THIS user, backed by a PAID
  //    payment. `contact_unlocks` is keyed on user_id, so another user's unlock
  //    can never satisfy this check.
  const unlocked = await hasActiveUnlock(db, user.id, propertyId);
  if (!unlocked) {
    return { decision: { allowed: false, reason: "PAYMENT_REQUIRED" }, row: null };
  }

  return { decision: { allowed: true, via: "PAID_UNLOCK" }, row };
}

/**
 * Full resolver used by the contact API route.
 *
 * The locked branch returns nothing but a flag and the price. In particular it
 * does not reveal whether the property has a phone number on file, whether the
 * property exists, or how many people have unlocked it.
 */
export async function resolveContact(
  db: D1Database,
  propertyId: string,
  user: AuthUser | null,
  priceBdt: number,
): Promise<ContactResponse> {
  const { decision, row } = await decideUnlock(db, propertyId, user);

  if (!decision.allowed || !row) {
    return {
      locked: true,
      priceBdt,
      reason: decision.allowed
        ? "PAYMENT_REQUIRED"
        : decision.reason === "AUTH_REQUIRED"
          ? "AUTH_REQUIRED"
          : "PAYMENT_REQUIRED",
    };
  }

  return { locked: false, ...toPrivateContact(row) };
}

function toPrivateContact(row: PrivateRow): PrivateContact {
  return {
    phone: row.contact_phone,
    ownerName: row.owner_name,
    exactLocation: row.exact_address,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}
