import type { MetadataRoute } from "next";
import { siteUrl } from "@/server/cloudflare/env";

/**
 * robots.txt
 *
 * Private and transactional areas are disallowed outright. `/search` is left
 * crawlable-but-noindex (via its metadata) so links found there are still
 * followed to the listings themselves.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/dashboard",
          "/dashboard/",
          "/api/",
          "/login",
          "/register",
          "/post-ad",
          "/payment/",
          "/favorites",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
