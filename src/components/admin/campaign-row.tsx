import Link from "next/link";
import type { AdminCampaignRow } from "@/server/admin/advertising";
import { CAMPAIGN_STATUS_LABEL_BN } from "@/domain/advertising";
import { ctr } from "@/server/advertising/queries";
import { ActionButton } from "./action-button";
import { RejectCampaignForm } from "./reject-campaign-form";
import {
  approveCampaignAction,
  cancelCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from "@/server/admin/actions";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

/**
 * One campaign in an admin list, with the controls legal for its state.
 *
 * Which buttons appear follows the same transition table the server enforces,
 * so the UI never offers an action that would be refused — but the server
 * still checks, because a hidden button is not access control.
 */
export function AdminCampaignRowCard({ row }: { row: AdminCampaignRow }) {
  const paid = row.payment_status === "PAID";
  const canApprove = row.status === "PENDING_REVIEW" && paid;
  const canReject = row.status === "PENDING_REVIEW" || row.status === "APPROVED";
  const canPause = row.status === "ACTIVE" || row.status === "SCHEDULED";
  const canResume = row.status === "PAUSED";
  const canCancel = !["EXPIRED", "CANCELLED", "REJECTED"].includes(row.status);

  return (
    <li className="rounded-[--radius-card] border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">
            {row.title}{" "}
            <span className="text-sm font-normal text-ink-400">
              #{toBanglaDigits(row.public_ref)}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-ink-600">
            {row.business_name} · {row.business_phone}
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {row.zone_name_bn}
            {row.package_name_bn ? ` · ${row.package_name_bn}` : ""} · {formatTaka(row.price_bdt)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
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
          <span
            className={cn(
              "text-xs",
              paid ? "text-success-700" : "text-warning-700",
            )}
          >
            পেমেন্ট: {paid ? "সম্পন্ন" : (row.payment_status ?? "হয়নি")}
          </span>
        </div>
      </div>

      <p className="mt-2 break-all text-xs text-ink-500">{row.destination_url}</p>

      <p className="mt-2 text-xs text-ink-500">
        {row.start_at ? toBanglaDigits(row.start_at.slice(0, 10)) : "—"} →{" "}
        {row.end_at ? toBanglaDigits(row.end_at.slice(0, 10)) : "—"} · ইম্প্রেশন{" "}
        {toBanglaDigits(row.impressions_count)} · ক্লিক {toBanglaDigits(row.clicks_count)} · CTR{" "}
        {toBanglaDigits(ctr(row.impressions_count, row.clicks_count))}%
      </p>

      {row.rejection_reason ? (
        <p className="mt-2 rounded-[--radius-control] bg-danger-50 px-3 py-1.5 text-sm text-danger-800">
          {row.rejection_reason}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/advertising/campaigns/${row.id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          বিস্তারিত ও ব্যানার
        </Link>

        {canApprove ? (
          <ActionButton
            action={approveCampaignAction}
            fields={{ campaignId: row.id }}
            size="sm"
            successMessage="ক্যাম্পেইনটি অনুমোদিত হয়েছে।"
          >
            অনুমোদন
          </ActionButton>
        ) : null}

        {canReject ? <RejectCampaignForm campaignId={row.id} title={row.title} /> : null}

        {canPause ? (
          <ActionButton
            action={pauseCampaignAction}
            fields={{ campaignId: row.id }}
            variant="secondary"
            size="sm"
            successMessage="স্থগিত করা হয়েছে।"
          >
            স্থগিত
          </ActionButton>
        ) : null}

        {canResume ? (
          <ActionButton
            action={resumeCampaignAction}
            fields={{ campaignId: row.id }}
            variant="secondary"
            size="sm"
            successMessage="আবার চালু করা হয়েছে।"
          >
            আবার চালু
          </ActionButton>
        ) : null}

        {canCancel ? (
          <ActionButton
            action={cancelCampaignAction}
            fields={{ campaignId: row.id }}
            variant="ghost"
            size="sm"
            confirmTitle="ক্যাম্পেইন বাতিল করবেন?"
            confirmBody="বাতিল করলে এটি আর চালু করা যাবে না।"
            successMessage="বাতিল করা হয়েছে।"
          >
            বাতিল
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}
