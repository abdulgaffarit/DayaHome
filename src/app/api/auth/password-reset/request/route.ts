import { requestPasswordResetSchema } from "@/domain/schemas";
import { siteUrl } from "@/server/cloudflare/env";
import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import { clientIp } from "@/server/security/request";
import { requestPasswordReset } from "@/server/auth/password-reset";
import { getEmailProvider } from "@/server/email/factory";

/**
 * POST /api/auth/password-reset/request
 *
 * ANTI-ENUMERATION: the response is identical whether the identifier matched an
 * account, matched a phone-only account with no email, or matched nothing at
 * all. The real outcome is logged server-side and never returned.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);

    // Two buckets: per IP, and per identifier so one address cannot be
    // mail-bombed from many sources.
    const parsed = requestPasswordResetSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const [byIp, byIdentifier] = await Promise.all([
      consumeRateLimit(context.db, RATE_LIMITS.passwordReset, `ip:${context.ipHash}`),
      consumeRateLimit(
        context.db,
        RATE_LIMITS.passwordReset,
        `id:${parsed.data.identifier.toLowerCase()}`,
      ),
    ]);
    if (!byIp.allowed || !byIdentifier.allowed) return jsonError("RATE_LIMITED");

    const captcha = await verifyTurnstile(
      parsed.data.turnstileToken,
      context.env.TURNSTILE_SECRET,
      clientIp(request),
    );
    if (!captcha.success) return jsonError("CAPTCHA_FAILED");

    const outcome = await requestPasswordReset(
      context.db,
      parsed.data.identifier,
      getEmailProvider(),
      siteUrl(),
    );

    if (!outcome.sent) {
      console.info(`[password-reset] no email sent: ${outcome.reason}`);
    }

    // Always the same answer.
    return jsonOk({ ok: true });
  });
}
