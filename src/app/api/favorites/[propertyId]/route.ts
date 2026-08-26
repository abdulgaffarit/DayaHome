import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonOk } from "@/server/http/responses";
import { removeFavorite } from "@/server/properties/favorites";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const { propertyId } = await params;
    // Scoped to the caller's own user id, so this cannot delete someone else's
    // saved item even with a guessed property id.
    await removeFavorite(context.db, context.user!.id, propertyId);
    return jsonOk({ ok: true });
  });
}
