import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bath,
  BedDouble,
  Building,
  CalendarDays,
  CheckCircle2,
  Hash,
  Layers,
  MapPin,
  Ruler,
  Sofa,
  Users,
} from "lucide-react";
import { getCategory } from "@/domain/categories";
import { getDb, contactUnlockPriceBdt, siteUrl } from "@/server/cloudflare/env";
import {
  getPublicPropertyBySlug,
  getRelatedProperties,
  getFavoritedIds,
} from "@/server/properties/queries";
import { hasActiveUnlock } from "@/server/properties/contact";
import { getCurrentUser } from "@/server/auth/current-user";
import { Gallery } from "@/components/property/gallery";
import { ContactLockCard } from "@/components/property/contact-lock-card";
import { PropertyCard } from "@/components/property/property-card";
import { FavoriteButton } from "@/components/property/favorite-button";
import { ReportDialog } from "@/components/property/report-dialog";
import { ViewBeacon } from "@/components/property/view-beacon";
import { Badge, VerifiedBadge } from "@/components/ui/badge";
import {
  FURNISHED_LABEL_BN,
  TENANT_LABEL_BN,
} from "@/components/property/filter-panel";
import {
  breadcrumbJsonLd,
  propertyJsonLd,
  propertyMetadata,
} from "@/lib/seo";
import { formatBanglaDate, formatPrice, toBanglaDigits } from "@/lib/bangla";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const property = await getPublicPropertyBySlug(getDb(), slug);
  if (!property) return { title: "বিজ্ঞাপন পাওয়া যায়নি", robots: { index: false } };

  const primary = property.images[0];
  // Metadata is built from PublicProperty only — no private field can leak into
  // a <meta> tag or an OG image URL.
  return propertyMetadata(
    property,
    primary ? `${siteUrl()}/api/images/${primary.objectKey}` : null,
  );
}

export default async function PropertyDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const db = getDb();
  const property = await getPublicPropertyBySlug(db, slug);
  if (!property) notFound();

  const user = await getCurrentUser();
  const category = getCategory(property.categorySlug);
  const priceBdt = contactUnlockPriceBdt();

  const [related, savedIds, unlocked] = await Promise.all([
    getRelatedProperties(db, property, 4),
    user ? getFavoritedIds(db, user.id, [property.id]) : Promise.resolve(new Set<string>()),
    // A boolean entitlement flag. Safe to send to the client: it reveals
    // whether THIS user has paid, and nothing about the property's private data.
    user ? hasActiveUnlock(db, user.id, property.id) : Promise.resolve(false),
  ]);

  const base = siteUrl();
  const imageUrls = property.images.map((image) => `${base}/api/images/${image.objectKey}`);

  return (
    <>
      <ViewBeacon propertyId={property.id} />
      <JsonLd data={propertyJsonLd(property, base, imageUrls)} />
      <JsonLd
        data={breadcrumbJsonLd(
          [
            { name: "হোম", url: "/" },
            { name: property.categoryNameBn, url: `/${property.categorySlug}` },
            { name: property.title, url: `/property/${property.slug}` },
          ],
          base,
        )}
      />

      <div className="container-page py-6 lg:py-8">
        <nav aria-label="ব্রেডক্রাম্ব" className="mb-5 text-sm text-ink-500">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-brand-700">
                হোম
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={`/${property.categorySlug}`} className="hover:text-brand-700">
                {property.categoryNameBn}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="truncate text-ink-700" aria-current="page">
              {property.title}
            </li>
          </ol>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_23rem]">
          {/* ---------------- Main column ---------------- */}
          <div className="min-w-0">
            <Gallery images={property.images} title={property.title} />

            <header className="mt-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone="soft">{property.categoryNameBn}</Badge>
                    {property.isVerified ? <VerifiedBadge /> : null}
                    <Badge tone="outline">
                      <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                      {property.publicId}
                    </Badge>
                  </div>
                  <h1 className="text-2xl font-bold leading-snug tracking-tight text-ink-900 sm:text-3xl">
                    {property.title}
                  </h1>
                  <p className="mt-2 flex items-center gap-1.5 text-ink-600">
                    <MapPin className="h-4 w-4 text-brand-600" aria-hidden="true" />
                    {property.generalLocation
                      ? `${property.generalLocation}, ${property.areaNameBn}`
                      : property.areaNameBn}
                    , দয়ারামপুর
                  </p>
                </div>
                <FavoriteButton
                  propertyId={property.id}
                  initialSaved={savedIds.has(property.id)}
                  variant="inline"
                />
              </div>

              <p className="mt-4 text-2xl font-bold text-brand-700 sm:text-3xl">
                {formatPrice(property.price, property.pricePeriod)}
              </p>
            </header>

            {/* Key facts */}
            <section aria-labelledby="facts-heading" className="mt-6">
              <h2 id="facts-heading" className="sr-only">
                সংক্ষিপ্ত তথ্য
              </h2>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {property.bedrooms !== null ? (
                  <Fact icon={<BedDouble className="h-4 w-4" />} label="বেডরুম">
                    {toBanglaDigits(property.bedrooms)}
                  </Fact>
                ) : null}
                {property.bathrooms !== null ? (
                  <Fact icon={<Bath className="h-4 w-4" />} label="বাথরুম">
                    {toBanglaDigits(property.bathrooms)}
                  </Fact>
                ) : null}
                {property.sizeValue !== null ? (
                  <Fact icon={<Ruler className="h-4 w-4" />} label="আয়তন">
                    {toBanglaDigits(property.sizeValue)} {property.sizeUnit ?? "স্কয়ার ফুট"}
                  </Fact>
                ) : null}
                {property.floor !== null ? (
                  <Fact icon={<Layers className="h-4 w-4" />} label="তলা">
                    {property.floor === 0 ? "নিচতলা" : `${toBanglaDigits(property.floor)} তলা`}
                    {property.totalFloors ? ` / ${toBanglaDigits(property.totalFloors)}` : ""}
                  </Fact>
                ) : null}
                {property.propertyType ? (
                  <Fact icon={<Building className="h-4 w-4" />} label="ধরন">
                    {property.propertyType}
                  </Fact>
                ) : null}
                {property.furnished ? (
                  <Fact icon={<Sofa className="h-4 w-4" />} label="সজ্জা">
                    {FURNISHED_LABEL_BN[property.furnished]}
                  </Fact>
                ) : null}
                {property.tenantType ? (
                  <Fact icon={<Users className="h-4 w-4" />} label="ভাড়াটিয়া">
                    {TENANT_LABEL_BN[property.tenantType]}
                  </Fact>
                ) : null}
                {property.availableFrom ? (
                  <Fact icon={<CalendarDays className="h-4 w-4" />} label="খালি হবে">
                    {formatBanglaDate(property.availableFrom)}
                  </Fact>
                ) : null}
              </dl>
            </section>

            {/* Description */}
            <section aria-labelledby="description-heading" className="mt-8">
              <h2 id="description-heading" className="text-lg font-semibold text-ink-900">
                বিবরণ
              </h2>
              <div className="mt-3 whitespace-pre-line leading-relaxed text-ink-700">
                {property.description}
              </div>
            </section>

            {property.amenities.length > 0 ? (
              <section aria-labelledby="amenities-heading" className="mt-8">
                <h2 id="amenities-heading" className="text-lg font-semibold text-ink-900">
                  সুযোগ-সুবিধা
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {property.amenities.map((amenity) => (
                    <li
                      key={amenity.slug}
                      className="flex items-center gap-2 rounded-[--radius-control] bg-surface-soft px-3 py-2 text-sm text-ink-700"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                      {amenity.nameBn}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {property.rules ? (
              <section aria-labelledby="rules-heading" className="mt-8">
                <h2 id="rules-heading" className="text-lg font-semibold text-ink-900">
                  নিয়মাবলী
                </h2>
                <div className="mt-3 whitespace-pre-line leading-relaxed text-ink-700">
                  {property.rules}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="meta-heading" className="mt-8 border-t border-ink-100 pt-6">
              <h2 id="meta-heading" className="sr-only">
                বিজ্ঞাপনের তথ্য
              </h2>
              <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-4">
                <MetaPair label="বিজ্ঞাপন আইডি" value={property.publicId} />
                <MetaPair
                  label="প্রকাশের তারিখ"
                  value={formatBanglaDate(property.publishedAt ?? property.createdAt)}
                />
                <MetaPair label="দেখা হয়েছে" value={`${toBanglaDigits(property.viewsCount)} বার`} />
                <MetaPair label="বিজ্ঞাপনদাতা" value={property.ownerDisplayName} />
              </dl>

              <div className="mt-6">
                <ReportDialog propertyId={property.id} isAuthenticated={Boolean(user)} />
              </div>
            </section>
          </div>

          {/* ---------------- Sidebar ---------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <ContactLockCard
              propertyId={property.id}
              priceBdt={priceBdt}
              isAuthenticated={Boolean(user)}
              hasUnlock={unlocked}
            />

            <div className="mt-4 rounded-[--radius-card] border border-ink-100 bg-surface-soft p-5">
              <h2 className="text-sm font-semibold text-ink-900">নিরাপদ থাকুন</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-600">
                <li>• বাসা না দেখে অগ্রিম টাকা পাঠাবেন না।</li>
                <li>• চুক্তির আগে কাগজপত্র যাচাই করুন।</li>
                <li>• সন্দেহ হলে বিজ্ঞাপনটি রিপোর্ট করুন।</li>
              </ul>
            </div>
          </aside>
        </div>

        {related.length > 0 ? (
          <section aria-labelledby="related-heading" className="mt-14">
            <h2 id="related-heading" className="text-xl font-bold text-ink-900">
              {category ? `একই ধরনের আরও ${category.nameBn}` : "একই ধরনের আরও বিজ্ঞাপন"}
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <PropertyCard key={item.id} property={item} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[--radius-control] border border-ink-100 bg-white p-3">
      <dt className="flex items-center gap-1.5 text-xs text-ink-500">
        <span className="text-brand-600">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-ink-900">{children}</dd>
    </div>
  );
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
