import { CreditCard } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { getAdvertiserForUser } from "@/server/advertising/advertisers";
import { listAdvertiserPayments } from "@/server/advertising/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";
import { PAYMENT_TYPE_LABEL_BN, isPaymentType } from "@/domain/payments";

export const metadata = { title: "পেমেন্ট" };

const STATUS_LABEL_BN: Record<string, string> = {
  PENDING: "অপেক্ষমাণ",
  PAID: "সম্পন্ন",
  FAILED: "ব্যর্থ",
  CANCELLED: "বাতিল",
  REFUNDED: "ফেরত",
};

/** Payments for the signed-in advertiser's campaigns only. */
export default async function AdvertiserPaymentsPage() {
  const db = getDb();
  const user = await requireUser("/advertiser/payments");
  const advertiser = await getAdvertiserForUser(db, user.id);

  const payments = advertiser ? await listAdvertiserPayments(db, advertiser.id) : [];

  if (payments.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard className="h-6 w-6" aria-hidden="true" />}
        title="কোনো পেমেন্ট নেই"
        description="ক্যাম্পেইনের জন্য পেমেন্ট করলে এখানে দেখা যাবে।"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-[--radius-card] border border-ink-200 bg-white">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-ink-100 text-right text-ink-500">
          <tr>
            <th className="p-3 font-medium">তারিখ</th>
            <th className="p-3 font-medium">ক্যাম্পেইন</th>
            <th className="p-3 font-medium">ধরন</th>
            <th className="p-3 font-medium">মাধ্যম</th>
            <th className="p-3 font-medium">অবস্থা</th>
            <th className="p-3 font-medium">পরিমাণ</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-b border-ink-50 last:border-0">
              <td className="p-3 text-ink-600">{toBanglaDigits(payment.created_at.slice(0, 10))}</td>
              <td className="p-3 text-ink-900">
                {payment.campaign_title ?? "—"}
                {payment.campaign_ref ? (
                  <span className="block text-xs text-ink-500">
                    #{toBanglaDigits(payment.campaign_ref)}
                  </span>
                ) : null}
              </td>
              <td className="p-3 text-ink-600">
                {isPaymentType(payment.payment_type)
                  ? PAYMENT_TYPE_LABEL_BN[payment.payment_type]
                  : payment.payment_type}
              </td>
              <td className="p-3 text-ink-600">{payment.gateway}</td>
              <td className="p-3 text-ink-600">
                {STATUS_LABEL_BN[payment.status] ?? payment.status}
              </td>
              <td className="p-3 font-medium text-ink-900">{formatTaka(payment.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
