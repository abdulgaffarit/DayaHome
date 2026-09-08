/**
 * Featured listings and boost.
 *
 * Both are bought through the same generic gateway contract as everything
 * else, and both obey the rule that a payment record grants nothing: the
 * benefit is applied only from the settlement path, after the gateway has
 * verified the transaction server-to-server.
 *
 * Prices and durations come from `monetization_plans`, editable by a
 * SUPER_ADMIN. Nothing here hardcodes an amount, and no request body can
 * influence one.
 */
import type { AuthUser } from "@/server/auth/session";
import type { CreatePaymentResult, PaymentGateway } from "@/server/payments/gateway";
import type { CreatePaymentUrls } from "@/server/payments/unlock-service";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { newId, newToken } from "@/lib/ids";
import { DAY, nowIso } from "@/lib/time";

/** A monetization payment is about a property, not an advertisement. */
export type MonetizationType = "FEATURED_PROPERTY" | "PROPERTY_BOOST";

export interface MonetizationPlan {
  id: string;
  payment_type: MonetizationType;
  label_bn: string;
  duration_days: number;
  price_bdt: number;
}

/** Plans on sale for one benefit. An inactive plan is not purchasable. */
export async function listPlans(
  db: D1Database,
  paymentType: MonetizationType,
): Promise<MonetizationPlan[]> {
  return queryAll<MonetizationPlan>(
    db,
    `SELECT id, payment_type, label_bn, duration_days, price_bdt
       FROM monetization_plans
      WHERE payment_type = ? AND is_active = 1
      ORDER BY sort_order ASC`,
    [paymentType],
  );
}

export type CreateMonetizationResult =
  | { status: "NOT_FOUND" }
  | { status: "NOT_OWNER" }
  | { status: "NOT_ELIGIBLE"; reason: string }
  | { status: "UNKNOWN_PLAN" }
  | { status: "GATEWAY_ERROR"; reason: string }
  | { status: "REDIRECT"; redirectUrl: string; transactionId: string; paymentId: string }
  | {
      status: "INSTRUCTIONS";
      instructionsBn: string;
      reference: string;
      accountNumber?: string;
      transactionId: string;
      paymentId: string;
    };

/**
 * Opens a payment to feature or boost a listing the caller owns.
 *
 * `ownerId` is a query predicate, so somebody else's listing is simply not
 * found — an owner cannot feature a property they do not own.
 */
export async function createMonetizationPayment(
  db: D1Database,
  args: {
    user: AuthUser;
    propertyId: string;
    planId: string;
    gateway: PaymentGateway;
    urls: CreatePaymentUrls;
  },
): Promise<CreateMonetizationResult> {
  const property = await queryOne<{
    id: string;
    public_ref: number;
    title: string;
    status: string;
  }>(
    db,
    `SELECT id, public_ref, title, status FROM properties WHERE id = ? AND owner_id = ?`,
    [args.propertyId, args.user.id],
  );
  if (!property) return { status: "NOT_FOUND" };

  // Only a live listing can be promoted: featuring a rejected or expired one
  // would charge for visibility that does not exist.
  if (property.status !== "APPROVED") {
    return { status: "NOT_ELIGIBLE", reason: property.status };
  }

  const plan = await queryOne<MonetizationPlan>(
    db,
    `SELECT id, payment_type, label_bn, duration_days, price_bdt
       FROM monetization_plans WHERE id = ? AND is_active = 1`,
    [args.planId],
  );
  if (!plan) return { status: "UNKNOWN_PLAN" };
  if (plan.payment_type !== "FEATURED_PROPERTY" && plan.payment_type !== "PROPERTY_BOOST") {
    return { status: "UNKNOWN_PLAN" };
  }

  const transactionId = buildTransactionId(plan.payment_type, property.public_ref);
  const paymentId = newId("pay");
  const now = nowIso();
  const description = `${plan.label_bn} — ${property.title}`;

  await execute(
    db,
    `INSERT INTO payments
       (id, transaction_id, user_id, property_id, payment_type, description,
        amount, currency, gateway, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'BDT', ?, 'PENDING', ?, ?)`,
    [
      paymentId,
      transactionId,
      args.user.id,
      property.id,
      plan.payment_type,
      description,
      // Server-side price, from the plan row.
      plan.price_bdt,
      args.gateway.id,
      now,
      now,
    ],
  );

  // The chosen plan is remembered on the payment so settlement knows the
  // duration without trusting anything from the callback.
  await execute(
    db,
    `UPDATE payments SET raw_payload = ? WHERE id = ?`,
    [JSON.stringify({ planId: plan.id, durationDays: plan.duration_days }), paymentId],
  );

  let created: CreatePaymentResult;
  try {
    created = await args.gateway.createPayment({
      transactionId,
      amount: plan.price_bdt,
      currency: "BDT",
      paymentType: plan.payment_type,
      description,
      customer: {
        name: args.user.name,
        email: args.user.email ?? `${args.user.id}@users.dayarampur.com`,
        phone: args.user.phone ?? "01700000000",
        address: "Dayarampur, Bagatipara, Natore",
        city: "Natore",
        country: "Bangladesh",
      },
      successUrl: args.urls.successUrl,
      failUrl: args.urls.failUrl,
      cancelUrl: args.urls.cancelUrl,
      webhookUrl: args.urls.ipnUrl,
      metadata: { userId: args.user.id, propertyId: property.id, paymentId },
    });
  } catch (error) {
    console.error("[monetization] gateway rejected the request", error);
    created = { kind: "FAILED", reason: "gateway_unavailable" };
  }

  if (created.kind === "FAILED") {
    await execute(
      db,
      `UPDATE payments SET status = 'FAILED', failure_reason = ?, updated_at = ?
        WHERE id = ? AND status = 'PENDING'`,
      [created.reason.slice(0, 200), nowIso(), paymentId],
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

  return { status: "REDIRECT", redirectUrl: created.redirectUrl, transactionId, paymentId };
}

/** `F<ref>-<random>` / `B<ref>-<random>`, within SSLCOMMERZ's 30-char limit. */
function buildTransactionId(type: MonetizationType, publicRef: number): string {
  const prefix = type === "FEATURED_PROPERTY" ? "F" : "B";
  const random = newToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return `${prefix}${publicRef}-${random}`.slice(0, 30);
}

/**
 * Applies the benefit once its payment is verified and marked PAID.
 *
 * Called from the shared settlement path, never from a request handler — that
 * is what makes "a payment record grants nothing" true rather than aspirational.
 *
 * The window EXTENDS an existing one rather than replacing it, so buying a
 * second week while the first is still running adds to it instead of throwing
 * the remainder away.
 */
export async function grantMonetizationBenefit(
  db: D1Database,
  args: {
    paymentId: string;
    propertyId: string;
    paymentType: MonetizationType;
    /** Duration recorded when the payment was created. */
    durationDays: number;
  },
): Promise<boolean> {
  const now = nowIso();
  const column = args.paymentType === "FEATURED_PROPERTY" ? "featured_until" : "boosted_until";

  const row = await queryOne<{ current: string | null }>(
    db,
    `SELECT ${column} AS current FROM properties WHERE id = ?`,
    [args.propertyId],
  );
  if (!row) return false;

  const base =
    row.current && Date.parse(row.current) > Date.now() ? Date.parse(row.current) : Date.now();
  const until = nowIso(new Date(base + args.durationDays * DAY));

  const sql =
    args.paymentType === "FEATURED_PROPERTY"
      ? `UPDATE properties SET is_featured = 1, featured_until = ?, updated_at = ? WHERE id = ?`
      : `UPDATE properties SET boosted_until = ?, boosted_at = ?, updated_at = ? WHERE id = ?`;

  const params =
    args.paymentType === "FEATURED_PROPERTY"
      ? [until, now, args.propertyId]
      : [until, now, now, args.propertyId];

  const result = await execute(db, sql, params);
  return changes(result) === 1;
}

/** Reads the plan recorded on the payment at creation time. */
export async function planFromPayment(
  db: D1Database,
  paymentId: string,
): Promise<{ durationDays: number } | null> {
  const row = await queryOne<{ raw_payload: string | null }>(
    db,
    `SELECT raw_payload FROM payments WHERE id = ?`,
    [paymentId],
  );
  if (!row?.raw_payload) return null;

  try {
    const parsed = JSON.parse(row.raw_payload) as { durationDays?: unknown };
    const days = typeof parsed.durationDays === "number" ? parsed.durationDays : null;
    return days && days > 0 ? { durationDays: days } : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Expiry                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Retires featured placements whose paid window has closed.
 *
 * Status-conditional, so a repeat run changes nothing. Never deletes: the
 * timestamps stay as a record of what was bought.
 */
export async function expireFeaturedProperties(db: D1Database): Promise<number> {
  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE properties
        SET is_featured = 0, updated_at = ?
      WHERE is_featured = 1 AND featured_until IS NOT NULL AND featured_until <= ?`,
    [now, now],
  );
  return changes(result);
}

/** The same for boost. Clearing the timestamp is what ends the ranking lift. */
export async function expireBoostedProperties(db: D1Database): Promise<number> {
  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE properties
        SET boosted_until = NULL, updated_at = ?
      WHERE boosted_until IS NOT NULL AND boosted_until <= ?`,
    [now, now],
  );
  return changes(result);
}
