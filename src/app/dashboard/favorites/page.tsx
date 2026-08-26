import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { listFavorites } from "@/server/properties/favorites";
import { PropertyCard } from "@/components/property/property-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "পছন্দের তালিকা" };

export default async function DashboardFavoritesPage() {
  const user = await requireUser("/dashboard/favorites");
  const favorites = await listFavorites(getDb(), user.id);

  return (
    <Card>
      <CardHeader
        title="পছন্দের তালিকা"
        description={`${toBanglaDigits(favorites.length)} টি বিজ্ঞাপন সংরক্ষিত`}
      />
      <CardBody>
        {favorites.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-6 w-6" aria-hidden="true" />}
            title="পছন্দের তালিকা খালি"
            description="বিজ্ঞাপনের উপরের হার্ট আইকনে চাপ দিয়ে পছন্দের বাসা সংরক্ষণ করুন।"
            action={
              <Link href="/basha-vhara" className={buttonVariants({})}>
                বাসা খুঁজুন
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((property) => (
              <PropertyCard key={property.id} property={property} saved showStatus />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
