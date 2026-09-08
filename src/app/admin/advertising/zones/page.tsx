import { getDb } from "@/server/cloudflare/env";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listZonesForAdmin } from "@/server/admin/advertising";
import { ZoneControls } from "@/components/admin/zone-controls";
import { toBanglaDigits } from "@/lib/bangla";

export const metadata = { title: "অ্যাড জোন" };

/**
 * Zone configuration is SUPER_ADMIN only: it sets prices and decides which
 * placements exist. The layout's requireAdmin is not sufficient here.
 */
export default async function AdminZonesPage() {
  await requireSuperAdmin("/admin/advertising/zones");
  const zones = await listZonesForAdmin(getDb());

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        জোনগুলো ডেটাবেজে সংরক্ষিত — অ্যাপ্লিকেশনে কোনো জোন হার্ডকোড করা নেই।
      </p>
      <ul className="space-y-3">
        {zones.map((zone) => (
          <li key={zone.id} className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-ink-900">{zone.name_bn}</p>
              <span
                className={
                  zone.is_enabled === 1
                    ? "rounded-full bg-success-50 px-2.5 py-0.5 text-xs text-success-800"
                    : "rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-600"
                }
              >
                {zone.is_enabled === 1 ? "চালু" : "বন্ধ"}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink-500">{zone.slug}</p>
            <p className="mt-1 text-sm text-ink-600">
              ডেস্কটপ {zone.desktop_size}
              {zone.mobile_size ? ` · মোবাইল ${zone.mobile_size}` : ""} · সর্বোচ্চ{" "}
              {toBanglaDigits(zone.max_active_ads)}টি
            </p>

            <ZoneControls
              zoneId={zone.id}
              basePriceBdt={zone.base_price_bdt}
              maxActiveAds={zone.max_active_ads}
              priority={zone.priority}
              isEnabled={zone.is_enabled === 1}
              activeCampaigns={zone.active_campaigns}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
