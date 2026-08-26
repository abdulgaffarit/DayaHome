import Link from "next/link";
import { Bath, BedDouble, ImageOff, MapPin, Ruler } from "lucide-react";
import type { PropertyCardData } from "@/domain/property";
import { formatPrice, formatRelativeBanglaDate, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";
import { FeaturedBadge, StatusBadge, VerifiedBadge } from "@/components/ui/badge";
import { FavoriteButton } from "./favorite-button";

/**
 * The listing card.
 *
 * PRIVACY: it renders only fields from `PropertyCardData`, which by
 * construction has no phone number and no exact location. Cards deliberately
 * show the neighbourhood name and nothing finer.
 *
 * Designed to hold together at 360px: the media keeps a fixed 4:3 ratio, the
 * title clamps to two lines, and the meta row wraps instead of overflowing.
 */
export function PropertyCard({
  property,
  saved = false,
  showStatus = false,
  layout = "grid",
  priority = false,
}: {
  property: PropertyCardData;
  saved?: boolean;
  /** Owners and admins see the real status; public grids do not. */
  showStatus?: boolean;
  layout?: "grid" | "list";
  /** Eager-load the first few images above the fold. */
  priority?: boolean;
}) {
  const href = `/property/${property.slug}`;
  const isList = layout === "list";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[--radius-card] border border-ink-100 bg-white shadow-[--shadow-card] transition-shadow duration-200 hover:shadow-[--shadow-card-hover]",
        isList && "sm:flex",
      )}
    >
      <div className={cn("relative shrink-0 bg-ink-100", isList ? "sm:w-64" : "")}>
        <Link href={href} tabIndex={-1} aria-hidden="true" className="block">
          <div className={cn("relative aspect-[4/3] w-full overflow-hidden", isList && "sm:h-full")}>
            {property.primaryImageKey ? (
              <img
                src={`/api/images/${property.primaryImageKey}`}
                alt=""
                loading={priority ? "eager" : "lazy"}
                fetchPriority={priority ? "high" : "auto"}
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-400">
                <ImageOff className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
          </div>
        </Link>

        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          {property.isFeatured ? <FeaturedBadge /> : null}
          {showStatus ? <StatusBadge status={property.status} /> : null}
        </div>

        <FavoriteButton
          propertyId={property.id}
          initialSaved={saved}
          className="absolute right-3 top-3 z-10"
        />
      </div>

      <div className={cn("flex flex-1 flex-col p-4", isList && "sm:p-5")}>
        <h3 className="text-[1.02rem] font-semibold leading-snug text-ink-900">
          {/* Stretched link: the whole card is clickable, but only this is a
              link in the accessibility tree. */}
          <Link href={href} className="line-clamp-2-safe after:absolute after:inset-0">
            {property.title}
          </Link>
        </h3>

        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500">
          <MapPin className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span className="line-clamp-1-safe">{property.areaNameBn}</span>
        </p>

        <p className="mt-3 text-lg font-bold text-brand-700">
          {formatPrice(property.price, property.pricePeriod, { compact: property.price >= 100_000 })}
        </p>

        {(property.bedrooms !== null ||
          property.bathrooms !== null ||
          property.sizeValue !== null) && (
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-600">
            {property.bedrooms !== null ? (
              <MetaItem icon={<BedDouble className="h-4 w-4" aria-hidden="true" />}>
                {toBanglaDigits(property.bedrooms)} বেড
              </MetaItem>
            ) : null}
            {property.bathrooms !== null ? (
              <MetaItem icon={<Bath className="h-4 w-4" aria-hidden="true" />}>
                {toBanglaDigits(property.bathrooms)} বাথ
              </MetaItem>
            ) : null}
            {property.sizeValue !== null ? (
              <MetaItem icon={<Ruler className="h-4 w-4" aria-hidden="true" />}>
                {toBanglaDigits(property.sizeValue)} {property.sizeUnit ?? "স্কয়ার ফুট"}
              </MetaItem>
            ) : null}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-ink-100 pt-3 text-xs text-ink-500">
          <span>{formatRelativeBanglaDate(property.publishedAt ?? property.createdAt)}</span>
          {property.isVerified ? <VerifiedBadge /> : null}
        </div>
      </div>
    </article>
  );
}

function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="text-ink-400">{icon}</span>
      {children}
    </li>
  );
}
