import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { renewCampaign } from "@/server/advertising/campaigns";

/**
 * POST /api/advertise/campaigns/[id]/renew — starts a renewal.
 *
 * The renewal is a NEW campaign in DRAFT, priced at today's rate. It is paid
 * for and reviewed like any other, so renewing does not put an unreviewed
 * banner back on the site.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createCampaign, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const advertiser = await getAdvertiserForUser(context.db, context.user!.id);
    if (!advertiser) return jsonError("FORBIDDEN", "প্রথমে ব্যবসার তথ্য দিন।");

    const { id } = await params;
    const result = await renewCampaign(context.db, {
      campaignId: id,
      advertiserId: advertiser.id,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        NOT_FOUND: "ক্যাম্পেইনটি পাওয়া যায়নি।",
        NOT_RENEWABLE: "শুধু চলমান বা মেয়াদোত্তীর্ণ ক্যাম্পেইন নবায়ন করা যায়।",
        UNKNOWN_PACKAGE: "আগের প্যাকেজটি এখন আর পাওয়া যাচ্ছে না।",
      };
      const status = result.reason === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT";
      return jsonError(status, messages[result.reason]);
    }

    return jsonOk({
      ok: true,
      campaignId: result.campaign.id,
      publicRef: result.campaign.public_ref,
      priceBdt: result.campaign.price_bdt,
    });
  });
}
