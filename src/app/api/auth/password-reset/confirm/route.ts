import { resetPasswordSchema } from "@/domain/schemas";
import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { resetPassword } from "@/server/auth/password-reset";

/**
 * POST /api/auth/password-reset/confirm
 *
 * Deliberately does NOT sign the user in afterwards. Completing a reset proves
 * control of the mailbox, not of the account; making them log in with the new
 * password keeps the session tied to a real credential entry.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);

    // Throttled so a leaked-but-unknown token cannot be brute-forced.
    const limit = await consumeRateLimit(
      context.db,
      RATE_LIMITS.passwordReset,
      `confirm:${context.ipHash}`,
    );
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const result = await resetPassword(context.db, parsed.data.token, parsed.data.password);

    if (!result.ok) {
      const messages = {
        INVALID_TOKEN: "লিংকটি সঠিক নয়। আবার নতুন করে অনুরোধ করুন।",
        EXPIRED: "লিংকের মেয়াদ শেষ হয়ে গেছে। আবার নতুন করে অনুরোধ করুন।",
        ALREADY_USED: "এই লিংকটি ইতিমধ্যে ব্যবহার করা হয়েছে। আবার নতুন করে অনুরোধ করুন।",
      } as const;
      return jsonError("BAD_REQUEST", messages[result.reason]);
    }

    return jsonOk({ ok: true });
  });
}
