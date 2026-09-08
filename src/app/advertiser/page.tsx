import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import {
  ctr,
  groupCampaigns,
  listAdvertiserCampaigns,
  getAdvertiserStats,
  type CampaignSummary,
} from "@/server/advertising/queries";
import { CAMPAIGN_STATUS_LABEL_BN } from "@/domain/advertising";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

/**
 * Advertiser overview.
 *
 * Everything below is read with the advertiser id from the session. A visitor
 * with no advertiser profile sees the sign-up prompt rather than an error.
 */
export default async function AdvertiserHomePage() {
  const db = getDb();
  const user = await requireUser("/advertiser");
  const advertiser = await getAdvertiserForUser(db, user.id);

  if (!advertiser) {
    return (
      <EmptyState
        icon={<Megaphone className="h-6 w-6" aria-hidden="true" />}
        title="এখনো কোনো বিজ্ঞাপনদাতা প্রোফাইল নেই"
        description="বিজ্ঞাপন দিতে প্রথমে আপনার ব্যবসার তথ্য দিন।"
        action={
          <Link href="/advertise" className={buttonVariants()}>
            বিজ্ঞাপন দিন
          </Link>
        }
      />
    );
  }

  const [rows, stats] = await Promise.all([
    listAdvertiserCampaigns(db, advertiser.id),
    getAdvertiserStats(db, advertiser.id),
  ]);
  const groups = groupCampaigns(rows);

  return (
    <div className="space-y-8">
      {advertiser.status === "REJECTED" && advertiser.rejection_reason ? (
        <p className="rounded-[--radius-card] border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800">
          আপনার বিজ্ঞাপনদাতা অ্যাকাউন্টটি অনুমোদিত হয়নি: {advertiser.rejection_reason}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="মোট ক্যাম্পেইন" value={toBanglaDigits(stats.campaigns)} />
        <Stat label="চলমান" value={toBanglaDigits(stats.active)} />
        <Stat
          label="ইম্প্রেশন / ক্লিক"
          value={`${toBanglaDigits(stats.impressions)} / ${toBanglaDigits(stats.clicks)}`}
        />
        <Stat label="মোট খরচ" value={formatTaka(stats.spentBdt)} />
      </section>

      <Group title="চলমান" rows={groups.active} />
      <Group title="সময়সূচিতে" rows={groups.scheduled} />
      <Group title="অপেক্ষমাণ" rows={groups.pending} />
      <Group title="খসড়া" rows={groups.draft} />
      <Group title="স্থগিত" rows={groups.paused} />
      <Group title="মেয়াদ শেষ" rows={groups.expired} />
      <Group title="প্রত্যাখ্যাত" rows={groups.rejected} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-6 w-6" aria-hidden="true" />}
          title="এখনো কোনো ক্যাম্পেইন নেই"
          description="প্রথম বিজ্ঞাপনটি তৈরি করে শুরু করুন।"
          action={
            <Link href="/advertise" className={buttonVariants()}>
              নতুন ক্যাম্পেইন
            </Link>
          }
        />
      ) : null}
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

function Group({ title, rows }: { title: string; rows: CampaignSummary[] }) {
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink-900">
        {title} <span className="text-ink-400">({toBanglaDigits(rows.length)})</span>
      </h2>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/advertiser/campaigns/${row.id}`}
              className="block rounded-[--radius-card] border border-ink-200 bg-white p-4 transition-colors hover:border-ink-300"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink-900">{row.title}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    row.status === "ACTIVE"
                      ? "bg-success-50 text-success-800"
                      : row.status === "REJECTED"
                        ? "bg-danger-50 text-danger-800"
                        : "bg-ink-100 text-ink-700",
                  )}
                >
                  {CAMPAIGN_STATUS_LABEL_BN[row.status]}
                </span>
              </div>

              <p className="mt-1 text-sm text-ink-600">
                {row.zone_name_bn}
                {row.package_name_bn ? ` · ${row.package_name_bn}` : ""} ·{" "}
                {formatTaka(row.price_bdt)}
              </p>

              <p className="mt-2 text-xs text-ink-500">
                ইম্প্রেশন {toBanglaDigits(row.impressions)} · ক্লিক {toBanglaDigits(row.clicks)} ·
                CTR {toBanglaDigits(ctr(row.impressions, row.clicks))}%
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
