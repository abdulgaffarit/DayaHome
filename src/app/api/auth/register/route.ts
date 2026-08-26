import { registerSchema } from "@/domain/schemas";
import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";
import { clientIp } from "@/server/security/request";
import { registerUser } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/cookies";

export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.register, context.ipHash);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = registerSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const captcha = await verifyTurnstile(
      parsed.data.turnstileToken,
      context.env.TURNSTILE_SECRET,
      clientIp(request),
    );
    if (!captcha.success) return jsonError("CAPTCHA_FAILED");

    const result = await registerUser(context.db, parsed.data, {
      ipHash: context.ipHash,
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.ok) {
      // Reported against the field the user filled in — not as "this number is
      // already registered", which would confirm an account exists.
      return validationError(
        result.reason === "DUPLICATE_PHONE"
          ? { phone: ["এই মোবাইল নম্বর দিয়ে অ্যাকাউন্ট তৈরি করা যাচ্ছে না। লগইন করুন বা অন্য নম্বর দিন।"] }
          : { email: ["এই ইমেইল দিয়ে অ্যাকাউন্ট তৈরি করা যাচ্ছে না। লগইন করুন বা অন্য ইমেইল দিন।"] },
      );
    }

    await setSessionCookie(result.token);
    return jsonOk({ ok: true, user: { name: result.user.name, role: result.user.role } });
  });
}
