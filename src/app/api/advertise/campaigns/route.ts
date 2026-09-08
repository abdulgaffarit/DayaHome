import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { campaignDraftSchema } from "@/domain/advertising-schemas";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { createCampaign } from "@/server/advertising/campaigns";

/**
 * POST /api/advertise/campaigns — creates a DRAFT campaign.
 *
 * The body carries no price: `createCampaign` reads it from the package row,
 * the same rule that keeps the contact-unlock price off the wire.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createCampaign, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const advertiser = await getAdvertiserForUser(context.db, context.user!.id);
    if (!advertiser) {
      return jsonError("FORBIDDEN", "প্রথমে ব্যবসার তথ্য দিন।");
    }
    if (advertiser.status === "SUSPENDED" || advertiser.status === "REJECTED") {
      return jsonError("FORBIDDEN", "আপনার বিজ্ঞাপনদাতা অ্যাকাউন্টটি সক্রিয় নয়।");
    }

    const body = await request.json().catch(() => null);
    const parsed = campaignDraftSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const result = await createCampaign(context.db, {
      // Ownership comes from the session, never from the request body.
      advertiserId: advertiser.id,
      ...parsed.data,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        UNKNOWN_PACKAGE: "প্যাকেজটি এখন আর পাওয়া যাচ্ছে না।",
        UNKNOWN_ZONE: "জোনটি পাওয়া যায়নি।",
        ZONE_DISABLED: "এই জোনে এখন বিজ্ঞাপন নেওয়া হচ্ছে না।",
        ZONE_NOT_RENDERED: "এই জোনটি এখনো সাইটে দেখানো হয় না, তাই বিক্রি করা হচ্ছে না।",
        PACKAGE_ZONE_MISMATCH: "এই প্যাকেজটি নির্বাচিত জোনে ব্যবহার করা যাবে না।",
      };
      return jsonError("VALIDATION_FAILED", messages[result.reason]);
    }

    return jsonOk({
      ok: true,
      campaignId: result.campaign.id,
      publicRef: result.campaign.public_ref,
      priceBdt: result.campaign.price_bdt,
      durationDays: result.campaign.duration_days,
    });
  });
}
