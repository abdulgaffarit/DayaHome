/** Reads for the signed-in user's own dashboard. */
import type { PaymentStatus } from "@/domain/enums";
import { queryAll } from "@/server/db/client";

export interface UnlockedPropertyRow {
  propertyId: string;
  slug: string;
  title: string;
  areaNameBn: string;
  price: number;
  pricePeriod: string;
  unlockedAt: string | null;
  primaryImageKey: string | null;
}

/**
 * Properties this user has paid to unlock.
 *
 * Note what is NOT selected: the phone number and exact address are fetched
 * separately, per property, through the authorized contact endpoint. Even on
 * this page — where the user demonstrably has access — the private values are
 * not baked into the server-rendered HTML.
 */
export async function listUnlockedProperties(
  db: D1Database,
  userId: string,
): Promise<UnlockedPropertyRow[]> {
  const rows = await queryAll<{
    property_id: string;
    slug: string;
    title: string;
    area_name_bn: string;
    price: number;
    price_period: string;
    unlocked_at: string | null;
    primary_image_key: string | null;
  }>(
    db,
    `SELECT p.id AS property_id, p.slug, p.title, l.name_bn AS area_name_bn,
            p.price, p.price_period, cu.unlocked_at,
            (SELECT COALESCE(pi.thumb_key, pi.object_key) FROM property_images pi
              WHERE pi.property_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS primary_image_key
       FROM contact_unlocks cu
       JOIN properties p ON p.id = cu.property_id
       JOIN locations  l ON l.id = p.location_id
      WHERE cu.user_id = ? AND cu.status = 'ACTIVE'
      ORDER BY cu.unlocked_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    propertyId: r.property_id,
    slug: r.slug,
    title: r.title,
    areaNameBn: r.area_name_bn,
    price: r.price,
    pricePeriod: r.price_period,
    unlockedAt: r.unlocked_at,
    primaryImageKey: r.primary_image_key,
  }));
}

export interface UserPaymentRow {
  id: string;
  transaction_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  paid_at: string | null;
  property_title: string;
  property_slug: string;
}

export async function listUserPayments(
  db: D1Database,
  userId: string,
): Promise<UserPaymentRow[]> {
  return queryAll<UserPaymentRow>(
    db,
    `SELECT pay.id, pay.transaction_id, pay.amount, pay.currency, pay.status,
            pay.created_at, pay.paid_at,
            p.title AS property_title, p.slug AS property_slug
       FROM payments pay
       JOIN properties p ON p.id = pay.property_id
      WHERE pay.user_id = ?
      ORDER BY pay.created_at DESC`,
    [userId],
  );
}
