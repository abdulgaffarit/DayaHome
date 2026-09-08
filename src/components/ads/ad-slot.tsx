import Link from "next/link";
import { getDb } from "@/server/cloudflare/env";
import { selectAd, type ServeContext } from "@/server/advertising/serving";
import { AdImpressionBeacon } from "./impression-beacon";

/**
 * Renders one advertisement in a zone.
 *
 * STRUCTURAL SAFETY: this component builds every element itself. The only
 * advertiser-supplied values that reach the DOM are an image URL derived from
 * a server-generated R2 key and alt text placed as a text attribute — both
 * escaped by React. There is no `dangerouslySetInnerHTML` here and no column
 * in the schema that could carry markup, so an advertiser has no path to
 * inject HTML or script into a page.
 *
 * The href points at our own click endpoint, never at the advertiser's URL
 * directly, so a click is counted and re-validated before the redirect.
 *
 * Renders nothing at all when no campaign is eligible — an empty zone must
 * leave no gap and no placeholder.
 */
export async function AdSlot({
  zoneSlug,
  device = "DESKTOP",
  locationId,
  categoryId,
  locationSlug,
  categorySlug,
  sessionHash,
  className,
}: {
  zoneSlug: string;
  device?: ServeContext["device"];
  locationId?: string | null;
  categoryId?: string | null;
  locationSlug?: string | null;
  categorySlug?: string | null;
  sessionHash?: string | null;
  className?: string;
}) {
  let ad = null;
  try {
    ad = await selectAd(getDb(), {
      zoneSlug,
      device,
      locationId,
      categoryId,
      locationSlug,
      categorySlug,
      sessionHash,
    });
  } catch (error) {
    // An advert is decoration on someone else's content. A serving failure
    // must never take the host page down with it.
    console.error("[ads] serving failed", zoneSlug, error);
    return null;
  }

  if (!ad) return null;

  return (
    <aside className={className} aria-label="বিজ্ঞাপন">
      <Link
        href={`/api/ads/click?c=${encodeURIComponent(ad.campaignId)}&r=${encodeURIComponent(ad.creativeId)}`}
        // The destination is third-party: deny it window.opener and referrer,
        // and mark the relationship for search engines.
        rel="sponsored nofollow noopener noreferrer"
        target="_blank"
        className="block overflow-hidden rounded-[--radius-card] border border-ink-100"
      >
        { }
        <img
          src={`/api/images/${ad.objectKey}`}
          alt={ad.altBn}
          width={ad.width ?? undefined}
          height={ad.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="w-full object-contain"
        />
      </Link>
      <p className="mt-1 text-center text-[0.7rem] uppercase tracking-wide text-ink-400">
        বিজ্ঞাপন
      </p>
      <AdImpressionBeacon campaignId={ad.campaignId} creativeId={ad.creativeId} />
    </aside>
  );
}
