import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/domain/categories";
import { getDb, siteUrl } from "@/server/cloudflare/env";
import { listActiveAreas, listSitemapEntries } from "@/server/properties/queries";

/**
 * Dynamic sitemap.
 *
 * Contains the homepage, the nine category landing pages, category×area
 * combinations, and every APPROVED listing. Deliberately excluded: /search,
 * /dashboard, /admin, auth pages, and any filtered URL — those are noindex, and
 * listing them would only spend crawl budget on near-duplicates.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const db = getDb();

  const [properties, areas] = await Promise.all([
    listSitemapEntries(db, 5000),
    listActiveAreas(db),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/how-it-works`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.map((category) => ({
    url: `${base}/${category.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.9,
  }));

  // Category × area landing pages — the local-SEO long tail
  // ("দয়ারামপুর কলেজ রোডে বাসা ভাড়া").
  const areaEntries: MetadataRoute.Sitemap = CATEGORIES.flatMap((category) =>
    areas.map((area) => ({
      url: `${base}/${category.slug}?area=${area.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  );

  const propertyEntries: MetadataRoute.Sitemap = properties.map((property) => ({
    url: `${base}/property/${property.slug}`,
    lastModified: new Date(property.updatedAt),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticEntries, ...categoryEntries, ...areaEntries, ...propertyEntries];
}
