import { siteUrl } from "@/server/cloudflare/env";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { resolveGateway } from "@/server/payments/registry";
import { isGatewayId } from "@/domain/payments";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { createCampaignPayment } from "@/server/advertising/payments";

/**
 * POST /api/advertise/campaigns/[id]/pay — opens a payment for a campaign.
 *
 * No amount crosses the wire. `createCampaignPayment` charges the campaign's
 * own `price_bdt`, which was copied from the package at creation.
 *
 * Nothing here knows which gateway will be used: the registry picks one that
 * is both enabled and configured, and the campaign lifecycle is identical
 * whichever it is. Adding bKash later changes nothing in this file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createPayment, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const advertiser = await getAdvertiserForUser(context.db, context.user!.id);
    if (!advertiser) return jsonError("FORBIDDEN", "প্রথমে ব্যবসার তথ্য দিন।");

    const requested = new URL(request.url).searchParams.get("gateway");
    const resolution = await resolveGateway(
      context.db,
      context.env,
      requested && isGatewayId(requested) ? requested : undefined,
    );
    if (!resolution.ok) {
      console.error("[advertising] no usable gateway is enabled and configured");
      return jsonError("SERVER_ERROR", "পেমেন্ট সেবা এই মুহূর্তে ব্যবহার করা যাচ্ছে না।");
    }

    const base = siteUrl();
    const { id } = await params;

    const result = await createCampaignPayment(context.db, {
      user: context.user!,
      // From the session, so a campaign id alone proves nothing.
      advertiserId: advertiser.id,
      campaignId: id,
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
        return jsonError("NOT_FOUND", "ক্যাম্পেইনটি পাওয়া যায়নি।");
      case "NOT_PAYABLE":
        return jsonError("CONFLICT", "এই ক্যাম্পেইনের জন্য এখন পেমেন্ট করা যাবে না।");
      case "GATEWAY_ERROR":
        return jsonError("SERVER_ERROR", "পেমেন্ট শুরু করা যায়নি। একটু পরে আবার চেষ্টা করুন।");
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
