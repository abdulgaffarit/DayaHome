import { buildContext } from "@/server/http/context";
import { RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";
import { recordClick } from "@/server/advertising/tracking";
import type { AdDevice } from "@/domain/advertising";

/**
 * GET /api/ads/click?c=<campaignId>&r=<creativeId> — records a click and
 * redirects to the advertiser's destination.
 *
 * OPEN-REDIRECT SAFETY, which is the whole point of this endpoint existing:
 * the destination is read from the database by campaign id. There is no URL
 * parameter to point somewhere else. The only thing a caller controls is
 * WHICH campaign's own, already-validated destination they are sent to — and
 * that URL passed `destinationUrlSchema` (http/https only, no credentials)
 * before it was ever stored.
 *
 * Deliberately a GET with no CSRF check: it is a link a visitor clicks, and it
 * changes no state that belongs to them. It is rate-limited per visitor
 * instead, so it cannot be used to inflate a competitor's bill.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("c") ?? "";
  const creativeId = url.searchParams.get("r");

  // Anything unexpected sends the visitor home rather than showing an error:
  // a broken advert must not become a dead end.
  const home = new URL("/", url.origin).toString();
  if (!campaignId) return Response.redirect(home, 302);

  try {
    const context = await buildContext(request);

    const limit = await consumeRateLimit(context.db, RATE_LIMITS.adClick, context.subject);
    if (!limit.allowed) return Response.redirect(home, 302);

    const outcome = await recordClick(context.db, {
      campaignId,
      creativeId,
      // The zone comes from the campaign row inside recordClick.
      zoneId: "",
      userId: context.user?.id ?? null,
      sessionHash: context.ipHash,
      ipHash: context.ipHash,
      device: deviceFrom(request),
      refererPath: safeRefererPath(request, url.origin),
    });

    if (!outcome.ok) return Response.redirect(home, 302);

    // 302, never 301: a permanent redirect would be cached by the browser and
    // every later click would skip this endpoint, silently losing the count.
    return Response.redirect(outcome.destinationUrl, 302);
  } catch (error) {
    console.error("[ads] click handling failed", error);
    return Response.redirect(home, 302);
  }
}

function deviceFrom(request: Request): AdDevice {
  const agent = request.headers.get("user-agent") ?? "";
  return /Mobile|Android|iPhone|iPad/i.test(agent) ? "MOBILE" : "DESKTOP";
}

/** Only our own path is recorded — never a full third-party referrer. */
function safeRefererPath(request: Request, origin: string): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const parsed = new URL(referer);
    return parsed.origin === origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}
