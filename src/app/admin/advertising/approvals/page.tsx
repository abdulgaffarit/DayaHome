import { BadgeCheck } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { listPendingReview } from "@/server/admin/advertising";
import { AdminCampaignRowCard } from "@/components/admin/campaign-row";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "অনুমোদন" };

/**
 * The approval queue.
 *
 * Every campaign here has already paid. Payment put it in this queue; only an
 * explicit decision on this page takes it out. There is no path that skips it.
 */
export default async function AdvertisingApprovalsPage() {
  await requireAdmin("/admin/advertising/approvals");
  const rows = await listPendingReview(getDb());

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BadgeCheck className="h-6 w-6" aria-hidden="true" />}
        title="অনুমোদনের অপেক্ষায় কিছু নেই"
        description="পেমেন্ট সম্পন্ন হওয়া নতুন ক্যাম্পেইন এখানে আসবে।"
      />
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-600">
        পেমেন্ট সম্পন্ন — অনুমোদনের অপেক্ষায় {rows.length}টি ক্যাম্পেইন।
      </p>
      <ul className="space-y-3">
        {rows.map((row) => (
          <AdminCampaignRowCard key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}
