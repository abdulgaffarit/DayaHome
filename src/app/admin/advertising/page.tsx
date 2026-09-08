import Link from "next/link";
import { BadgeCheck, Building2, LayoutGrid, LineChart, Megaphone, Package } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { getAdvertisingAnalytics, listPendingReview } from "@/server/admin/advertising";
import { Card, CardBody } from "@/components/ui/card";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";

export const metadata = { title: "বিজ্ঞাপন" };

const SECTIONS = [
  { href: "/admin/advertising/approvals", label: "অনুমোদন", icon: BadgeCheck },
  { href: "/admin/advertising/campaigns", label: "ক্যাম্পেইন", icon: Megaphone },
  { href: "/admin/advertising/advertisers", label: "বিজ্ঞাপনদাতা", icon: Building2 },
  { href: "/admin/advertising/zones", label: "জোন", icon: LayoutGrid },
  { href: "/admin/advertising/packages", label: "প্যাকেজ", icon: Package },
  { href: "/admin/advertising/analytics", label: "অ্যানালিটিক্স", icon: LineChart },
];

export default async function AdminAdvertisingPage() {
  await requireAdmin("/admin/advertising");
  const db = getDb();

  const [analytics, pending] = await Promise.all([
    getAdvertisingAnalytics(db),
    listPendingReview(db),
  ]);

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="আয় (সম্পন্ন)" value={formatTaka(analytics.revenueBdt)} />
        <Stat label="অপেক্ষমাণ পেমেন্ট" value={formatTaka(analytics.pendingRevenueBdt)} />
        <Stat label="চলমান ক্যাম্পেইন" value={toBanglaDigits(analytics.activeCampaigns)} />
        <Stat label="অনুমোদনের অপেক্ষায়" value={toBanglaDigits(pending.length)} />
      </section>

      <nav aria-label="বিজ্ঞাপন বিভাগ">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="flex items-center gap-3 rounded-[--radius-card] border border-ink-200 bg-white p-4 transition-colors hover:border-ink-300"
                >
                  <Icon className="h-5 w-5 text-brand-700" aria-hidden="true" />
                  <span className="font-medium text-ink-900">{section.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-ink-500">{label}</p>
        <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
      </CardBody>
    </Card>
  );
}
