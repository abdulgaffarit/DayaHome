import type { PaymentStatus } from "@/domain/enums";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import { recordAdminAction } from "./audit";

export interface AdminPaymentRow {
  id: string;
  transaction_id: string;
  amount: number;
  currency: string;
  gateway: string;
  status: PaymentStatus;
  validation_id: string | null;
  bank_tran_id: string | null;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
  user_id: string;
  user_name: string;
  user_phone: string | null;
  property_id: string;
  property_title: string;
  property_slug: string;
}

export async function listPayments(
  db: D1Database,
  filters: { status?: PaymentStatus; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminPaymentRow[]; total: number }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    clauses.push(`pay.status = ?`);
    params.push(filters.status);
  }
  if (filters.q) {
    const term = `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(
      `(pay.transaction_id LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')`,
    );
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const countRow = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM payments pay JOIN users u ON u.id = pay.user_id ${where}`,
    params,
  );

  const rows = await queryAll<AdminPaymentRow>(
    db,
    `SELECT pay.id, pay.transaction_id, pay.amount, pay.currency, pay.gateway, pay.status,
            pay.validation_id, pay.bank_tran_id, pay.failure_reason, pay.created_at, pay.paid_at,
            u.id AS user_id, u.name AS user_name, u.phone AS user_phone,
            p.id AS property_id, p.title AS property_title, p.slug AS property_slug
       FROM payments pay
       JOIN users u ON u.id = pay.user_id
       JOIN properties p ON p.id = pay.property_id
       ${where}
      ORDER BY pay.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 25, filters.offset ?? 0],
  );

  return { rows, total: countRow?.total ?? 0 };
}

/**
 * Records a refund and revokes the unlock it paid for.
 *
 * TODO: this marks the refund in our own ledger only. Moving money back is done
 * in the SSLCOMMERZ merchant panel — their refund API requires a separate
 * merchant agreement — so an operator must complete the refund there and paste
 * the reference here. The function is deliberately explicit about that rather
 * than pretending to have issued a refund.
 */
export async function recordRefund(
  db: D1Database,
  adminId: string,
  paymentId: string,
  refundRef: string,
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const payment = await queryOne<{ id: string; amount: number; user_id: string; property_id: string }>(
    db,
    `SELECT id, amount, user_id, property_id FROM payments WHERE id = ? AND status = 'PAID'`,
    [paymentId],
  );
  if (!payment) return { ok: false, reason: "NOT_REFUNDABLE" };

  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE payments SET status = 'REFUNDED', refunded_at = ?, refund_ref = ?, updated_at = ?
      WHERE id = ? AND status = 'PAID'`,
    [now, refundRef, now, paymentId],
  );
  if (changes(result) !== 1) return { ok: false, reason: "NOT_REFUNDABLE" };

  // A refunded unlock must stop granting access.
  await execute(
    db,
    `UPDATE contact_unlocks SET status = 'REVOKED', updated_at = ? WHERE payment_id = ?`,
    [now, paymentId],
  );
  await execute(
    db,
    `UPDATE properties SET unlocks_count = MAX(0, unlocks_count - 1) WHERE id = ?`,
    [payment.property_id],
  );

  await recordAdminAction(db, {
    adminId,
    action: "PAYMENT_REFUNDED",
    entityType: "payment",
    entityId: paymentId,
    metadata: { amount: payment.amount, refundRef },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}

export interface AdminUnlockRow {
  id: string;
  status: string;
  unlocked_at: string | null;
  created_at: string;
  user_name: string;
  user_phone: string | null;
  property_title: string;
  property_slug: string;
  amount: number | null;
  transaction_id: string | null;
}

export async function listUnlocks(
  db: D1Database,
  limit = 50,
  offset = 0,
): Promise<AdminUnlockRow[]> {
  return queryAll<AdminUnlockRow>(
    db,
    `SELECT cu.id, cu.status, cu.unlocked_at, cu.created_at,
            u.name AS user_name, u.phone AS user_phone,
            p.title AS property_title, p.slug AS property_slug,
            pay.amount AS amount, pay.transaction_id AS transaction_id
       FROM contact_unlocks cu
       JOIN users u ON u.id = cu.user_id
       JOIN properties p ON p.id = cu.property_id
       LEFT JOIN payments pay ON pay.id = cu.payment_id
      ORDER BY cu.created_at DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}
