import type { Metadata } from "next";
import { getDb, getEnv } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { listActiveAreas, listAmenities } from "@/server/properties/queries";
import { PostAdWizard } from "@/components/post-ad/wizard";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "বিজ্ঞাপন দিন",
  description: "দয়ারামপুরে আপনার বাসা, দোকান বা জমির বিজ্ঞাপন দিন — সম্পূর্ণ বিনামূল্যে।",
  robots: NOINDEX,
};

export default async function PostAdPage() {
  // Posting requires an account: the listing needs an owner to notify and to
  // hold responsible for it.
  const user = await requireUser("/post-ad");
  const db = getDb();
  const [areas, amenities] = await Promise.all([listActiveAreas(db), listAmenities(db)]);

  return (
    <div className="container-page py-8 lg:py-10">
      <header className="mx-auto mb-8 max-w-3xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          বিজ্ঞাপন দিন
        </h1>
        <p className="mt-2 text-ink-600">
          কয়েক মিনিটেই আপনার সম্পত্তির বিজ্ঞাপন দিন — সম্পূর্ণ বিনামূল্যে।
        </p>
      </header>

      <PostAdWizard
        areas={areas}
        amenities={amenities}
        defaultName={user.name}
        defaultPhone={user.phone ?? ""}
        turnstileSiteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
    </div>
  );
}
