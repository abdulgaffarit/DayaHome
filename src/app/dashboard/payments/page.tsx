import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { listUserPayments } from "@/server/users/account";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBanglaDate, toBanglaDigits } from "@/lib/bangla";
import type { PaymentStatus } from "@/domain/enums";

export const metadata: Metadata = { title: "পেমেন্ট" };

const PAYMENT_LABEL_BN: Record<PaymentStatus, { label: string; tone: "brand" | "gold" | "danger" | "neutral" }> = {
  PENDING: { label: "অপেক্ষমাণ", tone: "gold" },
  PAID: { label: "সফল", tone: "brand" },
  FAILED: { label: "ব্যর্থ", tone: "danger" },
  CANCELLED: { label: "বাতিল", tone: "neutral" },
  REFUNDED: { label: "ফেরত দেওয়া হয়েছে", tone: "neutral" },
};

export default async function PaymentsPage() {
  const user = await requireUser("/dashboard/payments");
  const payments = await listUserPayments(getDb(), user.id);

  return (
    <Card>
      <CardHeader title="পেমেন্ট হিস্ট্রি" description="আপনার সব লেনদেনের তালিকা" />
      <CardBody className="p-0 sm:p-0">
        {payments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<CreditCard className="h-6 w-6" aria-hidden="true" />}
              title="কোনো পেমেন্ট নেই"
              description="যোগাযোগের তথ্য আনলক করলে এখানে লেনদেনের তালিকা দেখতে পাবেন।"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="sr-only">পেমেন্ট হিস্ট্রি</caption>
              <thead className="border-b border-ink-100 bg-ink-50 text-start">
                <tr>
                  <Th>বিজ্ঞাপন</Th>
                  <Th>ট্রানজেকশন আইডি</Th>
                  <Th>পরিমাণ</Th>
                  <Th>অবস্থা</Th>
                  <Th>তারিখ</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {payments.map((payment) => {
                  const config = PAYMENT_LABEL_BN[payment.status];
                  return (
                    <tr key={payment.id}>
                      <Td>
                        <Link
                          href={`/property/${payment.property_slug}`}
                          className="font-medium text-ink-900 hover:text-brand-700"
                        >
                          {payment.property_title}
                        </Link>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs text-ink-500">
                          {payment.transaction_id}
                        </span>
                      </Td>
                      <Td>৳{toBanglaDigits(payment.amount)}</Td>
                      <Td>
                        <Badge tone={config.tone}>{config.label}</Badge>
                      </Td>
                      <Td>
                        <span className="text-ink-500">
                          {formatBanglaDate(payment.paid_at ?? payment.created_at)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-5 py-3 text-start text-xs font-semibold uppercase text-ink-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-5 py-3.5 align-middle">{children}</td>;
}
