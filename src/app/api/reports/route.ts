import { createReportSchema } from "@/domain/schemas";
import { buildContext, requireAuth, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonError, jsonOk, validationError } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { createReport } from "@/server/properties/reports";

export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.report, context.subject);
    if (!limit.allowed) return jsonError("RATE_LIMITED");

    const parsed = createReportSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

    const result = await createReport(context.db, {
      propertyId: parsed.data.propertyId,
      reporterId: context.user!.id,
      reason: parsed.data.reason,
      details: parsed.data.details,
    });

    if (!result.ok) {
      if (result.reason === "DUPLICATE") {
        return jsonError("CONFLICT", "আপনি ইতিমধ্যে এই বিজ্ঞাপনটি রিপোর্ট করেছেন।");
      }
      return jsonError("NOT_FOUND");
    }
    return jsonOk({ ok: true });
  });
}
