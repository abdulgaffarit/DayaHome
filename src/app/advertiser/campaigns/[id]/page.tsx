import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { ctr, getAdvertiserCampaign } from "@/server/advertising/queries";
import { listCreatives } from "@/server/advertising/creatives";
import { CAMPAIGN_STATUS_LABEL_BN } from "@/domain/advertising";
import { Card, CardBody } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RenewButton } from "@/components/advertiser/renew-button";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";

/**
 * Campaign detail.
 *
 * `getAdvertiserCampaign` carries the advertiser id in its WHERE clause, so a
 * campaign belonging to somebody else is indistinguishable from one that does
 * not exist — a 404, never a 403 that would confirm the id is real.
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const db = getDb();
  const user = await requireUser("/advertiser");
  const advertiser = await getAdvertiserForUser(db, user.id);
  if (!advertiser) notFound();

  const { id } = await params;
  const campaign = await getAdvertiserCampaign(db, advertiser.id, id);
  if (!campaign) notFound();

  const creatives = await listCreatives(db, campaign.id);
  const rate = ctr(campaign.impressions, campaign.clicks);
  const renewable = campaign.status === "EXPIRED" || campaign.status === "ACTIVE";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">{campaign.title}</h2>
          <p className="mt-1 text-sm text-ink-500">
            রেফারেন্স #{toBanglaDigits(campaign.public_ref)} ·{" "}
            {CAMPAIGN_STATUS_LABEL_BN[campaign.status]}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "DRAFT" ? (
            <Link href="/advertise" className={buttonVariants()}>
              পেমেন্ট সম্পন্ন করুন
            </Link>
          ) : null}
          {renewable ? <RenewButton campaignId={campaign.id} /> : null}
        </div>
      </div>

      {campaign.status === "REJECTED" && campaign.rejection_reason ? (
        <p className="rounded-[--radius-card] border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800">
          অনুমোদিত হয়নি: {campaign.rejection_reason}
        </p>
      ) : null}
      {campaign.status === "PAUSED" && campaign.pause_reason ? (
        <p className="rounded-[--radius-card] border border-warning-200 bg-warning-50 p-4 text-sm text-ink-800">
          স্থগিত: {campaign.pause_reason}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="ইম্প্রেশন" value={toBanglaDigits(campaign.impressions)} />
        <Stat label="ক্লিক" value={toBanglaDigits(campaign.clicks)} />
        <Stat label="CTR" value={`${toBanglaDigits(rate)}%`} />
      </section>

      <Card>
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="জোন" value={campaign.zone_name_bn} />
            <Row label="প্যাকেজ" value={campaign.package_name_bn ?? "—"} />
            <Row label="দাম" value={formatTaka(campaign.price_bdt)} />
            <Row label="মেয়াদ" value={`${toBanglaDigits(campaign.duration_days)} দিন`} />
            <Row label="শুরু" value={formatDate(campaign.start_at)} />
            <Row label="শেষ" value={formatDate(campaign.end_at)} />
            <Row label="পেমেন্ট" value={paymentLabel(campaign.payment_status)} />
            <Row label="মাধ্যম" value={campaign.gateway ?? "—"} />
          </dl>
          <p className="mt-4 break-all text-sm text-ink-600">
            লিংক: {campaign.destination_url}
          </p>
        </CardBody>
      </Card>

      <section>
        <h3 className="mb-3 font-semibold text-ink-900">ব্যানার</h3>
        {creatives.length === 0 ? (
          <p className="text-sm text-ink-500">কোনো ব্যানার আপলোড করা হয়নি।</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {creatives.map((creative) => (
              <li key={creative.id} className="rounded-[--radius-card] border border-ink-200 p-3">
                <p className="mb-2 text-xs font-medium text-ink-500">
                  {creative.variant === "DESKTOP" ? "ডেস্কটপ" : "মোবাইল"} ·{" "}
                  {creative.status === "APPROVED" ? "অনুমোদিত" : "পর্যালোচনায়"}
                </p>
                { }
                <img
                  src={`/api/images/${creative.object_key}`}
                  alt={creative.alt_bn}
                  className="w-full rounded"
                />
                {creative.rejection_reason ? (
                  <p className="mt-2 text-sm text-danger-700">{creative.rejection_reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-ink-100 py-1.5">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return toBanglaDigits(iso.slice(0, 10));
}

function paymentLabel(status: string | null): string {
  const labels: Record<string, string> = {
    PENDING: "অপেক্ষমাণ",
    PAID: "সম্পন্ন",
    FAILED: "ব্যর্থ",
    CANCELLED: "বাতিল",
    REFUNDED: "ফেরত",
  };
  return status ? (labels[status] ?? status) : "—";
}
