import type { Metadata } from "next";
import { getCategory } from "@/domain/categories";
import { ListingPage, type RawSearchParams } from "@/components/property/listing-page";
import { categoryMetadata } from "@/lib/seo";

/**
 * godown-vhara — category landing page.
 *
 * A thin wrapper: every category shares one implementation, so a fix to
 * filtering, pagination or card layout lands on all nine at once. The route is
 * explicit (rather than a [category] dynamic segment) to keep the URL literal
 * in the router and the metadata statically analysable.
 */
const CATEGORY = getCategory("godown-vhara")!;

export const metadata: Metadata = categoryMetadata(CATEGORY);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <ListingPage
      category={CATEGORY}
      heading={CATEGORY.headingBn}
      description={CATEGORY.metaDescriptionBn}
      searchParams={await searchParams}
      basePath="/godown-vhara"
    />
  );
}
