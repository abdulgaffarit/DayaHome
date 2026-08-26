import type { Metadata } from "next";
import { ListingPage, type RawSearchParams } from "@/components/property/listing-page";

/**
 * Site-wide search.
 *
 * Marked `noindex, follow`: an unbounded filter space would flood the index
 * with near-duplicate pages. The nine category landing pages are the indexable
 * entry points, and links found here are still crawled.
 */
export const metadata: Metadata = {
  title: "খুঁজুন",
  description: "দয়ারামপুরের সব বিজ্ঞাপনের মধ্যে খুঁজুন।",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const term = typeof params.q === "string" ? params.q : "";

  return (
    <ListingPage
      heading={term ? `"${term}" — খোঁজার ফলাফল` : "সব বিজ্ঞাপন"}
      description="দয়ারামপুরের সব ক্যাটাগরির বিজ্ঞাপন এক জায়গায়।"
      searchParams={params}
      basePath="/search"
    />
  );
}
