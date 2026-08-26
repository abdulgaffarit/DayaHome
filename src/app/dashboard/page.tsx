import Link from "next/link";
import { CreditCard, Eye, ListChecks, Unlock } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { getOwnerStats } from "@/server/properties/owner";
import { listNotifications } from "@/server/notifications/notify";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { formatRelativeBanglaDate, toBanglaDigits } from "@/lib/bangla";

export default async function DashboardHome() {
  const db = getDb();
  const user = await requireUser("/dashboard");

  const [stats, notifications] = await Promise.all([
    getOwnerStats(db, user.id),
    listNotifications(db, user.id, 8),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
          label="মোট বিজ্ঞাপন"
          value={stats.total}
        />
        <StatCard
          icon={<Eye className="h-5 w-5" aria-hidden="true" />}
          label="মোট ভিউ"
          value={stats.totalViews}
        />
        <StatCard
          icon={<Unlock className="h-5 w-5" aria-hidden="true" />}
          label="যোগাযোগ আনলক"
          value={stats.totalUnlocks}
        />
        <StatCard
          icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
          label="অনুমোদনের অপেক্ষায়"
          value={stats.pending}
        />
      </div>

      <Card>
        <CardHeader
          title="সাম্প্রতিক আপডেট"
          description="আপনার বিজ্ঞাপন ও পেমেন্ট সম্পর্কিত খবর"
        />
        <CardBody>
          {notifications.length === 0 ? (
            <EmptyState
              title="এখনো কোনো আপডেট নেই"
              description="বিজ্ঞাপন দিলে বা পেমেন্ট করলে এখানে খবর দেখতে পাবেন।"
              action={
                <Link href="/post-ad" className={buttonVariants({})}>
                  বিজ্ঞাপন দিন
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {notifications.map((notification) => (
                <li key={notification.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {notification.link ? (
                          <Link href={notification.link} className="hover:text-brand-700">
                            {notification.title_bn}
                          </Link>
                        ) : (
                          notification.title_bn
                        )}
                      </p>
                      {notification.body_bn ? (
                        <p className="mt-0.5 text-sm leading-relaxed text-ink-600">
                          {notification.body_bn}
                        </p>
                      ) : null}
                    </div>
                    <time className="shrink-0 text-xs text-ink-400">
                      {formatRelativeBanglaDate(notification.created_at)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[--radius-card] border border-ink-100 bg-white p-4 shadow-[--shadow-card]">
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-mint text-brand-700">
        {icon}
      </span>
      <p className="text-2xl font-bold text-ink-900">{toBanglaDigits(value)}</p>
      <p className="mt-0.5 text-sm text-ink-500">{label}</p>
    </div>
  );
}
