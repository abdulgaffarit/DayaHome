import type { Metadata } from "next";
import Link from "next/link";
import { ImageOff, Unlock } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { listUnlockedProperties } from "@/server/users/account";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { RevealContact } from "@/components/dashboard/reveal-contact";
import { formatBanglaDate, formatPrice, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "আনলক করা তথ্য" };

/**
 * Properties this user has paid to unlock.
 *
 * PRIVACY: even here the phone number and address are NOT server-rendered.
 * Each row fetches them on demand through the authorized contact endpoint, so
 * the private data is never sitting in the page source of a shared screen.
 */
export default async function UnlockedPage() {
  const user = await requireUser("/dashboard/unlocked");
  const rows = await listUnlockedProperties(getDb(), user.id);

  return (
    <Card>
      <CardHeader
        title="আনলক করা যোগাযোগের তথ্য"
        description={`${toBanglaDigits(rows.length)} টি বিজ্ঞাপনের তথ্য আপনি আনলক করেছেন`}
      />
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Unlock className="h-6 w-6" aria-hidden="true" />}
            title="এখনো কোনো তথ্য আনলক করেননি"
            description="পছন্দের বিজ্ঞাপনে ৳৫০ পেমেন্ট করে মালিকের ফোন নম্বর ও সঠিক লোকেশন দেখুন।"
            action={
              <Link href="/basha-vhara" className={buttonVariants({})}>
                বাসা খুঁজুন
              </Link>
            }
          />
        ) : (
          <ul className="space-y-4">
            {rows.map((row) => (
              <li
                key={row.propertyId}
                className="flex flex-col gap-4 rounded-[--radius-card] border border-ink-100 p-4 sm:flex-row"
              >
                <div className="h-24 w-full shrink-0 overflow-hidden rounded-[--radius-control] bg-ink-100 sm:w-32">
                  {row.primaryImageKey ? (
                    <img
                      src={`/api/images/${row.primaryImageKey}`}
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
                  <h3 className="font-semibold text-ink-900">
                    <Link href={`/property/${row.slug}`} className="hover:text-brand-700">
                      {row.title}
                    </Link>
                  </h3>
                  <p className="text-sm text-ink-500">
                    {row.areaNameBn} · {formatPrice(row.price, row.pricePeriod, { compact: true })}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    আনলক করা হয়েছে: {formatBanglaDate(row.unlockedAt)}
                  </p>

                  <RevealContact propertyId={row.propertyId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
