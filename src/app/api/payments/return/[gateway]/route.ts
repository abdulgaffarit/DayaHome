import { redirect } from "next/navigation";
import { getDb, getEnv } from "@/server/cloudflare/env";
import { isGatewayId } from "@/domain/payments";
import { gatewayForPayment } from "@/server/payments/registry";
import { getPaymentGatewayId, settlePayment } from "@/server/payments/unlock-service";

/**
 * GET|POST /api/payments/return/{gateway} — the browser's return leg.
 *
 * The gateway-neutral counterpart to the SSLCOMMERZ return route, which keeps
 * its own path because that URL is registered in the merchant panel.
 *
 * SECURITY: nothing that arrives here is trusted. `outcome` only chooses which
 * page to show, and `tran`/`invoice_id` only choose which payment to ASK about.
 * The payment settles inside `settlePayment`, which calls the gateway
 * server-to-server and compares the answer against the amount on our own row.
 * A payer who edits this URL changes which row is checked, never the verdict.
 *
 * The `{gateway}` segment is likewise not trusted to decide how verification
 * happens: the adapter is rebuilt from the payment's stored `gateway` column,
 * so nobody can nominate a weaker verifier for someone else's transaction.
 *
 * Idempotent: this and the webhook both call `settlePayment`, whichever arrives
 * first performs the transition and the other is a no-op.
 */
async function handleReturn(
  request: Request,
  params: Promise<{ gateway: string }>,
): Promise<never> {
  const { gateway: claimed } = await params;
  const url = new URL(request.url);
  const outcome = url.searchParams.get("outcome") ?? "success";

  let payload: Record<string, string> = Object.fromEntries(url.searchParams);
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (form) {
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") payload[key] = value;
      }
    } else {
      payload = { ...payload };
    }
  }

  if (!isGatewayId(claimed)) {
    redirect("/payment/result?status=failed");
  }

  // Our reference, echoed back through the URL we ourselves supplied.
  const transactionId = payload.tran ?? payload.tran_id ?? "";
  // The gateway's own invoice reference.
  const validationId = payload.invoice_id ?? payload.val_id ?? null;

  if (outcome !== "success" || !transactionId) {
    redirect(`/payment/result?status=${outcome === "cancel" ? "cancelled" : "failed"}`);
  }

  // No gateway reference to verify against. Deliberately NOT handed to
  // `settlePayment`, which would record a missing reference as a failure —
  // the payment may well be good, and the webhook carries the invoice id.
  // Leaving it PENDING lets that webhook settle it.
  if (!validationId) {
    redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
  }

  try {
    const db = getDb();
    const ownerId = await getPaymentGatewayId(db, transactionId);
    const gateway = ownerId ? await gatewayForPayment(db, getEnv(), ownerId) : null;
    if (!gateway) {
      redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
    }

    const result = await settlePayment(db, gateway, {
      transactionId,
      validationId,
      rawPayload: payload,
      signatureVerified: gateway.verifyWebhookSignature(payload),
    });

    if (result.result === "SETTLED" || result.result === "ALREADY_SETTLED") {
      redirect(`/payment/result?status=paid&tran=${encodeURIComponent(transactionId)}`);
    }
    // Verified as not-yet-settled. The webhook may still arrive, so the payer
    // is told to wait rather than that the payment failed.
    redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
  } catch (error) {
    // `redirect()` signals by throwing — let it through.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error(`[payment-return:${claimed}] settlement failed`, error);
    redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ gateway: string }> }) {
  return handleReturn(request, ctx.params);
}

export async function POST(request: Request, ctx: { params: Promise<{ gateway: string }> }) {
  return handleReturn(request, ctx.params);
}
