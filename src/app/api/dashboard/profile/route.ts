import { updateProfileSchema } from "@/domain/schemas";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonOk, validationError } from "@/server/http/responses";
import { execute, isUniqueViolation } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import { changePassword } from "@/server/auth/service";
import { destroyAllSessions } from "@/server/auth/session";
import { createSession } from "@/server/auth/session";
import { setSessionCookie } from "@/server/auth/cookies";

export async function PATCH(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const parsed = updateProfileSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const user = context.user!;
    const { name, email, currentPassword, newPassword } = parsed.data;

    if (newPassword) {
      if (!currentPassword) {
        return validationError({ currentPassword: ["বর্তমান পাসওয়ার্ড দিন"] });
      }
      const result = await changePassword(context.db, user.id, currentPassword, newPassword);
      if (!result.ok) {
        return validationError({ currentPassword: ["বর্তমান পাসওয়ার্ড সঠিক নয়"] });
      }
      // A password change invalidates every session, then issues a fresh one
      // for this device so the user is not logged out of the page they are on.
      await destroyAllSessions(context.db, user.id);
      const { token } = await createSession(context.db, user.id, {
        ipHash: context.ipHash,
        userAgent: request.headers.get("user-agent"),
      });
      await setSessionCookie(token);
    }

    try {
      await execute(
        context.db,
        `UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?`,
        [name, email ?? null, nowIso(), user.id],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return validationError({ email: ["এই ইমেইল ইতিমধ্যে ব্যবহৃত হচ্ছে"] });
      }
      throw error;
    }

    return jsonOk({ ok: true });
  });
}
