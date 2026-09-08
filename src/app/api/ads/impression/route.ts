import { buildContext, requireSameOrigin } from "@/server/http/context";
import { guarded, jsonOk } from "@/server/http/responses";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { recordImpression } from "@/server/advertising/tracking";
import { queryOne } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import type { AdDevice } from "@/domain/advertising";

/**
 * POST /api/ads/impression — records that an advert was seen.
 *
 * Always replies 200. An impression is telemetry, not a transaction: telling a
 * caller that their view was a duplicate, or that the campaign is not
 * servable, would leak campaign state to anyone who asked. The response says
 * nothing beyond "received".
 *
 * The zone is read from the campaign row rather than taken from the body, so a
 * caller cannot attribute a view to a zone the campaign never ran in.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    const csrf = requireSameOrigin(request);
    if (csrf) return csrf;

    const context = await buildContext(request);

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.adClick, context.subject);
    if (!limit.allowed) return jsonOk({ ok: true });

    const body = (await request.json().catch(() => null)) as {
      campaignId?: unknown;
      creativeId?: unknown;
      pagePath?: unknown;
    } | null;

    const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
    const creativeId = typeof body?.creativeId === "string" ? body.creativeId : null;
    const pagePath = typeof body?.pagePath === "string" ? body.pagePath : null;
    if (!campaignId) return jsonOk({ ok: true });

    // Only a campaign that is genuinely servable right now may accrue views.
    // The window is compared against nowIso(), never SQLite's datetime('now').
    // Timestamps here are ISO-8601 with a 'T' and a trailing 'Z' and are
    // compared as TEXT; datetime('now') emits "YYYY-MM-DD HH:MM:SS" instead,
    // and 'T' > ' ', so a campaign that started earlier the SAME day would
    // read as not-yet-started and quietly lose its first day of impressions.
    const now = nowIso();
    const campaign = await queryOne<{ zone_id: string }>(
      context.db,
      `SELECT c.zone_id
         FROM advertisement_campaigns c
         JOIN payments pay ON pay.id = c.payment_id AND pay.status = 'PAID'
        WHERE c.id = ? AND c.status = 'ACTIVE'
          AND c.start_at IS NOT NULL AND c.start_at <= ?
          AND c.end_at   IS NOT NULL AND c.end_at   >  ?`,
      [campaignId, now, now],
    );
    if (!campaign) return jsonOk({ ok: true });

    await recordImpression(context.db, {
      campaignId,
      creativeId,
      zoneId: campaign.zone_id,
      userId: context.user?.id ?? null,
      sessionHash: context.ipHash,
      device: deviceFrom(request),
      pagePath,
    });

    return jsonOk({ ok: true });
  });
}

function deviceFrom(request: Request): AdDevice {
  const agent = request.headers.get("user-agent") ?? "";
  return /Mobile|Android|iPhone|iPad/i.test(agent) ? "MOBILE" : "DESKTOP";
}
