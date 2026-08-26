"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import type { CategoryDef } from "@/domain/categories";
import { FURNISHED_STATES, TENANT_TYPES } from "@/domain/enums";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

const FURNISHED_LABEL_BN: Record<string, string> = {
  UNFURNISHED: "খালি",
  SEMI_FURNISHED: "আংশিক সজ্জিত",
  FURNISHED: "সম্পূর্ণ সজ্জিত",
};

const TENANT_LABEL_BN: Record<string, string> = {
  ANY: "যে কেউ",
  FAMILY: "ফ্যামিলি",
  BACHELOR: "ব্যাচেলর",
  OFFICE: "অফিস",
  STUDENT: "ছাত্র",
};

/**
 * Listing filters.
 *
 * Applying rewrites the URL, so the filtered result is a normal server-rendered
 * page that can be shared and indexed. On desktop it is a sidebar; on mobile
 * the same form opens in a full-height drawer.
 */
export function FilterPanel({
  category,
  areas,
  propertyTypes,
}: {
  category?: CategoryDef;
  areas: { slug: string; nameBn: string }[];
  propertyTypes: string[];
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <>
      <div className="hidden lg:block">
        <div className="sticky top-24 rounded-[--radius-card] border border-ink-100 bg-white p-5 shadow-[--shadow-card]">
          <h2 className="mb-4 text-base font-semibold text-ink-900">ফিল্টার</h2>
          <FilterForm
            category={category}
            areas={areas}
            propertyTypes={propertyTypes}
            onApplied={() => {}}
          />
        </div>
      </div>

      <div className="lg:hidden">
        <Button variant="outline" full onClick={() => setDrawerOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          ফিল্টার
        </Button>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/45"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ফিল্টার"
            className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink-900">ফিল্টার</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="বন্ধ করুন"
                className="rounded-full p-2 text-ink-500 hover:bg-ink-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <FilterForm
              category={category}
              areas={areas}
              propertyTypes={propertyTypes}
              onApplied={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function FilterForm({
  category,
  areas,
  propertyTypes,
  onApplied,
}: {
  category?: CategoryDef;
  areas: { slug: string; nameBn: string }[];
  propertyTypes: string[];
  onApplied: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const showRooms = category?.hasRooms ?? true;

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    // Preserve the free-text query and the sort order across a filter change.
    for (const carry of ["q", "sort", "view"]) {
      const value = params.get(carry);
      if (value) next.set(carry, value);
    }
    for (const [key, value] of data.entries()) {
      const trimmed = String(value).trim();
      if (trimmed) next.set(key, trimmed);
    }
    router.push(`?${next.toString()}`);
    onApplied();
  }

  function clear() {
    router.push("?");
    onApplied();
  }

  return (
    <form onSubmit={apply} className="space-y-4">
      <Field label="এলাকা" htmlFor="f-area">
        <Select id="f-area" name="area" defaultValue={params.get("area") ?? ""}>
          <option value="">সব এলাকা</option>
          {areas.map((area) => (
            <option key={area.slug} value={area.slug}>
              {area.nameBn}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink-700">দাম (৳)</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input
            name="minPrice"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="সর্বনিম্ন"
            defaultValue={params.get("minPrice") ?? ""}
            aria-label="সর্বনিম্ন দাম"
          />
          <Input
            name="maxPrice"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="সর্বোচ্চ"
            defaultValue={params.get("maxPrice") ?? ""}
            aria-label="সর্বোচ্চ দাম"
          />
        </div>
      </fieldset>

      {propertyTypes.length > 0 ? (
        <Field label="ধরন" htmlFor="f-type">
          <Select id="f-type" name="propertyType" defaultValue={params.get("propertyType") ?? ""}>
            <option value="">সব ধরন</option>
            {propertyTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {showRooms ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="বেডরুম" htmlFor="f-bed">
            <Select id="f-bed" name="bedrooms" defaultValue={params.get("bedrooms") ?? ""}>
              <option value="">যেকোনো</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </Select>
          </Field>
          <Field label="বাথরুম" htmlFor="f-bath">
            <Select id="f-bath" name="bathrooms" defaultValue={params.get("bathrooms") ?? ""}>
              <option value="">যেকোনো</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink-700">
          আয়তন ({category?.landAreaUnits ? "শতক" : "স্কয়ার ফুট"})
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <Input
            name="minSize"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="সর্বনিম্ন"
            defaultValue={params.get("minSize") ?? ""}
            aria-label="সর্বনিম্ন আয়তন"
          />
          <Input
            name="maxSize"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="সর্বোচ্চ"
            defaultValue={params.get("maxSize") ?? ""}
            aria-label="সর্বোচ্চ আয়তন"
          />
        </div>
      </fieldset>

      {showRooms ? (
        <Field label="তলা" htmlFor="f-floor">
          <Select id="f-floor" name="floor" defaultValue={params.get("floor") ?? ""}>
            <option value="">যেকোনো তলা</option>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "নিচতলা" : `${n} তলা`}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="সজ্জা" htmlFor="f-furnished">
        <Select id="f-furnished" name="furnished" defaultValue={params.get("furnished") ?? ""}>
          <option value="">যেকোনো</option>
          {FURNISHED_STATES.map((state) => (
            <option key={state} value={state}>
              {FURNISHED_LABEL_BN[state]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="ভাড়াটিয়ার ধরন" htmlFor="f-tenant">
        <Select id="f-tenant" name="tenantType" defaultValue={params.get("tenantType") ?? ""}>
          <option value="">যেকোনো</option>
          {TENANT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TENANT_LABEL_BN[type]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="যে তারিখ থেকে দরকার" htmlFor="f-available">
        <Input
          id="f-available"
          name="availableFrom"
          type="date"
          defaultValue={params.get("availableFrom") ?? ""}
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <Button type="submit" full>
          ফিল্টার প্রয়োগ করুন
        </Button>
        <Button type="button" variant="outline" onClick={clear}>
          রিসেট
        </Button>
      </div>
    </form>
  );
}

export { FURNISHED_LABEL_BN, TENANT_LABEL_BN };
