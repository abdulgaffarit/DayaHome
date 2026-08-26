import Link from "next/link";
import { SearchX } from "lucide-react";
import type { CategoryDef } from "@/domain/categories";
import type { SearchQuery } from "@/domain/schemas";
import { searchQuerySchema } from "@/domain/schemas";
import { getDb } from "@/server/cloudflare/env";
import {
  getFavoritedIds,
  listActiveAreas,
  listPropertyTypes,
  searchProperties,
} from "@/server/properties/queries";
import { getCurrentUser } from "@/server/auth/current-user";
import { PropertyCard } from "./property-card";
import { FilterPanel } from "./filter-panel";
import { SortAndViewControls } from "./sort-controls";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Flattens Next's `searchParams` and validates it. Unknown values are dropped
 *  rather than rejected, so a hand-edited URL degrades to a sane result. */
export function parseSearchParams(raw: RawSearchParams): SearchQuery {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && single !== "") flat[key] = single;
  }
  return searchQuerySchema.parse(flat);
}

/** Rebuilds the current URL with one parameter changed. */
export function buildQueryString(query: SearchQuery, overrides: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  const merged: Record<string, unknown> = { ...query, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === null) continue;
    // Defaults are omitted so the canonical URL stays clean.
    if (key === "page" && value === 1) continue;
    if (key === "sort" && value === "newest") continue;
    if (key === "view" && value === "grid") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Shared body of every category landing page and of /search.
 *
 * Filters live in the URL, results are rendered on the server, and pagination
 * uses real links — so every filtered view is shareable and crawlable.
 */
export async function ListingPage({
  category,
  heading,
  description,
  searchParams,
  basePath,
}: {
  category?: CategoryDef;
  heading: string;
  description?: string;
  searchParams: RawSearchParams;
  basePath: string;
}) {
  const db = getDb();
  const query = parseSearchParams(searchParams);
  const effectiveQuery: SearchQuery = category
    ? { ...query, category: category.slug }
    : query;

  const [results, areas, propertyTypes, user] = await Promise.all([
    searchProperties(db, effectiveQuery),
    listActiveAreas(db),
    listPropertyTypes(db, category?.slug),
    getCurrentUser(),
  ]);

  const savedIds = user
    ? await getFavoritedIds(db, user.id, results.items.map((p) => p.id))
    : new Set<string>();

  const hrefFor = (overrides: Record<string, string | number | undefined>) =>
    `${basePath}${buildQueryString(query, overrides)}`;

  return (
    <div className="container-page py-8 lg:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{heading}</h1>
        {description ? <p className="mt-2 max-w-2xl text-ink-600">{description}</p> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
        <aside aria-label="ফিল্টার">
          <FilterPanel category={category} areas={areas} propertyTypes={propertyTypes} />
        </aside>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-4">
            <p className="text-sm text-ink-600" aria-live="polite">
              <strong className="font-semibold text-ink-900">
                {toBanglaDigits(results.total)}
              </strong>{" "}
              টি বিজ্ঞাপন পাওয়া গেছে
            </p>
            <SortAndViewControls
              sort={query.sort}
              view={query.view}
              hrefFor={(overrides) => hrefFor(overrides)}
            />
          </div>

          {results.items.length === 0 ? (
            <EmptyState
              icon={<SearchX className="h-6 w-6" aria-hidden="true" />}
              title="কোনো বিজ্ঞাপন পাওয়া যায়নি"
              description="ফিল্টার একটু কমিয়ে আবার চেষ্টা করুন, অথবা অন্য এলাকা দেখুন।"
              action={
                <Link href={basePath} className={buttonVariants({ variant: "outline" })}>
                  ফিল্টার রিসেট করুন
                </Link>
              }
            />
          ) : (
            <>
              <div
                className={
                  query.view === "list"
                    ? "space-y-4"
                    : "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
                }
              >
                {results.items.map((property, index) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    saved={savedIds.has(property.id)}
                    layout={query.view}
                    priority={index < 3}
                  />
                ))}
              </div>

              <Pagination
                className="mt-10"
                page={results.page}
                totalPages={results.totalPages}
                buildHref={(page) => hrefFor({ page })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
