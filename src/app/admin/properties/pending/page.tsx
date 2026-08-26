import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ExternalLink, ImageOff } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { listAdminProperties } from "@/server/admin/moderation";
import { queryAll } from "@/server/db/client";
import { ActionButton } from "@/components/admin/action-button";
import { RejectPropertyForm } from "@/components/admin/reject-property-form";
import { approvePropertyAction } from "@/server/admin/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "অনুমোদনের অপেক্ষায়" };

/**
 * Moderation queue.
 *
 * Staff see the private fields (exact address, contact number) because they
 * need them to judge whether a listing is genuine. That access is deliberate,
 * scoped to this role, and every approve/reject writes an `admin_logs` entry.
 */
export default async function PendingPropertiesPage() {
  const db = getDb();
  const { rows } = await listAdminProperties(db, { status: "PENDING", limit: 50 });

  const details = rows.length
    ? await queryAll<{
        id: string;
        description: string;
        exact_address: string;
        contact_phone: string;
        image_key: string | null;
      }>(
        db,
        `SELECT p.id, p.description, p.exact_address, p.contact_phone,
                (SELECT pi.object_key FROM property_images pi
                  WHERE pi.property_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image_key
           FROM properties p WHERE p.status = 'PENDING'`,
      )
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));

  if (rows.length === 0) {
    return (
      <div className="rounded-[--radius-card] border border-ink-100 bg-white p-6">
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
          title="সব বিজ্ঞাপন পর্যালোচনা হয়ে গেছে"
          description="নতুন বিজ্ঞাপন জমা হলে এখানে দেখা যাবে।"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-900">
        অনুমোদনের অপেক্ষায় ({toBanglaDigits(rows.length)})
      </h1>

      <ul className="space-y-4">
        {rows.map((property) => {
          const detail = detailById.get(property.id);
          return (
            <li
              key={property.id}
              className="rounded-[--radius-card] border border-ink-100 bg-white p-5"
            >
              <div className="flex flex-col gap-5 lg:flex-row">
                <div className="h-40 w-full shrink-0 overflow-hidden rounded-[--radius-control] bg-ink-100 lg:w-56">
                  {detail?.image_key ? (
                    <img
                      src={`/api/images/${detail.image_key}`}
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
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <span>DP-{property.public_ref}</span>
                    <span aria-hidden="true">·</span>
                    <span>{property.category_name_bn}</span>
                    <span aria-hidden="true">·</span>
                    <span>{property.area_name_bn}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeBanglaDate(property.created_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{toBanglaDigits(property.image_count)} টি ছবি</span>
                  </div>

                  <h2 className="mt-1.5 text-lg font-semibold text-ink-900">{property.title}</h2>
                  <p className="mt-1 font-medium text-brand-700">
                    ৳{toBanglaDigits(property.price)}
                  </p>

                  {detail ? (
                    <p className="mt-3 line-clamp-2-safe text-sm leading-relaxed text-ink-600">
                      {detail.description}
                    </p>
                  ) : null}

                  {/* Private fields — visible to staff only, for verification. */}
                  <dl className="mt-4 grid gap-2 rounded-[--radius-control] bg-ink-50 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-500">মালিক</dt>
                      <dd className="text-ink-800">
                        <Link
                          href={`/admin/users?q=${encodeURIComponent(property.owner_phone ?? property.owner_name)}`}
                          className="hover:text-brand-700"
                        >
                          {property.owner_name}
                        </Link>{" "}
                        <span className="text-ink-500">{property.owner_phone}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">যোগাযোগের নম্বর</dt>
                      <dd className="font-mono text-ink-800">{detail?.contact_phone}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-ink-500">সঠিক ঠিকানা</dt>
                      <dd className="text-ink-800">{detail?.exact_address}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ActionButton
                      action={approvePropertyAction}
                      fields={{ propertyId: property.id }}
                      size="sm"
                      successMessage="বিজ্ঞাপনটি অনুমোদন করা হয়েছে।"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      অনুমোদন
                    </ActionButton>

                    <RejectPropertyForm propertyId={property.id} title={property.title} />

                    <Link
                      href={`/property/${property.slug}`}
                      target="_blank"
                      className="ms-auto inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-brand-700"
                    >
                      প্রিভিউ
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
