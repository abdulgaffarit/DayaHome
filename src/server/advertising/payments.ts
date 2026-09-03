/**
 * Advertising payments.
 *
 * This module adds no payment machinery of its own. It reuses the Phase 1
 * `PaymentGateway` contract, the same `payments` ledger the contact unlock
 * writes to, and the same settlement path — an advertising payment differs
 * only in its `payment_type` and in which id column is populated.
 *
 * The invariants are therefore inherited rather than reimplemented:
 *
 *   * the amount comes from the campaign row, which took it from the package;
 *     no request body reaches it;
 *   * a payment settles only after the gateway verifies it server-to-server;
 *   * settlement is idempotent;
 *   * and — specific to advertising — settlement moves the campaign to
 *     PENDING_REVIEW, never to ACTIVE. Money buys a place in the review queue.
 */
import type { AuthUser } from "@/server/auth/session";
import type { CreatePaymentResult, PaymentGateway } from "@/server/payments/gateway";
import type { CreatePaymentUrls } from "@/server/payments/unlock-service";
import { execute, queryOne } from "@/server/db/client";
import { newId, newToken } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { getCampaignById, transitionCampaign } from "./campaigns";

export const AD_CURRENCY = "BDT";

export type CreateCampaignPaymentResult =
  | { status: "NOT_FOUND" }
  | { status: "NOT_PAYABLE"; campaignStatus: string }
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
 * Opens a payment for a campaign.
 *
 * `advertiserId` is required and used as a query predicate, so a signed-in
 * user cannot start a payment against a campaign they do not own.
 */
export async function createCampaignPayment(
  db: D1Database,
  args: {
    user: AuthUser;
    advertiserId: string;
    campaignId: string;
    gateway: PaymentGateway;
    urls: CreatePaymentUrls;
  },
): Promise<CreateCampaignPaymentResult> {
  const campaign = await queryOne<{
    id: string;
    public_ref: number;
    title: string;
    status: string;
    price_bdt: number;
    renewed_from_id: string | null;
  }>(
    db,
    `SELECT id, public_ref, title, status, price_bdt, renewed_from_id
       FROM advertisement_campaigns WHERE id = ? AND advertiser_id = ?`,
    [args.campaignId, args.advertiserId],
  );
  if (!campaign) return { status: "NOT_FOUND" };

  // Only an unpaid draft may open a payment. Anything further along has either
  // been paid for already or has been rejected or cancelled.
  if (campaign.status !== "DRAFT") {
    return { status: "NOT_PAYABLE", campaignStatus: campaign.status };
  }
  // A zero-price campaign is an admin-created placement, not something to
  // charge for; `amount > 0` is a CHECK constraint besides.
  if (campaign.price_bdt <= 0) {
    return { status: "NOT_PAYABLE", campaignStatus: campaign.status };
  }

  const paymentType = campaign.renewed_from_id ? "ADVERTISEMENT_RENEWAL" : "ADVERTISEMENT";
  const transactionId = buildAdTransactionId(campaign.public_ref);
  const paymentId = newId("pay");
  const now = nowIso();
  const description = `বিজ্ঞাপন ক্যাম্পেইন — ${campaign.title}`;

  await execute(
    db,
    `INSERT INTO payments
       (id, transaction_id, user_id, property_id, advertisement_id, payment_type,
        description, amount, currency, gateway, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      paymentId,
      transactionId,
      args.user.id,
      campaign.id,
      paymentType,
      description,
      // Server-side price. The request never supplies an amount.
      campaign.price_bdt,
      AD_CURRENCY,
      args.gateway.id,
      now,
      now,
    ],
  );

  const moved = await transitionCampaign(db, campaign.id, "PENDING_PAYMENT", `payment_id = ?`, [
    paymentId,
  ]);
  if (!moved.ok) {
    await failPayment(db, paymentId, "campaign_not_payable");
    return { status: "NOT_PAYABLE", campaignStatus: campaign.status };
  }

  let created: CreatePaymentResult;
  try {
    created = await args.gateway.createPayment({
      transactionId,
      amount: campaign.price_bdt,
      currency: AD_CURRENCY,
      paymentType,
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
      metadata: { userId: args.user.id, campaignId: campaign.id, paymentId },
    });
  } catch (error) {
    // An unconfigured gateway throws rather than pretending to take money.
    console.error("[advertising] gateway rejected the request", error);
    created = { kind: "FAILED", reason: "gateway_unavailable" };
  }

  if (created.kind === "FAILED") {
    await failPayment(db, paymentId, created.reason);
    // The campaign returns to DRAFT so the advertiser can retry, perhaps
    // through a different gateway.
    await execute(
      db,
      `UPDATE advertisement_campaigns
          SET status = 'DRAFT', payment_id = NULL, updated_at = ?
        WHERE id = ? AND status = 'PENDING_PAYMENT'`,
      [nowIso(), campaign.id],
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

/** SSLCOMMERZ caps `tran_id` at 30 characters: `A<campaign ref>-<random>`. */
function buildAdTransactionId(publicRef: number): string {
  const random = newToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return `A${publicRef}-${random}`.slice(0, 30);
}

async function failPayment(db: D1Database, paymentId: string, reason: string): Promise<void> {
  await execute(
    db,
    `UPDATE payments SET status = 'FAILED', failure_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING'`,
    [reason.slice(0, 200), nowIso(), paymentId],
  );
}

/**
 * Advances a campaign once its payment has been verified and marked PAID.
 *
 * Called from the shared settlement path. It deliberately stops at
 * PENDING_REVIEW: there is no argument, and no configuration, that makes a
 * settled payment publish a banner. Only `approveCampaign` does that.
 */
export async function onCampaignPaymentSettled(
  db: D1Database,
  campaignId: string,
  paymentId: string,
): Promise<{ status: string } | null> {
  const campaign = await getCampaignById(db, campaignId);
  if (!campaign) return null;

  // Replayed settlement: the campaign has already moved on. Nothing to do.
  if (campaign.status !== "PENDING_PAYMENT") return { status: campaign.status };

  const paid = await transitionCampaign(db, campaignId, "PAID", `payment_id = ?`, [paymentId]);
  if (!paid.ok) return { status: campaign.status };

  await transitionCampaign(db, campaignId, "PENDING_REVIEW");

  const after = await getCampaignById(db, campaignId);
  return { status: after?.status ?? "PAID" };
}
