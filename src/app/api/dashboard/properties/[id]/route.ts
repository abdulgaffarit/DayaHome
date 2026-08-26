import { z } from "zod";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import {
  archiveProperty,
  renewProperty,
  setOwnerPropertyStatus,
} from "@/server/properties/mutations";

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "rented", "sold", "archive", "renew"]),
});

/**
 * PATCH /api/dashboard/properties/{id} — owner-side status changes.
 *
 * Every underlying mutation carries `AND owner_id = ?`, so passing another
 * owner's property id changes nothing and reports NOT_FOUND. The action is
 * mapped to a status here rather than accepting a raw status from the client,
 * which is what prevents an owner from self-approving a listing.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const userId = context.user!.id;

    switch (parsed.data.action) {
      case "archive": {
        const ok = await archiveProperty(context.db, userId, id);
        return ok ? jsonOk({ ok: true }) : jsonError("NOT_FOUND");
      }
      case "renew": {
        const ok = await renewProperty(context.db, userId, id);
        return ok ? jsonOk({ ok: true }) : jsonError("NOT_FOUND");
      }
      default: {
        const statusByAction = {
          pause: "PAUSED",
          resume: "APPROVED",
          rented: "RENTED",
          sold: "SOLD",
        } as const;
        const result = await setOwnerPropertyStatus(
          context.db,
          userId,
          id,
          statusByAction[parsed.data.action],
        );
        return result.ok
          ? jsonOk({ ok: true })
          : jsonError("CONFLICT", "এই অবস্থায় কাজটি করা যাবে না।");
      }
    }
  });
}
