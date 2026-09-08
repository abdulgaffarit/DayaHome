import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { advertiserRegistrationSchema } from "@/domain/advertising-schemas";
import { createAdvertiser, getAdvertiserForUser } from "@/server/advertising/advertisers";

/**
 * POST /api/advertise/advertiser — registers the signed-in user as an advertiser.
 *
 * Idempotent by design: a user who already has a profile gets it back rather
 * than an error, so a double-submit from the wizard cannot strand them.
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

    const existing = await getAdvertiserForUser(context.db, context.user!.id);
    if (existing) return jsonOk({ ok: true, advertiserId: existing.id, existing: true });

    const body = await request.json().catch(() => null);
    const parsed = advertiserRegistrationSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const result = await createAdvertiser(context.db, context.user!.id, parsed.data);
    if (!result.ok) {
      // Lost a race with a concurrent request; the profile exists either way.
      const now = await getAdvertiserForUser(context.db, context.user!.id);
      if (now) return jsonOk({ ok: true, advertiserId: now.id, existing: true });
      return jsonError("CONFLICT");
    }

    return jsonOk({ ok: true, advertiserId: result.advertiser.id, existing: false });
  });
}
