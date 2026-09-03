import { getDb, getEnv } from "@/server/cloudflare/env";
import { gatewayForPayment } from "@/server/payments/registry";
import { getPaymentGatewayId, settlePayment } from "@/server/payments/unlock-service";

/**
 * POST /api/payments/sslcommerz/ipn — the gateway's server-to-server callback.
 *
 * This path is kept verbatim because it is registered in the SSLCOMMERZ
 * merchant panel; changing it would silently stop settlements. New gateways
 * use /api/payments/webhook/[gateway], which shares this logic.
 *
 * A machine endpoint called by SSLCOMMERZ, not a browser, so the
 * same-origin/CSRF check deliberately does not apply. Authenticity comes from
 * the signature plus an outbound Order Validation call inside settlePayment,
 * which is what actually authorises the state change.
 *
 * Always answers 200: a non-2xx would make the gateway retry a payload we have
 * already decided about.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const payload: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") payload[key] = value;
    }

    const transactionId = payload.tran_id;
    if (!transactionId) {
      console.warn("[ipn] payload without tran_id");
      return new Response("ignored", { status: 200 });
    }

    const db = getDb();
    // Verify with the gateway that created this payment.
    const gatewayId = await getPaymentGatewayId(db, transactionId);
    if (!gatewayId) {
      console.warn(`[ipn] unknown transaction ${transactionId}`);
      return new Response("ignored", { status: 200 });
    }

    const gateway = await gatewayForPayment(db, getEnv(), gatewayId);
    if (!gateway || !gateway.isConfigured()) {
      console.error(`[ipn] gateway ${gatewayId} unavailable for ${transactionId}`);
      return new Response("unconfigured", { status: 200 });
    }

    const signatureVerified = gateway.verifyWebhookSignature(payload);
    if (!signatureVerified) {
      // Not fatal on its own — the Order Validation call below is the
      // authority — but a genuine callback should always be signed.
      console.warn(`[ipn] signature verification failed for tran_id=${transactionId}`);
    }

    const outcome = await settlePayment(db, gateway, {
      transactionId,
      validationId: payload.val_id ?? null,
      rawPayload: payload,
      signatureVerified,
    });

    console.info(`[ipn] tran_id=${transactionId} gateway=${gatewayId} result=${outcome.result}`);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("[ipn] unhandled error", error);
    return new Response("error", { status: 200 });
  }
}
