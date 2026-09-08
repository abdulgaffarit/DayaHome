import type { Metadata } from "next";
import { Megaphone, ShieldCheck, Target, Timer } from "lucide-react";
import { getDb, getEnv } from "@/server/cloudflare/env";
import { getCurrentUser } from "@/server/auth/current-user";
import { listPayableGateways } from "@/server/payments/registry";
import {
  listPurchasablePackages,
  listPurchasableZones,
} from "@/server/advertising/queries";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { AdvertiseWizard } from "@/components/advertise/wizard";

/**
 * The public advertising page.
 *
 * Indexable: it is a sales page. The advertiser's own dashboard under
 * `/advertiser` is not — that layout sets NOINDEX.
 */
export const metadata: Metadata = {
  title: "বিজ্ঞাপন দিন",
  description:
    "দয়ারামপুরের মানুষের কাছে আপনার ব্যবসার বিজ্ঞাপন পৌঁছান। জোন ও প্যাকেজ বেছে নিয়ে কয়েক ধাপেই শুরু করুন।",
  alternates: { canonical: "/advertise" },
};

const BENEFITS = [
  { icon: Target, title: "স্থানীয় দর্শক", body: "দয়ারামপুর ও আশপাশের মানুষ প্রতিদিন এখানে বাসা-দোকান খোঁজেন।" },
  { icon: Timer, title: "নির্দিষ্ট মেয়াদ", body: "৭, ১৫ বা ৩০ দিনের প্যাকেজ — যতদিন চান ততদিনই।" },
  { icon: ShieldCheck, title: "যাচাই করা বিজ্ঞাপন", body: "প্রতিটি বিজ্ঞাপন আমাদের টিম দেখে অনুমোদন দেয়।" },
];

export default async function AdvertisePage() {
  const db = getDb();
  const user = await getCurrentUser();

  const [zones, packages, gateways, advertiser] = await Promise.all([
    listPurchasableZones(db),
    listPurchasablePackages(db),
    listPayableGateways(db, getEnv()),
    user ? getAdvertiserForUser(db, user.id) : Promise.resolve(null),
  ]);

  return (
    <div className="container-page py-10">
      <header className="mx-auto max-w-2xl text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-mint text-brand-700">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">
          আপনার ব্যবসার বিজ্ঞাপন দিন
        </h1>
        <p className="mt-3 text-ink-600">
          dayarampur.com-এ প্রতিদিন যারা বাসা, দোকান বা জমি খোঁজেন — তাদের কাছে আপনার ব্যবসা
          পৌঁছে দিন।
        </p>
      </header>

      <ul className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
        {BENEFITS.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <li
              key={benefit.title}
              className="rounded-[--radius-card] border border-ink-200 bg-white p-4 text-center"
            >
              <Icon className="mx-auto h-5 w-5 text-brand-700" aria-hidden="true" />
              <p className="mt-2 font-semibold text-ink-900">{benefit.title}</p>
              <p className="mt-1 text-sm text-ink-600">{benefit.body}</p>
            </li>
          );
        })}
      </ul>

      <div className="mx-auto mt-10 max-w-3xl">
        <AdvertiseWizard
          zones={zones}
          packages={packages}
          gateways={gateways}
          isSignedIn={Boolean(user)}
          existingAdvertiser={
            advertiser
              ? {
                  businessName: advertiser.business_name,
                  contactPerson: advertiser.contact_person,
                  businessPhone: advertiser.business_phone,
                }
              : null
          }
        />
      </div>

      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-ink-500">
        পেমেন্ট সম্পন্ন হলেও বিজ্ঞাপনটি সঙ্গে সঙ্গে সাইটে যায় না — আমাদের টিম যাচাই করে
        অনুমোদন দেওয়ার পরেই এটি দেখা যাবে।
      </p>
    </div>
  );
}
