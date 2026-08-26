"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { HOME_SEARCH_TABS } from "@/domain/categories";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Hero search.
 *
 * Submitting navigates to a real, shareable URL (`/basha-vhara?area=…`) rather
 * than holding results in client state — that keeps every search result
 * bookmarkable and server-rendered.
 */
export function SearchBox({
  areas,
  propertyTypes = [],
  className,
}: {
  areas: { slug: string; nameBn: string }[];
  propertyTypes?: string[];
  className?: string;
}) {
  const router = useRouter();
  const [tabIndex, setTabIndex] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const tab = HOME_SEARCH_TABS[tabIndex];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["q", "area", "propertyType", "maxPrice"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    // A tab covering two categories (জমি) has no single landing page, so it
    // falls through to /search with the category pre-filtered.
    const destination =
      tab.categories.length === 1
        ? `/${tab.categories[0]}${params.size ? `?${params}` : ""}`
        : `/search?${new URLSearchParams({ ...Object.fromEntries(params), category: tab.categories[0] })}`;
    router.push(destination);
  }

  return (
    <div
      className={cn(
        "rounded-[--radius-card] border border-ink-100 bg-white p-2 shadow-[--shadow-card-hover] sm:p-3",
        className,
      )}
    >
      <div role="tablist" aria-label="কী খুঁজছেন" className="mb-2 flex gap-1 overflow-x-auto p-1">
        {HOME_SEARCH_TABS.map((entry, index) => (
          <button
            key={entry.label}
            role="tab"
            type="button"
            aria-selected={index === tabIndex}
            onClick={() => setTabIndex(index)}
            className={cn(
              "shrink-0 rounded-[--radius-pill] px-4 py-2 text-sm font-medium transition-colors",
              index === tabIndex
                ? "bg-brand-700 text-white"
                : "text-ink-600 hover:bg-surface-mint hover:text-brand-900",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="grid gap-2 p-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]"
      >
        <div className="lg:col-span-1">
          <label htmlFor="search-q" className="sr-only">
            কী খুঁজছেন?
          </label>
          <Input
            id="search-q"
            name="q"
            type="search"
            placeholder="কী খুঁজছেন?"
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="search-area" className="sr-only">
            এলাকা
          </label>
          <Select id="search-area" name="area" defaultValue="">
            <option value="">এলাকা</option>
            {areas.map((area) => (
              <option key={area.slug} value={area.slug}>
                {area.nameBn}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="search-type" className="sr-only">
            ধরন
          </label>
          <Select id="search-type" name="propertyType" defaultValue="">
            <option value="">ধরন</option>
            {propertyTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="search-max" className="sr-only">
            সর্বোচ্চ ভাড়া
          </label>
          <Select id="search-max" name="maxPrice" defaultValue="">
            <option value="">সর্বোচ্চ ভাড়া</option>
            {[3000, 5000, 8000, 12000, 20000, 40000].map((amount) => (
              <option key={amount} value={amount}>
                ৳{toBanglaDigits(amount.toLocaleString("en-IN"))} পর্যন্ত
              </option>
            ))}
          </Select>
        </div>

        <Button type="submit" loading={pending} className="sm:col-span-2 lg:col-span-1">
          <Search className="h-4 w-4" aria-hidden="true" />
          খুঁজুন
        </Button>
      </form>
    </div>
  );
}
