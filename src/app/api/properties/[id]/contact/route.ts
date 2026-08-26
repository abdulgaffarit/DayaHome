import { contactUnlockPriceBdt } from "@/server/cloudflare/env";
import { buildContext } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { resolveContact } from "@/server/properties/contact";

/**
 * GET /api/properties/{id}/contact
 *
 * The single door to private contact information. The authorization chain lives
 * in `resolveContact`:
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

    const result = await resolveContact(context.db, id, context.user, priceBdt);

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
