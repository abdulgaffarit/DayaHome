import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { getCurrentUser } from "@/server/auth/current-user";
import { listFavorites } from "@/server/properties/favorites";
import { PropertyCard } from "@/components/property/property-card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "পছন্দের তালিকা",
  description: "আপনার সংরক্ষিত বিজ্ঞাপনগুলো।",
  robots: NOINDEX,
};

/**
 * Public favourites page.
 *
 * Unlike the dashboard version this does not redirect anonymous visitors — the
 * heart icon in the header is reachable to everyone, so a signed-out visitor
 * gets an explanation and a login link rather than a bounce.
 */
export default async function FavoritesPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={<Heart className="h-6 w-6" aria-hidden="true" />}
          title="পছন্দের তালিকা দেখতে লগইন করুন"
          description="লগইন করলে পছন্দের বাসা সংরক্ষণ করে পরে সহজেই খুঁজে পাবেন।"
          action={
            <Link href="/login?next=/favorites" className={buttonVariants({})}>
              লগইন করুন
            </Link>
          }
        />
      </div>
    );
  }

  const favorites = await listFavorites(getDb(), user.id);

  return (
    <div className="container-page py-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">পছন্দের তালিকা</h1>
      <p className="mt-1 text-ink-500">
        {toBanglaDigits(favorites.length)} টি বিজ্ঞাপন সংরক্ষিত
      </p>

      <div className="mt-6">
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {favorites.map((property) => (
              <PropertyCard key={property.id} property={property} saved showStatus />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
