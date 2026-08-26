import type { Metadata } from "next";
import Link from "next/link";
import { Star } from "lucide-react";
import { PROPERTY_STATUSES, type PropertyStatus } from "@/domain/enums";
import { getDb } from "@/server/cloudflare/env";
import { listAdminProperties } from "@/server/admin/moderation";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { ActionButton } from "@/components/admin/action-button";
import { setFeaturedAction, setVerifiedAction } from "@/server/admin/actions";
import { StatusBadge } from "@/components/ui/badge";
import { formatBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "সব বিজ্ঞাপন" };

const PAGE_SIZE = 25;

export default async function AdminPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = PROPERTY_STATUSES.includes(statusParam as PropertyStatus)
    ? (statusParam as PropertyStatus)
    : undefined;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);

  const { rows, total } = await listAdminProperties(getDb(), {
    q,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (nextPage > 1) next.set("page", String(nextPage));
    return `/admin/properties?${next}`;
  };

  return (
    <AdminTable
      title="সব বিজ্ঞাপন"
      total={total}
      searchValue={q}
      searchPlaceholder="শিরোনাম, মালিক বা নম্বর"
      page={page}
      pageSize={PAGE_SIZE}
      buildHref={buildHref}
      filters={
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="অবস্থা"
          className="h-10 rounded-[--radius-control] border border-ink-200 bg-white px-3 text-sm"
        >
          <option value="">সব অবস্থা</option>
          {PROPERTY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      }
    >
      <table className="w-full min-w-[56rem]">
        <caption className="sr-only">সব বিজ্ঞাপনের তালিকা</caption>
        <TableHead>
          <Th>বিজ্ঞাপন</Th>
          <Th>মালিক</Th>
          <Th>দাম</Th>
          <Th>অবস্থা</Th>
          <Th>তারিখ</Th>
          <Th>ব্যবস্থা</Th>
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((property) => (
            <tr key={property.id}>
              <Td>
                <Link
                  href={`/property/${property.slug}`}
                  target="_blank"
                  className="font-medium text-ink-900 hover:text-brand-700"
                >
                  {property.title}
                </Link>
                <p className="text-xs text-ink-500">
                  DP-{property.public_ref} · {property.category_name_bn} · {property.area_name_bn}
                </p>
              </Td>
              <Td>
                <span className="text-ink-800">{property.owner_name}</span>
                <p className="text-xs text-ink-500">{property.owner_phone}</p>
              </Td>
              <Td>৳{toBanglaDigits(property.price)}</Td>
              <Td>
                <StatusBadge status={property.status} />
              </Td>
              <Td className="whitespace-nowrap text-ink-500">
                {formatBanglaDate(property.created_at)}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={setFeaturedAction}
                    fields={{
                      propertyId: property.id,
                      featured: String(property.is_featured !== 1),
                    }}
                    size="sm"
                    variant={property.is_featured === 1 ? "secondary" : "outline"}
                    successMessage="ফিচার্ড অবস্থা পরিবর্তন হয়েছে।"
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${property.is_featured === 1 ? "fill-current" : ""}`}
                      aria-hidden="true"
                    />
                    ফিচার্ড
                  </ActionButton>

                  <ActionButton
                    action={setVerifiedAction}
                    fields={{
                      propertyId: property.id,
                      verified: String(property.is_verified !== 1),
                    }}
                    size="sm"
                    variant={property.is_verified === 1 ? "secondary" : "outline"}
                    confirmTitle={
                      property.is_verified === 1 ? undefined : "যাচাইকৃত হিসেবে চিহ্নিত করবেন?"
                    }
                    confirmBody="সরেজমিনে বা মালিকের সাথে কথা বলে যাচাই করা হলে তবেই এই ব্যাজ দিন। ব্যবহারকারীরা এটিকে আমাদের নিশ্চয়তা হিসেবে দেখবেন।"
                    successMessage="যাচাই অবস্থা পরিবর্তন হয়েছে।"
                  >
                    যাচাই
                  </ActionButton>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTable>
  );
}
