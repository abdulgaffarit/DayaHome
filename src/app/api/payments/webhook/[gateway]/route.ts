import { getDb, getEnv } from "@/server/cloudflare/env";
import { isGatewayId } from "@/domain/payments";
import { gatewayForPayment } from "@/server/payments/registry";
import { getPaymentGatewayId, settlePayment } from "@/server/payments/unlock-service";

/**
 * POST /api/payments/webhook/{gateway} — generic gateway callback.
 *
 * The gateway-neutral equivalent of the SSLCOMMERZ IPN route, for adapters
 * added later. SSLCOMMERZ keeps its own path because that URL is already
 * registered in the merchant panel.
 *
 * Like that route this is a machine endpoint, so the same-origin check does not
 * apply; authenticity comes from the adapter's signature check plus the
 * server-to-server verification inside settlePayment.
 *
 * The `{gateway}` segment names who is calling, but it is NOT trusted to decide
 * how the payment is verified: that comes from the payment's own stored gateway
 * column, so a caller cannot nominate a weaker verifier for someone else's
 * transaction.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateway: string }> },
) {
  try {
    const { gateway: claimed } = await params;
    if (!isGatewayId(claimed)) {
      return new Response("unknown gateway", { status: 404 });
    }

    // Accept either form encoding or JSON; adapters differ.
    const payload: Record<string, string> = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string" || typeof value === "number") payload[key] = String(value);
      }
    } else {
      const form = await request.formData().catch(() => null);
      if (form) {
        for (const [key, value] of form.entries()) {
          if (typeof value === "string") payload[key] = value;
        }
      }
    }

    const db = getDb();
    const env = getEnv();

    // Parse with the claimed adapter purely to find the transaction id.
    const claimedAdapter = await gatewayForPayment(db, env, claimed);
    const event = claimedAdapter?.parseWebhook(payload);
    if (!event) {
      console.warn(`[webhook:${claimed}] unparseable payload`);
      return new Response("ignored", { status: 200 });
    }

    // Now switch to the gateway that actually created the payment.
    const ownerId = await getPaymentGatewayId(db, event.transactionId);
    if (!ownerId) {
      console.warn(`[webhook:${claimed}] unknown transaction ${event.transactionId}`);
      return new Response("ignored", { status: 200 });
    }
    if (ownerId !== claimed) {
      console.warn(
        `[webhook:${claimed}] transaction ${event.transactionId} belongs to ${ownerId} — refusing`,
      );
      return new Response("ignored", { status: 200 });
    }

    const gateway = await gatewayForPayment(db, env, ownerId);
    if (!gateway || !gateway.isConfigured()) {
      console.error(`[webhook:${claimed}] gateway unavailable`);
      return new Response("unconfigured", { status: 200 });
    }

    const outcome = await settlePayment(db, gateway, {
      transactionId: event.transactionId,
      validationId: event.validationId,
      rawPayload: payload,
      signatureVerified: gateway.verifyWebhookSignature(payload),
    });

    console.info(`[webhook:${claimed}] ${event.transactionId} result=${outcome.result}`);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("[webhook] unhandled error", error);
    return new Response("error", { status: 200 });
  }
}
