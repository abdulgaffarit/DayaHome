/**
 * Contact-unlock purchase lifecycle.
 *
 * Invariants enforced here:
 *   1. The amount is decided by the server. `createUnlockPayment` takes the
 *      price from configuration; there is no code path by which a request body
 *      can influence it.
 *   2. A payment settles ONLY after `provider.verifyTransaction` — a
 *      server-to-server call to the gateway — returns `verified: true` for the
 *      matching transaction id, amount and currency. The success redirect is
 *      never trusted on its own.
 *   3. Settlement is idempotent. The state transition is a conditional
 *      `UPDATE ... WHERE status = 'PENDING'`, so a replayed IPN changes nothing
 *      and cannot mint a second unlock.
 *   4. A user holds at most one ACTIVE unlock per property, enforced by the
 *      partial unique index `contact_unlocks_active_uq`.
 */
import type { AuthUser } from "@/server/auth/session";
import type { CreatePaymentResult, PaymentGateway } from "./gateway";
import { batch, changes, execute, isUniqueViolation, queryOne } from "@/server/db/client";
import { newId, newToken } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { notify } from "@/server/notifications/notify";
import { onCampaignPaymentSettled } from "@/server/advertising/payments";

export const CURRENCY = "BDT";

export interface CreatePaymentUrls {
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
}

export type CreateUnlockPaymentResult =
  | { status: "ALREADY_UNLOCKED" }
  | { status: "OWN_PROPERTY" }
  | { status: "NOT_FOUND" }
  | { status: "GATEWAY_ERROR"; reason: string }
  | { status: "REDIRECT"; redirectUrl: string; transactionId: string; paymentId: string }
  /** Manual gateway: the payer sends money out of band and quotes a reference. */
  | {
      status: "INSTRUCTIONS";
      instructionsBn: string;
      reference: string;
      accountNumber?: string;
      transactionId: string;
      paymentId: string;
    };

interface PropertyForPayment {
  id: string;
  public_ref: number;
  title: string;
  owner_id: string;
  status: string;
}

export async function createUnlockPayment(
  db: D1Database,
  args: {
    user: AuthUser;
    propertyId: string;
    /** Server-side price. NEVER sourced from the request. */
    priceBdt: number;
    gateway: PaymentGateway;
    urls: CreatePaymentUrls;
  },
): Promise<CreateUnlockPaymentResult> {
  const { user, propertyId, priceBdt, gateway, urls } = args;

  const property = await queryOne<PropertyForPayment>(
    db,
    `SELECT id, public_ref, title, owner_id, status FROM properties WHERE id = ?`,
    [propertyId],
  );
  // A listing that is not publicly visible cannot be purchased, and we do not
  // distinguish "hidden" from "missing" in the response.
  if (!property || property.status !== "APPROVED") return { status: "NOT_FOUND" };

  // Owners already see their own contact details for free.
  if (property.owner_id === user.id) return { status: "OWN_PROPERTY" };

  const existing = await queryOne<{ id: string }>(
    db,
    `SELECT u.id
       FROM contact_unlocks u
       JOIN payments p ON p.id = u.payment_id
      WHERE u.user_id = ? AND u.property_id = ? AND u.status = 'ACTIVE' AND p.status = 'PAID'
      LIMIT 1`,
    [user.id, propertyId],
  );
  // Returning here is what stops a second charge for a property the user has
  // already paid for.
  if (existing) return { status: "ALREADY_UNLOCKED" };

  const transactionId = buildTransactionId(property.public_ref);
  const paymentId = newId("pay");
  const unlockId = newId("unl");
  const now = nowIso();

  const description = `যোগাযোগের তথ্য — ${property.title}`;

  await batch(db, [
    {
      sql: `INSERT INTO payments
              (id, transaction_id, user_id, property_id, payment_type, description,
               amount, currency, gateway, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'PROPERTY_CONTACT_UNLOCK', ?, ?, ?, ?, 'PENDING', ?, ?)`,
      params: [
        paymentId,
        transactionId,
        user.id,
        propertyId,
        description,
        priceBdt,
        CURRENCY,
        gateway.id,
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO contact_unlocks
              (id, user_id, property_id, payment_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      params: [unlockId, user.id, propertyId, paymentId, now, now],
    },
  ]);

  let created: CreatePaymentResult;
  try {
    created = await gateway.createPayment({
      transactionId,
      amount: priceBdt,
      currency: CURRENCY,
      paymentType: "PROPERTY_CONTACT_UNLOCK",
      description,
      customer: {
        name: user.name,
        email: user.email ?? `${user.id}@users.dayarampur.com`,
        phone: user.phone ?? "01700000000",
        address: "Dayarampur, Bagatipara, Natore",
        city: "Natore",
        country: "Bangladesh",
      },
      successUrl: urls.successUrl,
      failUrl: urls.failUrl,
      cancelUrl: urls.cancelUrl,
      webhookUrl: urls.ipnUrl,
      metadata: { userId: user.id, propertyId, paymentId },
    });
  } catch (error) {
    // An unconfigured gateway throws rather than pretending to take money.
    console.error("[unlock] gateway rejected the request", error);
    created = { kind: "FAILED", reason: "gateway_unavailable" };
  }

  if (created.kind === "FAILED") {
    await execute(
      db,
      `UPDATE payments SET status = 'FAILED', failure_reason = ?, updated_at = ?
        WHERE id = ? AND status = 'PENDING'`,
      [created.reason, nowIso(), paymentId],
    );
    return { status: "GATEWAY_ERROR", reason: created.reason };
  }

  if (created.kind === "INSTRUCTIONS") {
    return {
      status: "INSTRUCTIONS",
      instructionsBn: created.instructionsBn,
      reference: created.reference,
      accountNumber: created.accountNumber,
      transactionId,
      paymentId,
    };
  }

  return {
    status: "REDIRECT",
    redirectUrl: created.redirectUrl,
    transactionId,
    paymentId,
  };
}

/**
 * SSLCOMMERZ caps `tran_id` at 30 characters, so the reference stays compact:
 * `U<listing ref>-<random>`.
 */
function buildTransactionId(publicRef: number): string {
  const random = newToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return `U${publicRef}-${random}`.slice(0, 30);
}

/* -------------------------------------------------------------------------- */
/* Settlement                                                                  */
/* -------------------------------------------------------------------------- */

export type SettleOutcome =
  /** `propertyId` is null for an advertising or subscription payment. */
  | { result: "SETTLED"; paymentId: string; propertyId: string | null; userId: string }
  | { result: "ALREADY_SETTLED"; paymentId: string; propertyId: string | null; userId: string }
  | { result: "REJECTED"; reason: string; paymentId?: string }
  | { result: "UNKNOWN_TRANSACTION" };

interface PaymentRow {
  id: string;
  transaction_id: string;
  user_id: string;
  /** Null for an advertising or subscription payment. */
  property_id: string | null;
  /** Set only for an advertising payment. */
  advertisement_id: string | null;
  payment_type: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Settles a payment from an IPN or from the return-URL handler.
 *
 * Both entry points call this same function; whichever arrives first performs
 * the transition and the other becomes a no-op.
 */
export async function settlePayment(
  db: D1Database,
  gateway: PaymentGateway,
  args: {
    transactionId: string;
    validationId: string | null;
    /** Raw gateway payload, stored for dispute resolution. */
    rawPayload?: unknown;
    /** Set when the caller has already checked the IPN signature. */
    signatureVerified?: boolean;
  },
): Promise<SettleOutcome> {
  const payment = await queryOne<PaymentRow>(
    db,
    `SELECT id, transaction_id, user_id, property_id, advertisement_id, payment_type,
            amount, currency, status
       FROM payments WHERE transaction_id = ?`,
    [args.transactionId],
  );
  if (!payment) return { result: "UNKNOWN_TRANSACTION" };

  if (payment.status === "PAID") {
    return {
      result: "ALREADY_SETTLED",
      paymentId: payment.id,
      propertyId: payment.property_id,
      userId: payment.user_id,
    };
  }

  if (!args.validationId) {
    await markFailed(db, payment.id, "missing_validation_id");
    return { result: "REJECTED", reason: "missing_validation_id", paymentId: payment.id };
  }

  // Authoritative server-to-server verification. Amount and currency come from
  // OUR payment row, so a gateway response for a different (cheaper) order
  // cannot settle this one.
  const verification = await gateway.verifyPayment({
    transactionId: payment.transaction_id,
    validationId: args.validationId,
    expectedAmount: payment.amount,
    expectedCurrency: payment.currency,
  });

  if (!verification.verified) {
    const reason = verification.failureReason ?? `unverified_${verification.status}`;
    // PENDING/UNKNOWN mean "not settled yet" rather than "failed" — leave the
    // payment pending so a later IPN can still settle it.
    if (verification.status === "FAILED" || verification.status === "CANCELLED") {
      await markFailed(
        db,
        payment.id,
        reason,
        verification.status === "CANCELLED" ? "CANCELLED" : "FAILED",
      );
    }
    return { result: "REJECTED", reason, paymentId: payment.id };
  }

  const now = nowIso();

  // The idempotency gate. Only the first caller sees changes === 1.
  let updated: number;
  try {
    const result = await execute(
      db,
      `UPDATE payments
          SET status = 'PAID',
              validation_id = ?,
              bank_tran_id = ?,
              card_type = ?,
              risk_level = ?,
              gateway_status = ?,
              raw_payload = ?,
              paid_at = ?,
              updated_at = ?
        WHERE id = ? AND status = 'PENDING'`,
      [
        verification.validationId ?? args.validationId,
        verification.bankTransactionId ?? null,
        verification.cardType ?? null,
        verification.riskLevel ?? null,
        verification.status,
        args.rawPayload ? JSON.stringify(args.rawPayload).slice(0, 8000) : null,
        now,
        now,
        payment.id,
      ],
    );
    updated = changes(result);
  } catch (error) {
    // A duplicate IPN carrying a val_id already recorded against this payment
    // trips the UNIQUE index on `validation_id`. That is success, replayed.
    if (isUniqueViolation(error)) {
      return {
        result: "ALREADY_SETTLED",
        paymentId: payment.id,
        propertyId: payment.property_id,
        userId: payment.user_id,
      };
    }
    throw error;
  }

  if (updated === 0) {
    return {
      result: "ALREADY_SETTLED",
      paymentId: payment.id,
      propertyId: payment.property_id,
      userId: payment.user_id,
    };
  }

  // What a settled payment DELIVERS depends on what was bought. Verification
  // and the idempotency gate above are shared by every payment type; only this
  // step differs.
  if (isAdvertisingPayment(payment.payment_type) && payment.advertisement_id) {
    // Deliberately advances the campaign only as far as the review queue.
    await onCampaignPaymentSettled(db, payment.advertisement_id, payment.id);

    await notify(db, {
      userId: payment.user_id,
      type: "PAYMENT_SUCCESSFUL",
      titleBn: "পেমেন্ট সফল হয়েছে",
      bodyBn: `৳${payment.amount} পেমেন্ট গ্রহণ করা হয়েছে। আপনার বিজ্ঞাপনটি এখন পর্যালোচনার অপেক্ষায় আছে।`,
      link: `/advertiser/campaigns`,
      entityType: "payment",
      entityId: payment.id,
    });
  } else {
    await activateUnlock(db, payment, now);

    await notify(db, {
      userId: payment.user_id,
      type: "PAYMENT_SUCCESSFUL",
      titleBn: "পেমেন্ট সফল হয়েছে",
      bodyBn: `৳${payment.amount} পেমেন্ট গ্রহণ করা হয়েছে। এখন মালিকের যোগাযোগের তথ্য দেখতে পারবেন।`,
      link: `/dashboard/unlocked`,
      entityType: "payment",
      entityId: payment.id,
    });
  }

  return {
    result: "SETTLED",
    paymentId: payment.id,
    propertyId: payment.property_id,
    userId: payment.user_id,
  };
}

function isAdvertisingPayment(paymentType: string): boolean {
  return paymentType === "ADVERTISEMENT" || paymentType === "ADVERTISEMENT_RENEWAL";
}

async function activateUnlock(db: D1Database, payment: PaymentRow, now: string): Promise<void> {
  // Defensive: a property payment always has a property_id, but an unlock must
  // never be minted from a row that lacks one.
  if (!payment.property_id) return;

  try {
    await batch(db, [
      {
        sql: `UPDATE contact_unlocks
                 SET status = 'ACTIVE', unlocked_at = ?, updated_at = ?
               WHERE payment_id = ? AND status = 'PENDING'`,
        params: [now, now, payment.id],
      },
      {
        sql: `UPDATE properties
                 SET unlocks_count = unlocks_count + 1, updated_at = ?
               WHERE id = ?`,
        params: [now, payment.property_id],
      },
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The user already held an ACTIVE unlock for this property — they have
      // access either way, so this row stays PENDING and is flagged for a
      // refund review rather than failing the request.
      console.warn(
        `[unlock] duplicate active unlock for user=${payment.user_id} property=${payment.property_id}; payment=${payment.id} needs refund review`,
      );
      return;
    }
    throw error;
  }
}

async function markFailed(
  db: D1Database,
  paymentId: string,
  reason: string,
  status: "FAILED" | "CANCELLED" = "FAILED",
): Promise<void> {
  await execute(
    db,
    `UPDATE payments SET status = ?, failure_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING'`,
    [status, reason.slice(0, 200), nowIso(), paymentId],
  );
}

/**
 * Which gateway took a payment.
 *
 * Callbacks must be verified by the gateway that created the payment, not by
 * whichever gateway happens to be primary now — an administrator may have
 * switched primaries since.
 */
export async function getPaymentGatewayId(
  db: D1Database,
  transactionId: string,
): Promise<string | null> {
  const row = await queryOne<{ gateway: string }>(
    db,
    `SELECT gateway FROM payments WHERE transaction_id = ?`,
    [transactionId],
  );
  return row?.gateway ?? null;
}

/** Payment status for the return-URL page and the polling endpoint. */
export async function getPaymentStatus(
  db: D1Database,
  transactionId: string,
  userId: string,
): Promise<{
  status: string;
  propertyId: string;
  propertySlug: string;
  amount: number;
} | null> {
  return queryOne(
    db,
    `SELECT pay.status AS status,
            pay.property_id AS propertyId,
            p.slug AS propertySlug,
            pay.amount AS amount
       FROM payments pay
       JOIN properties p ON p.id = pay.property_id
      WHERE pay.transaction_id = ? AND pay.user_id = ?`,
    [transactionId, userId],
  );
}
