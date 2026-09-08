import Link from "next/link";
import {
  ArrowLeft,
  Home as HomeIcon,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import { getDb, siteUrl } from "@/server/cloudflare/env";
import {
  getCategoryCounts,
  getFeaturedProperties,
  getFavoritedIds,
  getLatestProperties,
  getSiteStats,
  listActiveAreas,
  listPropertyTypes,
} from "@/server/properties/queries";
import { getCurrentUser } from "@/server/auth/current-user";
import { AdSlot } from "@/components/ads/ad-slot";
import { PropertyCard } from "@/components/property/property-card";
import { CategoryCard } from "@/components/property/category-card";
import { SearchBox } from "@/components/property/search-box";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Hero background: the Kadirabad Cantonment gate and the river at Dayarampur.
 *
 * Served straight from `public/` by the Worker's ASSETS binding — this project
 * renders plain `<img>` rather than `next/image`, as the gallery does.
 *
 * No width/height attributes: the element is absolutely positioned and sized
 * entirely by CSS, so it never participates in layout and cannot shift it.
 */
const HERO_IMAGE_SRC = "/images/dayarampur-hero.png";

/**
 * Homepage.
 *
 * Server-rendered in full so the listing content is in the initial HTML for
 * both crawlers and slow connections. The only client JavaScript on this page
 * is the search box, the favourite buttons and the mobile menu.
 */
export default async function HomePage() {
  const db = getDb();
  const user = await getCurrentUser();

  const [latest, featured, counts, stats, areas, propertyTypes] = await Promise.all([
    getLatestProperties(db, 8),
    getFeaturedProperties(db, 4),
    getCategoryCounts(db),
    getSiteStats(db),
    listActiveAreas(db),
    listPropertyTypes(db, "basha-vhara"),
  ]);

  const savedIds = user
    ? await getFavoritedIds(db, user.id, [...latest, ...featured].map((p) => p.id))
    : new Set<string>();

  return (
    <>
      <HomeJsonLd />

      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      {/* Ad zone: the top banner, above the hero. */}
      <div className="container-page pt-4">
        <AdSlot zoneSlug="home-top" className="mx-auto max-w-5xl" />
      </div>

      {/* The base colour sits UNDER the photo on purpose: if the asset is ever
          missing or still loading, the white heading stays readable on brand
          green rather than on a blank page. */}
      <section className="relative overflow-hidden border-b border-ink-100 bg-brand-900">
        <img
          src={HERO_IMAGE_SRC}
          alt=""
          aria-hidden="true"
          // The hero photo is the largest element above the fold, so it is the
          // LCP candidate: eager and high priority, never lazy.
          loading="eager"
          fetchPriority="high"
          decoding="async"
          // Responsive focal point. The photo is roughly 2:1 and the hero box
          // is far squarer on a phone, so a centre crop there would keep the
          // empty sky and lose the gate. Each step moves the crop right as the
          // box widens and more of the frame fits: the cantonment gate on a
          // phone, gate and river on a tablet, the whole scene on desktop.
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[30%_center] sm:object-[40%_center] lg:object-center"
        />

        {/* Scrim. Dark enough for white text to clear WCAG AA over the bright
            sky, and heavier at the bottom so the search card separates from the
            road. Decorative only. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-900/70 via-ink-900/55 to-ink-900/70"
        />

        <div className="container-page relative py-12 sm:py-16 lg:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-flex items-center gap-2 rounded-[--radius-pill] border border-white/25 bg-ink-900/45 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
              <MapPinned className="h-4 w-4" aria-hidden="true" />
              দয়ারামপুর, বাগাতিপাড়া, নাটোর
            </p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-4xl lg:text-5xl">
              দয়ারামপুরে বাসা খুঁজুন
            </h1>
            <p className="mt-4 text-lg text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]">
              সহজে, দ্রুত ও নির্ভরযোগ্যভাবে
            </p>
          </div>

          <SearchBox
            areas={areas}
            propertyTypes={propertyTypes}
            className="mx-auto mt-8 max-w-5xl"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Categories                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="container-page py-12 sm:py-14" aria-labelledby="categories-heading">
        <SectionHeading
          id="categories-heading"
          title="কী খুঁজছেন?"
          description="ক্যাটাগরি বেছে নিয়ে দয়ারামপুরের সব বিজ্ঞাপন দেখুন"
        />
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {CATEGORIES.map((category) => (
            <CategoryCard
              key={category.slug}
              category={category}
              count={counts[category.slug] ?? 0}
            />
          ))}
        </div>
      </section>

      {/* Ad zone: homepage, below the category grid. The placement, its size
          and whether it is enabled all come from `advertisement_zones` — this
          is a reference to a zone, not a second definition of one. */}
      <div className="container-page">
        <AdSlot zoneSlug="home-hero-under" className="mx-auto max-w-4xl" />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Featured                                                          */}
      {/* ---------------------------------------------------------------- */}
      {featured.length > 0 ? (
        <section
          className="border-y border-ink-100 bg-surface-soft py-12 sm:py-14"
          aria-labelledby="featured-heading"
        >
          <div className="container-page">
            <SectionHeading
              id="featured-heading"
              eyebrow={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              title="ফিচার্ড বিজ্ঞাপন"
              description="বাছাই করা কিছু বিজ্ঞাপন"
            />
            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((property, index) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  saved={savedIds.has(property.id)}
                  priority={index < 2}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Latest                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="container-page py-12 sm:py-14" aria-labelledby="latest-heading">
        <SectionHeading
          id="latest-heading"
          title="সর্বশেষ বিজ্ঞাপন"
          description="সদ্য যুক্ত হওয়া বাসা ও অন্যান্য বিজ্ঞাপন"
          action={
            <Link
              href="/search"
              // `-my-3 py-3`: a 44px hit area on a phone, with the negative margin
              // keeping the heading row's spacing exactly as it looks today.
              className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              সব দেখুন
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />

        {latest.length > 0 ? (
          <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {latest.map((property, index) => (
              <PropertyCard
                key={property.id}
                property={property}
                saved={savedIds.has(property.id)}
                priority={featured.length === 0 && index < 2}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-7"
            icon={<HomeIcon className="h-6 w-6" aria-hidden="true" />}
            title="এখনো কোনো বিজ্ঞাপন নেই"
            description="দয়ারামপুরের প্রথম বিজ্ঞাপনটি আপনিই দিন — একদম বিনামূল্যে।"
            action={
              <Link href="/post-ad" className={buttonVariants({})}>
                বিজ্ঞাপন দিন
              </Link>
            }
          />
        )}
      </section>

      <div className="container-page">
        <AdSlot zoneSlug="home-mid" className="mx-auto max-w-4xl" />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Statistics                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-y border-ink-100 bg-brand-700 py-10" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          পরিসংখ্যান
        </h2>
        <div className="container-page grid grid-cols-2 gap-6 text-center lg:grid-cols-4">
          <Stat value={stats.activeListings} label="সক্রিয় বিজ্ঞাপন" />
          <Stat value={stats.totalOwners} label="বিজ্ঞাপনদাতা" />
          <Stat value={stats.totalAreas} label="এলাকা" />
          <Stat value={stats.totalUnlocks} label="সফল যোগাযোগ" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Trust                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="container-page py-12 sm:py-16" aria-labelledby="trust-heading">
        <SectionHeading
          id="trust-heading"
          title="কেন dayarampur.com?"
          description="স্থানীয় মানুষের জন্য, স্থানীয় তথ্য দিয়ে তৈরি"
          centered
        />
        <div className="mt-9 grid gap-5 md:grid-cols-3">
          <TrustCard
            icon={<MapPinned className="h-5 w-5" aria-hidden="true" />}
            title="শুধু দয়ারামপুরের বিজ্ঞাপন"
            description="বড় শহরের হাজারো অপ্রাসঙ্গিক বিজ্ঞাপন নয় — এখানে যা আছে সবই আপনার এলাকার।"
          />
          <TrustCard
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
            title="প্রতিটি বিজ্ঞাপন যাচাই করা"
            description="অ্যাডমিন অনুমোদনের পরেই বিজ্ঞাপন সাইটে প্রকাশ হয়। সন্দেহজনক বিজ্ঞাপন রিপোর্ট করা যায়।"
          />
          <TrustCard
            icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
            title="বিজ্ঞাপন দেওয়া ফ্রি"
            description="মালিকদের জন্য বিজ্ঞাপন দেওয়া সম্পূর্ণ বিনামূল্যে। শুধু যোগাযোগের তথ্য দেখতে ৳৫০।"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* CTA                                                               */}
      {/* ---------------------------------------------------------------- */}
      <section className="container-page pb-16">
        <div className="overflow-hidden rounded-[--radius-card] border border-brand-100 bg-surface-mint px-6 py-10 text-center sm:px-12 sm:py-14">
          <h2 className="text-2xl font-bold text-brand-900 sm:text-3xl">
            আপনার বাসা খালি আছে?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-600">
            কয়েক মিনিটেই বিজ্ঞাপন দিন। দয়ারামপুরের ভাড়াটিয়ারা আপনাকে সরাসরি খুঁজে
            পাবে — কোনো দালাল ছাড়াই।
          </p>
          <Link href="/post-ad" className={buttonVariants({ size: "lg", className: "mt-7" })}>
            বিজ্ঞাপন দিন
          </Link>
        </div>
      </section>

      {/* Ad zone: the bottom banner, immediately above the footer. */}
      <div className="container-page pb-12">
        <AdSlot zoneSlug="home-bottom" className="mx-auto max-w-5xl" />
      </div>
    </>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  centered,
}: {
  id: string;
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div
      className={
        centered
          ? "text-center"
          : "flex flex-wrap items-end justify-between gap-3"
      }
    >
      <div>
        <h2
          id={id}
          className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-[1.75rem]"
        >
          {eyebrow ? <span className="text-gold-500">{eyebrow}</span> : null}
          {title}
        </h2>
        {description ? <p className="mt-2 text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-3xl font-bold text-white sm:text-4xl">{toBanglaDigits(value)}</p>
      <p className="mt-1 text-sm text-brand-100">{label}</p>
    </div>
  );
}

function TrustCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[--radius-card] border border-ink-100 bg-white p-6 shadow-[--shadow-card]">
      <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-mint text-brand-700">
        {icon}
      </span>
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">{description}</p>
    </div>
  );
}

/**
 * Site-level structured data. Deliberately minimal: WebSite + the search action
 * so Google can offer a sitelinks search box.
 */
function HomeJsonLd() {
  const base = siteUrl();
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "dayarampur.com",
    alternateName: "দয়ারামপুরের নিজের ঠিকানা",
    url: base,
    inLanguage: "bn-BD",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  return (
    <script
      type="application/ld+json"
      // Server-generated from constants only; no user input is interpolated.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
