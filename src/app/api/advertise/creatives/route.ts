import { getPropertyImagesBucket } from "@/server/cloudflare/env";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { addCreative, MAX_BANNER_BYTES } from "@/server/advertising/creatives";
import { CREATIVE_VARIANTS, type CreativeVariant } from "@/domain/advertising";

/**
 * POST /api/advertise/creatives — uploads one banner.
 *
 * The declared filename and Content-Type are ignored: `addCreative` decides the
 * real format from the magic bytes and generates the object key itself.
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

    const advertiser = await getAdvertiserForUser(context.db, context.user!.id);
    if (!advertiser) return jsonError("FORBIDDEN", "প্রথমে ব্যবসার তথ্য দিন।");

    // Reject an oversized body before reading it into memory.
    const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(declared) && declared > MAX_BANNER_BYTES + 8192) {
      return jsonError("BAD_REQUEST", "ব্যানারের আকার সর্বোচ্চ ২ এমবি হতে পারে।");
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const campaignId = String(form?.get("campaignId") ?? "");
    const altBn = String(form?.get("altBn") ?? "").trim();
    const rawVariant = String(form?.get("variant") ?? "DESKTOP");

    if (!(file instanceof File)) return jsonError("BAD_REQUEST", "কোনো ব্যানার পাওয়া যায়নি।");
    if (!campaignId) return jsonError("BAD_REQUEST", "ক্যাম্পেইন আইডি নেই।");
    if (altBn.length < 2) {
      return jsonError("VALIDATION_FAILED", "ব্যানারের বিকল্প টেক্সট (alt) দিন।");
    }
    if (!(CREATIVE_VARIANTS as readonly string[]).includes(rawVariant)) {
      return jsonError("BAD_REQUEST", "ব্যানারের ধরন সঠিক নয়।");
    }

    const result = await addCreative(context.db, getPropertyImagesBucket(), {
      advertiserId: advertiser.id,
      campaignId,
      uploadedBy: context.user!.id,
      variant: rawVariant as CreativeVariant,
      altBn,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        NOT_FOUND: "ক্যাম্পেইনটি পাওয়া যায়নি।",
        NOT_EDITABLE: "চালু ক্যাম্পেইনের ব্যানার পরিবর্তন করা যাবে না।",
        TOO_LARGE: "ব্যানারের আকার সর্বোচ্চ ২ এমবি হতে পারে।",
        EMPTY: "ফাইলটি খালি।",
        UNSUPPORTED_TYPE: "শুধু JPG, PNG বা WebP ব্যানার আপলোড করা যাবে।",
        TOO_MANY: "এই প্যাকেজে আর ব্যানার যোগ করা যাবে না।",
      };
      const status = result.reason === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_FAILED";
      return jsonError(status, messages[result.reason]);
    }

    return jsonOk({
      ok: true,
      id: result.creative.id,
      url: `/api/images/${result.creative.object_key}`,
      variant: result.creative.variant,
      width: result.creative.width,
      height: result.creative.height,
    });
  });
}
