import { createPaymentSchema } from "@/domain/schemas";
import { contactUnlockPriceBdt, siteUrl } from "@/server/cloudflare/env";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { getPaymentProvider } from "@/server/payments/factory";
import { createUnlockPayment } from "@/server/payments/unlock-service";

/**
 * POST /api/payments/create
 *
 * Body: `{ propertyId }` — and nothing else. There is no `amount` field in the
 * schema, so a client that sends one has it discarded by Zod before the handler
 * ever sees it. The charge comes from `contactUnlockPriceBdt()`, which reads
 * server configuration.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createPayment, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = createPaymentSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    let provider;
    try {
      provider = getPaymentProvider();
    } catch (error) {
      console.error("[payments] provider unavailable", error);
      return jsonError("SERVER_ERROR", "পেমেন্ট সেবা এই মুহূর্তে ব্যবহার করা যাচ্ছে না।");
    }

    const base = siteUrl();
    const result = await createUnlockPayment(context.db, {
      user: context.user!,
      propertyId: parsed.data.propertyId,
      priceBdt: contactUnlockPriceBdt(),
      provider,
      urls: {
        successUrl: `${base}/api/payments/sslcommerz/return?outcome=success`,
        failUrl: `${base}/api/payments/sslcommerz/return?outcome=fail`,
        cancelUrl: `${base}/api/payments/sslcommerz/return?outcome=cancel`,
        ipnUrl: `${base}/api/payments/sslcommerz/ipn`,
      },
    });

    switch (result.status) {
      case "REDIRECT":
        return jsonOk({ ok: true, redirectUrl: result.redirectUrl, transactionId: result.transactionId });
      case "ALREADY_UNLOCKED":
        // No second charge for a property this user already paid for.
        return jsonOk({ ok: true, alreadyUnlocked: true });
      case "OWN_PROPERTY":
        return jsonOk({ ok: true, alreadyUnlocked: true });
      case "NOT_FOUND":
        return jsonError("NOT_FOUND", "বিজ্ঞাপনটি পাওয়া যায়নি।");
      case "GATEWAY_ERROR":
        console.error("[payments] gateway session failed", result.reason);
        return jsonError("SERVER_ERROR", "পেমেন্ট শুরু করা যায়নি। একটু পরে আবার চেষ্টা করুন।");
    }
  });
}
