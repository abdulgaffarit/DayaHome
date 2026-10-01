import { contactUnlockPriceBdt } from "@/server/cloudflare/env";
import { buildContext } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { resolveContactAccess } from "@/server/properties/contact";
import { recordAdminAction } from "@/server/admin/audit";

/**
 * GET /api/properties/{id}/contact
 *
 * The single door to private contact information. The authorization chain lives
 * in `resolveContactAccess`:
 *   1. authenticate the caller
 *   2. verify the property exists
 *   3. verify an unlock exists for THIS user and THIS property
 *   4. verify its status is ACTIVE and the backing payment is PAID
 * Anything short of all four returns `{ locked: true }` and no private field.
 *
 * The response is `no-store`, so a shared cache or the browser's back-forward
 * cache can never hand one user's unlocked details to another.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const context = await buildContext(request);
    const priceBdt = contactUnlockPriceBdt();

    // Throttled per caller: an attacker who obtained a session cannot sweep
    // every listing id looking for one that happens to be unlocked.
    const limit = await consumeRateLimit(context.db, RATE_LIMITS.contact, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const { response: result, via } = await resolveContactAccess(
      context.db,
      id,
      context.user,
      priceBdt,
    );

    // Staff can read these details without paying, so every such read is
    // recorded. Owners viewing their own listing are not staff access and are
    // not logged. Awaited rather than fired-and-forgotten: on Workers, work
    // left running after the response is not guaranteed to complete, and an
    // audit trail that silently drops entries is worse than none.
    if (via === "STAFF" && context.user) {
      await recordAdminAction(context.db, {
        adminId: context.user.id,
        action: "CONTACT_VIEWED",
        entityType: "property",
        entityId: id,
        metadata: { via },
        ipHash: context.ipHash,
      });
    }

    if (result.locked) {
      // 401 when the caller simply is not signed in, 402 when they are but have
      // not paid. Nothing else distinguishes a missing listing from a locked one.
      const status = result.reason === "AUTH_REQUIRED" ? 401 : 402;
      return Response.json(result, {
        status,
        headers: { "Cache-Control": "no-store, private" },
      });
    }

    return jsonOk(result);
  });
}
