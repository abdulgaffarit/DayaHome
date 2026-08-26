import {
  Building2,
  ClipboardList,
  CreditCard,
  Flag,
  TrendingUp,
  Unlock,
  UserRound,
  Wallet,
} from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import {
  categoryDistribution,
  getAdminDashboardStats,
  listingsOverTime,
  revenueOverTime,
  unlocksOverTime,
  usersOverTime,
} from "@/server/admin/dashboard";
import { BarList, LineChart } from "@/components/admin/mini-chart";
import { toBanglaDigits } from "@/lib/bangla";

export default async function AdminDashboard() {
  const db = getDb();
  const [stats, listings, users, revenue, unlocks, categories] = await Promise.all([
    getAdminDashboardStats(db),
    listingsOverTime(db, 30),
    usersOverTime(db, 30),
    revenueOverTime(db, 30),
    unlocksOverTime(db, 30),
    categoryDistribution(db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink-900">ড্যাশবোর্ড</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<UserRound />} label="মোট ব্যবহারকারী" value={stats.totalUsers} />
        <StatCard icon={<Building2 />} label="মোট বিজ্ঞাপন" value={stats.totalProperties} />
        <StatCard icon={<TrendingUp />} label="সক্রিয় বিজ্ঞাপন" value={stats.activeListings} />
        <StatCard
          icon={<ClipboardList />}
          label="অনুমোদনের অপেক্ষায়"
          value={stats.pendingListings}
          tone={stats.pendingListings > 0 ? "warn" : "default"}
        />
        <StatCard icon={<CreditCard />} label="সফল পেমেন্ট" value={stats.totalPayments} />
        <StatCard icon={<Wallet />} label="মোট আয়" value={stats.totalRevenue} prefix="৳" />
        <StatCard icon={<Unlock />} label="মোট আনলক" value={stats.totalUnlocks} />
        <StatCard icon={<Wallet />} label="আজকের আয়" value={stats.todayRevenue} prefix="৳" />
      </div>

      {stats.openReports > 0 ? (
        <p className="flex items-center gap-2 rounded-[--radius-card] border border-gold-500/30 bg-gold-100 px-4 py-3 text-sm text-gold-700">
          <Flag className="h-4 w-4" aria-hidden="true" />
          {toBanglaDigits(stats.openReports)} টি রিপোর্ট পর্যালোচনার অপেক্ষায় আছে।
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <LineChart title="গত ৩০ দিনে নতুন বিজ্ঞাপন" points={listings} />
        <LineChart title="গত ৩০ দিনে নতুন ব্যবহারকারী" points={users} />
        <LineChart
          title="গত ৩০ দিনের আয়"
          points={revenue}
          formatValue={(value) => `৳${toBanglaDigits(value)}`}
        />
        <LineChart title="গত ৩০ দিনে যোগাযোগ আনলক" points={unlocks} />
      </div>

      <BarList title="ক্যাটাগরি অনুযায়ী সক্রিয় বিজ্ঞাপন" items={categories} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  prefix = "",
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-[--radius-card] border border-ink-100 bg-white p-4">
      <span
        className={
          "mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg [&>svg]:h-[1.1rem] [&>svg]:w-[1.1rem] " +
          (tone === "warn" ? "bg-gold-100 text-gold-700" : "bg-surface-mint text-brand-700")
        }
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-2xl font-bold text-ink-900">
        {prefix}
        {toBanglaDigits(value)}
      </p>
      <p className="mt-0.5 text-sm text-ink-500">{label}</p>
    </div>
  );
}
