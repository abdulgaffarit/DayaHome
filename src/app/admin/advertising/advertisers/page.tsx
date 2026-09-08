import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { listAdvertisersForAdmin } from "@/server/admin/advertising";
import { ActionButton } from "@/components/admin/action-button";
import { setAdvertiserStatusAction } from "@/server/admin/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { toBanglaDigits } from "@/lib/bangla";

export const metadata = { title: "বিজ্ঞাপনদাতা" };

const STATUS_LABEL_BN: Record<string, string> = {
  PENDING: "অপেক্ষমাণ",
  APPROVED: "অনুমোদিত",
  SUSPENDED: "স্থগিত",
  REJECTED: "প্রত্যাখ্যাত",
};

export default async function AdminAdvertisersPage() {
  await requireAdmin("/admin/advertising/advertisers");
  const rows = await listAdvertisersForAdmin(getDb());

  if (rows.length === 0) {
    return <EmptyState title="কোনো বিজ্ঞাপনদাতা নেই" description="নতুন নিবন্ধন এখানে দেখা যাবে।" />;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink-900">{row.business_name}</p>
              <p className="mt-0.5 text-sm text-ink-600">
                {row.contact_person} · {row.business_phone}
                {row.business_email ? ` · ${row.business_email}` : ""}
              </p>
              <p className="mt-0.5 text-sm text-ink-500">
                {toBanglaDigits(row.campaigns)}টি ক্যাম্পেইন
              </p>
            </div>
            <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
              {STATUS_LABEL_BN[row.status] ?? row.status}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {row.status !== "APPROVED" ? (
              <ActionButton
                action={setAdvertiserStatusAction}
                fields={{ advertiserId: row.id, status: "APPROVED" }}
                size="sm"
                successMessage="অনুমোদিত হয়েছে।"
              >
                অনুমোদন
              </ActionButton>
            ) : null}
            {row.status !== "SUSPENDED" ? (
              <ActionButton
                action={setAdvertiserStatusAction}
                fields={{ advertiserId: row.id, status: "SUSPENDED" }}
                variant="secondary"
                size="sm"
                confirmTitle="স্থগিত করবেন?"
                confirmBody="স্থগিত করলে নতুন ক্যাম্পেইন তৈরি করা যাবে না।"
                successMessage="স্থগিত করা হয়েছে।"
              >
                স্থগিত
              </ActionButton>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
