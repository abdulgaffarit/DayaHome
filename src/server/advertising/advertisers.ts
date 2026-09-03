/**
 * Advertiser accounts.
 *
 * An advertiser is a business profile attached to exactly one user account,
 * enforced by `advertisers_user_uq`. Every campaign query downstream carries
 * `AND advertiser_id = ?`, and the only way to obtain that id for a request is
 * `getAdvertiserForUser` — so a signed-in user can never address another
 * advertiser's campaigns.
 */
import { execute, isUniqueViolation, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import type { AdvertiserStatus } from "@/domain/advertising";

export interface AdvertiserRow {
  id: string;
  user_id: string;
  business_name: string;
  contact_person: string;
  business_phone: string;
  business_email: string | null;
  business_address: string | null;
  website_url: string | null;
  status: AdvertiserStatus;
  rejection_reason: string | null;
  created_at: string;
}

const COLUMNS = `id, user_id, business_name, contact_person, business_phone,
                 business_email, business_address, website_url, status,
                 rejection_reason, created_at`;

export interface CreateAdvertiserInput {
  businessName: string;
  contactPerson: string;
  businessPhone: string;
  businessEmail?: string | null;
  businessAddress?: string | null;
  websiteUrl?: string | null;
  tradeLicenceNo?: string | null;
}

export type CreateAdvertiserResult =
  | { ok: true; advertiser: AdvertiserRow }
  | { ok: false; reason: "ALREADY_EXISTS" };

/**
 * Registers the signed-in user as an advertiser.
 *
 * New profiles start PENDING. That does not block buying — an unreviewed
 * advertiser may pay — but every campaign still passes through the approval
 * queue before anything is served.
 */
export async function createAdvertiser(
  db: D1Database,
  userId: string,
  input: CreateAdvertiserInput,
): Promise<CreateAdvertiserResult> {
  const id = newId("adv");
  const now = nowIso();

  try {
    await execute(
      db,
      `INSERT INTO advertisers
         (id, user_id, business_name, contact_person, business_phone, business_email,
          business_address, website_url, trade_licence_no, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        id,
        userId,
        input.businessName,
        input.contactPerson,
        input.businessPhone,
        input.businessEmail ?? null,
        input.businessAddress ?? null,
        input.websiteUrl ?? null,
        input.tradeLicenceNo ?? null,
        now,
        now,
      ],
    );
  } catch (error) {
    // One profile per user, enforced by the unique index rather than by a
    // check-then-insert that two concurrent requests could both pass.
    if (isUniqueViolation(error)) return { ok: false, reason: "ALREADY_EXISTS" };
    throw error;
  }

  return { ok: true, advertiser: (await getAdvertiserById(db, id))! };
}

export async function getAdvertiserForUser(
  db: D1Database,
  userId: string,
): Promise<AdvertiserRow | null> {
  return queryOne<AdvertiserRow>(db, `SELECT ${COLUMNS} FROM advertisers WHERE user_id = ?`, [
    userId,
  ]);
}

export async function getAdvertiserById(
  db: D1Database,
  id: string,
): Promise<AdvertiserRow | null> {
  return queryOne<AdvertiserRow>(db, `SELECT ${COLUMNS} FROM advertisers WHERE id = ?`, [id]);
}

/** Staff decision on an advertiser profile. A rejection must carry a reason. */
export async function setAdvertiserStatus(
  db: D1Database,
  args: {
    advertiserId: string;
    status: AdvertiserStatus;
    adminId: string;
    rejectionReason?: string;
  },
): Promise<boolean> {
  if (args.status === "REJECTED" && !args.rejectionReason?.trim()) return false;

  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE advertisers
        SET status = ?,
            rejection_reason = ?,
            approved_by = ?,
            approved_at = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      args.status,
      args.status === "REJECTED" ? args.rejectionReason!.trim().slice(0, 500) : null,
      args.adminId,
      args.status === "APPROVED" ? now : null,
      now,
      args.advertiserId,
    ],
  );
  return (result.meta?.changes ?? 0) === 1;
}
