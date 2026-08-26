import { redirect } from "next/navigation";
import { getDb } from "@/server/cloudflare/env";
import { getPaymentProvider } from "@/server/payments/factory";
import { settlePayment } from "@/server/payments/unlock-service";

/**
 * The browser's return leg from the gateway.
 *
 * SECURITY: reaching this URL proves nothing. `outcome=success` in the query
 * string is attacker-controlled and is used only to choose which page to show.
 * The unlock is settled by `settlePayment`, which independently calls the Order
 * Validation API — exactly as the IPN handler does. Whichever of the two
 * arrives first performs the transition; the other is a no-op.
 *
 * SSLCOMMERZ POSTs to the return URL, and some flows GET it, so both verbs are
 * handled.
 */
async function handleReturn(request: Request): Promise<never> {
  const url = new URL(request.url);
  const outcome = url.searchParams.get("outcome") ?? "success";

  let payload: Record<string, string> = {};
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (form) {
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") payload[key] = value;
      }
    }
  } else {
    payload = Object.fromEntries(url.searchParams);
  }

  const transactionId = payload.tran_id ?? url.searchParams.get("tran_id") ?? "";
  const validationId = payload.val_id ?? url.searchParams.get("val_id") ?? null;

  if (outcome !== "success" || !transactionId) {
    redirect(`/payment/result?status=${outcome === "cancel" ? "cancelled" : "failed"}`);
  }

  try {
    const provider = getPaymentProvider();
    const result = await settlePayment(getDb(), provider, {
      transactionId,
      validationId,
      rawPayload: payload,
      signatureVerified: provider.verifySignature(payload),
    });

    if (result.result === "SETTLED" || result.result === "ALREADY_SETTLED") {
      redirect(`/payment/result?status=paid&tran=${encodeURIComponent(transactionId)}`);
    }
    // Verified as not-yet-settled: the IPN may still arrive, so the result page
    // tells the user to wait rather than declaring failure.
    redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
  } catch (error) {
    // `redirect()` throws by design — let it through.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("[payment-return] settlement failed", error);
    redirect(`/payment/result?status=pending&tran=${encodeURIComponent(transactionId)}`);
  }
}

export async function GET(request: Request) {
  return handleReturn(request);
}

export async function POST(request: Request) {
  return handleReturn(request);
}
