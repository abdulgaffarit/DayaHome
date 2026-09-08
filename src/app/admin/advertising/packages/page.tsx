import { getDb } from "@/server/cloudflare/env";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listPackagesForAdmin } from "@/server/admin/advertising";
import { PackageControls } from "@/components/admin/package-controls";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";

export const metadata = { title: "প্যাকেজ" };

export default async function AdminPackagesPage() {
  await requireSuperAdmin("/admin/advertising/packages");
  const packages = await listPackagesForAdmin(getDb());

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        দাম পরিবর্তন করলে শুধু নতুন বিক্রিতে প্রভাব পড়ে — ইতিমধ্যে কেনা ক্যাম্পেইনের দাম
        অপরিবর্তিত থাকে।
      </p>
      <ul className="space-y-3">
        {packages.map((pkg) => (
          <li key={pkg.id} className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-ink-900">{pkg.name_bn}</p>
              <span className="text-sm text-ink-600">
                {formatTaka(pkg.price_bdt)} · {toBanglaDigits(pkg.duration_days)} দিন
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink-500">
              {pkg.slug}
              {pkg.is_exclusive === 1 ? " · এক্সক্লুসিভ" : ""}
              {pkg.is_active === 1 ? "" : " · বিক্রি বন্ধ"}
            </p>

            <PackageControls
              packageId={pkg.id}
              priceBdt={pkg.price_bdt}
              durationDays={pkg.duration_days}
              isActive={pkg.is_active === 1}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
