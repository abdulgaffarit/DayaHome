import { z } from "zod";
import { siteUrl } from "@/server/cloudflare/env";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { resolveGateway } from "@/server/payments/registry";
import { isGatewayId } from "@/domain/payments";
import { createMonetizationPayment } from "@/server/properties/monetization";

/**
 * POST /api/properties/promote — buys a featured placement or a boost.
 *
 * Body is `{ propertyId, planId }`. Note what is absent: no amount and no
 * duration. Both come from the `monetization_plans` row, exactly as the unlock
 * price comes from configuration — a request cannot influence what it costs or
 * how long it lasts.
 */
const promoteSchema = z.object({
  propertyId: z.string().trim().min(1).max(64),
  planId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createPayment, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = promoteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const requested = new URL(request.url).searchParams.get("gateway");
    const resolution = await resolveGateway(
      context.db,
      context.env,
      requested && isGatewayId(requested) ? requested : undefined,
    );
    if (!resolution.ok) {
      return jsonError("SERVER_ERROR", "পেমেন্ট সেবা এই মুহূর্তে ব্যবহার করা যাচ্ছে না।");
    }

    const base = siteUrl();
    const result = await createMonetizationPayment(context.db, {
      user: context.user!,
      propertyId: parsed.data.propertyId,
      planId: parsed.data.planId,
      gateway: resolution.gateway,
      urls: {
        successUrl: `${base}/api/payments/sslcommerz/return?outcome=success`,
        failUrl: `${base}/api/payments/sslcommerz/return?outcome=fail`,
        cancelUrl: `${base}/api/payments/sslcommerz/return?outcome=cancel`,
        ipnUrl: `${base}/api/payments/sslcommerz/ipn`,
      },
    });

    switch (result.status) {
      case "NOT_FOUND":
      case "NOT_OWNER":
        // Same reply for "not yours" and "does not exist", so the endpoint
        // cannot be used to discover which listing ids are real.
        return jsonError("NOT_FOUND", "বিজ্ঞাপনটি পাওয়া যায়নি।");
      case "NOT_ELIGIBLE":
        return jsonError("CONFLICT", "শুধু অনুমোদিত বিজ্ঞাপন ফিচার্ড বা বুস্ট করা যায়।");
      case "UNKNOWN_PLAN":
        return jsonError("VALIDATION_FAILED", "প্যাকেজটি এখন আর পাওয়া যাচ্ছে না।");
      case "GATEWAY_ERROR":
        return jsonError("SERVER_ERROR", "পেমেন্ট শুরু করা যায়নি।");
      case "INSTRUCTIONS":
        return jsonOk({
          ok: true,
          manual: true,
          instructionsBn: result.instructionsBn,
          reference: result.reference,
          accountNumber: result.accountNumber,
          transactionId: result.transactionId,
        });
      default:
        return jsonOk({
          ok: true,
          manual: false,
          redirectUrl: result.redirectUrl,
          transactionId: result.transactionId,
        });
    }
  });
}
