import { createPropertySchema, searchQuerySchema } from "@/domain/schemas";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, jsonPublic, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import { clientIp } from "@/server/security/request";
import { searchProperties } from "@/server/properties/queries";
import { createProperty } from "@/server/properties/mutations";

/**
 * GET /api/properties — public, filtered listing search.
 *
 * Returns card projections only; the response is cacheable precisely because it
 * contains no private field.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const context = await buildContext(request);
    const url = new URL(request.url);
    const query = searchQuerySchema.parse(Object.fromEntries(url.searchParams));
    const results = await searchProperties(context.db, query);
    return jsonPublic(results, 60);
  });
}

/**
 * POST /api/properties — creates a listing.
 *
 * The owner is taken from the session, never from the body, and the status is
 * forced to PENDING inside `createProperty`.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.createProperty, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = createPropertySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const captcha = await verifyTurnstile(
      parsed.data.turnstileToken,
      context.env.TURNSTILE_SECRET,
      clientIp(request),
    );
    if (!captcha.success) return jsonError("CAPTCHA_FAILED");

    const result = await createProperty(context.db, context.user!.id, parsed.data);
    if (!result.ok) {
      const messages: Record<string, string> = {
        UNKNOWN_CATEGORY: "ক্যাটাগরি সঠিক নয়।",
        UNKNOWN_AREA: "এলাকা সঠিক নয়।",
        NO_VALID_IMAGES: "কমপক্ষে একটি ছবি আপলোড করুন।",
      };
      return jsonError("VALIDATION_FAILED", messages[result.reason]);
    }

    return jsonOk({ ok: true, id: result.id, slug: result.slug, status: result.status });
  });
}
