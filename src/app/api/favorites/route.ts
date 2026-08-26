import { favoriteSchema } from "@/domain/schemas";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonOk, validationError } from "@/server/http/responses";
import { addFavorite } from "@/server/properties/favorites";

export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const parsed = favoriteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    // Idempotent: saving twice is not an error.
    const result = await addFavorite(context.db, context.user!.id, parsed.data.propertyId);
    return jsonOk({ ok: true, already: result.already });
  });
}
