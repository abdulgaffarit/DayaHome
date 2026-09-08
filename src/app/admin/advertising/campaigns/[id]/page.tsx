import { notFound } from "next/navigation";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { getCampaignForAdmin } from "@/server/admin/advertising";
import { listCreatives } from "@/server/advertising/creatives";
import { AdminCampaignRowCard } from "@/components/admin/campaign-row";
import { ActionButton } from "@/components/admin/action-button";
import { reviewCreativeAction } from "@/server/admin/actions";

export const metadata = { title: "ক্যাম্পেইন বিস্তারিত" };

/**
 * Campaign detail with banner preview.
 *
 * The banner is rendered as a plain image from its R2 key. Nothing an
 * advertiser supplied is interpreted as markup, here or on the public page.
 */
export default async function AdminCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin("/admin/advertising/campaigns");
  const db = getDb();
  const { id } = await params;

  const campaign = await getCampaignForAdmin(db, id);
  if (!campaign) notFound();

  const creatives = await listCreatives(db, campaign.id);

  return (
    <div className="space-y-6">
      <ul>
        <AdminCampaignRowCard row={campaign} />
      </ul>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">ব্যানার</h2>
        {creatives.length === 0 ? (
          <p className="text-sm text-ink-500">কোনো ব্যানার আপলোড করা হয়নি।</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {creatives.map((creative) => (
              <li key={creative.id} className="rounded-[--radius-card] border border-ink-200 p-3">
                <p className="mb-2 text-xs text-ink-500">
                  {creative.variant === "DESKTOP" ? "ডেস্কটপ" : "মোবাইল"} · {creative.mime_type} ·{" "}
                  {creative.status === "APPROVED" ? "অনুমোদিত" : "পর্যালোচনায়"}
                </p>
                { }
                <img
                  src={`/api/images/${creative.object_key}`}
                  alt={creative.alt_bn}
                  className="w-full rounded border border-ink-100"
                />
                <p className="mt-2 text-xs text-ink-500">alt: {creative.alt_bn}</p>

                {creative.status !== "APPROVED" ? (
                  <div className="mt-3">
                    <ActionButton
                      action={reviewCreativeAction}
                      fields={{ creativeId: creative.id, approve: "1" }}
                      size="sm"
                      successMessage="ব্যানারটি অনুমোদিত হয়েছে।"
                    >
                      ব্যানার অনুমোদন
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-500">
          ক্যাম্পেইন অনুমোদিত হলেও শুধুমাত্র অনুমোদিত ব্যানারই সাইটে দেখানো হয়।
        </p>
      </section>
    </div>
  );
}
