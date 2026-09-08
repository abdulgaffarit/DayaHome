import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { getAdvertisingAnalytics } from "@/server/admin/advertising";
import { ctr } from "@/server/advertising/queries";
import { Card, CardBody } from "@/components/ui/card";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";

export const metadata = { title: "অ্যানালিটিক্স" };

export default async function AdvertisingAnalyticsPage() {
  await requireAdmin("/admin/advertising/analytics");
  const data = await getAdvertisingAnalytics(getDb());

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="আয় (সম্পন্ন)" value={formatTaka(data.revenueBdt)} />
        <Stat label="অপেক্ষমাণ" value={formatTaka(data.pendingRevenueBdt)} />
        <Stat label="বিজ্ঞাপনদাতা" value={toBanglaDigits(data.advertisers)} />
        <Stat label="ক্যাম্পেইন" value={toBanglaDigits(data.campaigns)} />
        <Stat label="ইম্প্রেশন" value={toBanglaDigits(data.impressions)} />
        <Stat label="ক্লিক" value={toBanglaDigits(data.clicks)} />
        <Stat
          label="গড় CTR"
          value={`${toBanglaDigits(ctr(data.impressions, data.clicks))}%`}
        />
        <Stat label="চলমান" value={toBanglaDigits(data.activeCampaigns)} />
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">জোন অনুযায়ী</h2>
        <ul className="space-y-2">
          {data.topZones.map((zone) => (
            <li
              key={zone.name_bn}
              className="flex flex-wrap justify-between gap-2 rounded-[--radius-card] border border-ink-200 bg-white p-3 text-sm"
            >
              <span className="font-medium text-ink-900">{zone.name_bn}</span>
              <span className="text-ink-600">
                ইম্প্রেশন {toBanglaDigits(zone.impressions)} · ক্লিক{" "}
                {toBanglaDigits(zone.clicks)} · CTR{" "}
                {toBanglaDigits(ctr(zone.impressions, zone.clicks))}%
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">শীর্ষ বিজ্ঞাপনদাতা</h2>
        <ul className="space-y-2">
          {data.topAdvertisers.map((advertiser) => (
            <li
              key={advertiser.business_name}
              className="flex flex-wrap justify-between gap-2 rounded-[--radius-card] border border-ink-200 bg-white p-3 text-sm"
            >
              <span className="font-medium text-ink-900">{advertiser.business_name}</span>
              <span className="text-ink-600">
                {toBanglaDigits(advertiser.campaigns)}টি ক্যাম্পেইন ·{" "}
                {formatTaka(advertiser.spent)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-ink-500">{label}</p>
        <p className="mt-1 text-lg font-bold text-ink-900">{value}</p>
      </CardBody>
    </Card>
  );
}
