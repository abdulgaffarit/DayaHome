import type { Metadata } from "next";
import Link from "next/link";
import { Eye, ImageOff, Pencil, Plus, Unlock } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { listOwnerProperties } from "@/server/properties/owner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { OwnerPropertyActions } from "@/components/dashboard/owner-property-actions";
import { formatPrice, formatRelativeBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "আমার বিজ্ঞাপন" };

export default async function OwnerPropertiesPage() {
  const user = await requireUser("/dashboard/properties");
  // Scoped to the signed-in owner — another owner's listing cannot appear here.
  const properties = await listOwnerProperties(getDb(), user.id);

  return (
    <Card>
      <CardHeader
        title="আমার বিজ্ঞাপন"
        description={`মোট ${toBanglaDigits(properties.length)} টি বিজ্ঞাপন`}
        action={
          <Link href="/post-ad" className={buttonVariants({ size: "sm" })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            নতুন
          </Link>
        }
      />
      <CardBody>
        {properties.length === 0 ? (
          <EmptyState
            title="এখনো কোনো বিজ্ঞাপন দেননি"
            description="আপনার খালি বাসা, দোকান বা জমির বিজ্ঞাপন দিন — সম্পূর্ণ বিনামূল্যে।"
            action={
              <Link href="/post-ad" className={buttonVariants({})}>
                বিজ্ঞাপন দিন
              </Link>
            }
          />
        ) : (
          <ul className="space-y-4">
            {properties.map((property) => (
              <li
                key={property.id}
                className="flex flex-col gap-4 rounded-[--radius-card] border border-ink-100 p-4 sm:flex-row"
              >
                <div className="h-28 w-full shrink-0 overflow-hidden rounded-[--radius-control] bg-ink-100 sm:w-40">
                  {property.primaryImageKey ? (
                    <img
                      src={`/api/images/${property.primaryImageKey}`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-400">
                      <ImageOff className="h-6 w-6" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={property.status} />
                    <span className="text-xs text-ink-400">{property.publicId}</span>
                  </div>

                  <h3 className="mt-1.5 font-semibold text-ink-900">
                    <Link href={`/property/${property.slug}`} className="hover:text-brand-700">
                      {property.title}
                    </Link>
                  </h3>
                  <p className="text-sm text-ink-500">
                    {property.categoryNameBn} · {property.areaNameBn} ·{" "}
                    {formatPrice(property.price, property.pricePeriod, { compact: true })}
                  </p>

                  {property.status === "REJECTED" && property.rejectionReason ? (
                    <p className="mt-2 rounded-[--radius-control] bg-danger-50 px-3 py-2 text-sm text-danger-700">
                      <strong className="font-semibold">প্রত্যাখ্যানের কারণ:</strong>{" "}
                      {property.rejectionReason}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-600">
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-ink-400" aria-hidden="true" />
                      {toBanglaDigits(property.viewsCount)} ভিউ
                      <span className="text-ink-400">
                        ({toBanglaDigits(property.uniqueViewsCount)} ইউনিক)
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Unlock className="h-4 w-4 text-ink-400" aria-hidden="true" />
                      {toBanglaDigits(property.unlocksCount)} বার আনলক
                    </span>
                    <span className="text-ink-400">
                      {formatRelativeBanglaDate(property.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                  <Link
                    href={`/property/${property.slug}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    দেখুন
                  </Link>
                  <OwnerPropertyActions
                    propertyId={property.id}
                    status={property.status}
                    title={property.title}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
