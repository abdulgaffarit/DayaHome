import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonOk } from "@/server/http/responses";
import { viewFingerprint } from "@/server/security/request";
import { recordPropertyView } from "@/server/properties/views";

/**
 * POST /api/properties/{id}/view — records a view.
 *
 * Always answers 200 with `{ ok: true }`, even for an unknown id: view counting
 * must never become a way to test whether a listing exists.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const { id } = await params;
    const context = await buildContext(request);
    const fingerprint = await viewFingerprint(
      request,
      context.env.SESSION_SECRET ?? "dev-salt",
      context.sessionId,
    );

    try {
      await recordPropertyView(context.db, {
        propertyId: id,
        userId: context.user?.id ?? null,
        sessionHash: fingerprint,
      });
    } catch {
      // A bad id trips the foreign key; that is not worth reporting.
    }

    return jsonOk({ ok: true });
  });
}
