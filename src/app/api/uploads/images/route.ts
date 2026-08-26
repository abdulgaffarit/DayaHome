import { getPropertyImagesBucket } from "@/server/cloudflare/env";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { MAX_IMAGE_BYTES, storeImage } from "@/server/storage/images";
import { execute } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * POST /api/uploads/images — uploads one property photo to R2.
 *
 * The row is created with `property_id = NULL` and `uploaded_by = <caller>`;
 * `createProperty` later claims only rows that match both, so an uploaded image
 * can never be attached to somebody else's listing.
 *
 * The declared filename and Content-Type are ignored entirely: the real format
 * is sniffed from the magic bytes and the object key is generated server-side.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.upload, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    // Reject an oversized body before reading it into memory.
    const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES + 8192) {
      return jsonError("BAD_REQUEST", "ছবির আকার সর্বোচ্চ ৫ এমবি হতে পারে।");
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("BAD_REQUEST", "কোনো ছবি পাওয়া যায়নি।");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeImage(getPropertyImagesBucket(), context.user!.id, { bytes });

    if (!stored.ok) {
      const messages = {
        TOO_LARGE: "ছবির আকার সর্বোচ্চ ৫ এমবি হতে পারে।",
        UNSUPPORTED_TYPE: "শুধু JPG, PNG বা WebP ছবি আপলোড করা যাবে।",
        EMPTY: "ফাইলটি খালি।",
      } as const;
      return jsonError("VALIDATION_FAILED", messages[stored.reason]);
    }

    const id = newId("img");
    await execute(
      context.db,
      `INSERT INTO property_images
         (id, property_id, uploaded_by, object_key, mime_type, size_bytes, width, height, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        context.user!.id,
        stored.image.objectKey,
        stored.image.mime,
        stored.image.sizeBytes,
        stored.image.width,
        stored.image.height,
        nowIso(),
      ],
    );

    return jsonOk({
      ok: true,
      id,
      url: `/api/images/${stored.image.objectKey}`,
      width: stored.image.width,
      height: stored.image.height,
    });
  });
}
