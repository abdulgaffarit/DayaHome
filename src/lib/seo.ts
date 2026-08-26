import type { Metadata } from "next";
import type { CategoryDef } from "@/domain/categories";
import type { PublicProperty } from "@/domain/property";
import { formatPrice } from "./bangla";

/** Category landing-page metadata, derived from the category definition. */
export function categoryMetadata(category: CategoryDef): Metadata {
  return {
    title: category.metaTitleBn,
    description: category.metaDescriptionBn,
    alternates: { canonical: `/${category.slug}` },
    openGraph: {
      type: "website",
      locale: "bn_BD",
      title: category.metaTitleBn,
      description: category.metaDescriptionBn,
      url: `/${category.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: category.metaTitleBn,
      description: category.metaDescriptionBn,
    },
  };
}

/**
 * Listing metadata.
 *
 * PRIVACY: built only from `PublicProperty`, so the phone number and exact
 * address cannot reach `<meta>` tags, the OG description, or the page title.
 */
export function propertyMetadata(
  property: PublicProperty,
  imageUrl: string | null,
): Metadata {
  const price = formatPrice(property.price, property.pricePeriod, { compact: true });
  const title = `${property.title} — ${property.areaNameBn}, দয়ারামপুর`;
  const description = truncate(
    `${property.categoryNameBn} · ${property.areaNameBn} · ${price}। ${property.description.replace(/\s+/g, " ")}`,
    160,
  );

  return {
    title,
    description,
    alternates: { canonical: `/property/${property.slug}` },
    openGraph: {
      type: "website",
      locale: "bn_BD",
      title,
      description,
      url: `/property/${property.slug}`,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

/**
 * JSON-LD for a listing.
 *
 * Modelled as an `Offer` on a `Residence`/`Product`-shaped item. Crucially it
 * omits `telephone` and `streetAddress`: publishing those would give away the
 * paid contact details in the page source. `addressLocality` is the
 * neighbourhood name, which is exactly what the public page already shows.
 */
export function propertyJsonLd(
  property: PublicProperty,
  siteBaseUrl: string,
  imageUrls: string[],
) {
  const url = `${siteBaseUrl}/property/${property.slug}`;
  const isRental = property.pricePeriod !== "TOTAL";

  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": url,
    url,
    name: property.title,
    description: truncate(property.description.replace(/\s+/g, " "), 400),
    datePosted: property.publishedAt ?? property.createdAt,
    inLanguage: "bn-BD",
    image: imageUrls,
    identifier: property.publicId,
    // Coarse location only — no street address, no geo coordinates.
    address: {
      "@type": "PostalAddress",
      addressLocality: property.areaNameBn,
      addressRegion: "নাটোর",
      addressCountry: "BD",
    },
    offers: {
      "@type": "Offer",
      price: property.price,
      priceCurrency: "BDT",
      availability: "https://schema.org/InStock",
      ...(isRental
        ? { priceSpecification: { "@type": "UnitPriceSpecification", price: property.price, priceCurrency: "BDT", unitCode: property.pricePeriod === "MONTHLY" ? "MON" : "ANN" } }
        : {}),
    },
    ...(property.bedrooms !== null ? { numberOfBedrooms: property.bedrooms } : {}),
    ...(property.bathrooms !== null ? { numberOfBathroomsTotal: property.bathrooms } : {}),
    ...(property.sizeValue !== null
      ? {
          floorSize: {
            "@type": "QuantitativeValue",
            value: property.sizeValue,
            unitText: property.sizeUnit ?? "sqft",
          },
        }
      : {}),
  };
}

export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
  siteBaseUrl: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteBaseUrl}${item.url}`,
    })),
  };
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Applied to every page that must never be indexed. */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false, nocache: true };
