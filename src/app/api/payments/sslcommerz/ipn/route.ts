import { getDb } from "@/server/cloudflare/env";
import { getPaymentProvider } from "@/server/payments/factory";
import { settlePayment } from "@/server/payments/unlock-service";

/**
 * POST /api/payments/sslcommerz/ipn — the gateway's server-to-server callback.
 *
 * This is a machine endpoint called by SSLCOMMERZ, not by a browser, so the
 * same-origin/CSRF check deliberately does not apply. Its authenticity comes
 * from two independent places instead:
 *
 *   1. the `verify_sign` / `verify_key` MD5 signature computed with our store
 *      password, and
 *   2. an outbound Order Validation API call inside `settlePayment`, which is
 *      what actually authorises the state change.
 *
 * Because settlement is a conditional `UPDATE ... WHERE status = 'PENDING'`, a
 * replayed IPN is a no-op — the gateway retries safely.
 *
 * It always answers 200: a non-2xx would make SSLCOMMERZ retry a payload we
 * have already decided about.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const payload: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") payload[key] = value;
    }

    const transactionId = payload.tran_id;
    const validationId = payload.val_id ?? null;

    if (!transactionId) {
      console.warn("[ipn] payload without tran_id");
      return new Response("ignored", { status: 200 });
    }

    let provider;
    try {
      provider = getPaymentProvider();
    } catch (error) {
      console.error("[ipn] provider unavailable", error);
      return new Response("unconfigured", { status: 200 });
    }

    const signatureVerified = provider.verifySignature(payload);
    if (!signatureVerified) {
      // Not fatal on its own — the Order Validation call below is authoritative
      // — but a genuine gateway callback should always be signed, so a failure
      // here is worth investigating.
      console.warn(`[ipn] signature verification failed for tran_id=${transactionId}`);
    }

    const outcome = await settlePayment(getDb(), provider, {
      transactionId,
      validationId,
      rawPayload: payload,
      signatureVerified,
    });

    console.info(`[ipn] tran_id=${transactionId} result=${outcome.result}`);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("[ipn] unhandled error", error);
    return new Response("error", { status: 200 });
  }
}
