import Link from "next/link";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { listCampaignsForAdmin } from "@/server/admin/advertising";
import { AdminCampaignRowCard } from "@/components/admin/campaign-row";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL_BN, isCampaignStatus } from "@/domain/advertising";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export const metadata = { title: "ক্যাম্পেইন" };

export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin("/admin/advertising/campaigns");
  const { status } = await searchParams;

  // Anything unrecognised falls back to ALL rather than erroring.
  const filter = status && isCampaignStatus(status) ? status : "ALL";
  const rows = await listCampaignsForAdmin(getDb(), { status: filter });

  return (
    <div className="space-y-4">
      <nav aria-label="অবস্থা ফিল্টার" className="flex flex-wrap gap-2">
        <FilterLink href="/admin/advertising/campaigns" label="সব" active={filter === "ALL"} />
        {CAMPAIGN_STATUSES.map((value) => (
          <FilterLink
            key={value}
            href={`/admin/advertising/campaigns?status=${value}`}
            label={CAMPAIGN_STATUS_LABEL_BN[value]}
            active={filter === value}
          />
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title="কোনো ক্যাম্পেইন নেই" description="এই ফিল্টারে কিছু পাওয়া যায়নি।" />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <AdminCampaignRowCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-brand-600 bg-surface-mint text-brand-900"
          : "border-ink-200 text-ink-600 hover:border-ink-300",
      )}
    >
      {label}
    </Link>
  );
}
