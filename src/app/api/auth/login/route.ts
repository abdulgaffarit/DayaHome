import { loginSchema } from "@/domain/schemas";
import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, clearRateLimit, consumeRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import { clientIp } from "@/server/security/request";
import { loginUser } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/cookies";

export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    // Two buckets: one per IP (stops a spray across many accounts) and one per
    // identifier (stops a slow brute force against a single account).
    const [byIp, byIdentifier] = await Promise.all([
      consumeRateLimit(context.db, RATE_LIMITS.login, `ip:${context.ipHash}`),
      consumeRateLimit(context.db, RATE_LIMITS.login, `id:${parsed.data.identifier.toLowerCase()}`),
    ]);
    if (!byIp.allowed || !byIdentifier.allowed) return jsonError("RATE_LIMITED");

    const captcha = await verifyTurnstile(
      parsed.data.turnstileToken,
      context.env.TURNSTILE_SECRET,
      clientIp(request),
    );
    if (!captcha.success) return jsonError("CAPTCHA_FAILED");

    const result = await loginUser(context.db, parsed.data, {
      ipHash: context.ipHash,
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      if (result.reason === "SUSPENDED") {
        return jsonError("FORBIDDEN", "আপনার অ্যাকাউন্ট সাময়িকভাবে বন্ধ আছে। সহায়তার জন্য যোগাযোগ করুন।");
      }
      // Deliberately identical for "no such account" and "wrong password".
      return jsonError("UNAUTHORIZED", "মোবাইল নম্বর/ইমেইল বা পাসওয়ার্ড সঠিক নয়।");
    }

    // A successful login clears the counter so a user who simply mistyped is
    // not left locked out.
    await clearRateLimit(context.db, RATE_LIMITS.login, `id:${parsed.data.identifier.toLowerCase()}`);
    await setSessionCookie(result.token);

    return jsonOk({ ok: true, user: { name: result.user.name, role: result.user.role } });
  });
}
