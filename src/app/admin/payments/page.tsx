import type { Metadata } from "next";
import Link from "next/link";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/domain/enums";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { listPayments } from "@/server/admin/payments";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { RefundForm } from "@/components/admin/refund-form";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "পেমেন্ট" };

const PAGE_SIZE = 25;

const STATUS_TONE: Record<PaymentStatus, "brand" | "gold" | "danger" | "neutral"> = {
  PENDING: "gold",
  PAID: "brand",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = PAYMENT_STATUSES.includes(statusParam as PaymentStatus)
    ? (statusParam as PaymentStatus)
    : undefined;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);

  const { rows, total } = await listPayments(getDb(), {
    q,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (nextPage > 1) next.set("page", String(nextPage));
    return `/admin/payments?${next}`;
  };

  return (
    <AdminTable
      title="পেমেন্ট"
      total={total}
      searchValue={q}
      searchPlaceholder="ট্রানজেকশন আইডি বা ব্যবহারকারী"
      page={page}
      pageSize={PAGE_SIZE}
      buildHref={buildHref}
      filters={
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="অবস্থা"
          className="h-10 rounded-[--radius-control] border border-ink-200 bg-white px-3 text-sm"
        >
          <option value="">সব অবস্থা</option>
          {PAYMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      }
    >
      <table className="w-full min-w-[64rem]">
        <caption className="sr-only">পেমেন্টের তালিকা</caption>
        <TableHead>
          <Th>ট্রানজেকশন</Th>
          <Th>ব্যবহারকারী</Th>
          <Th>বিজ্ঞাপন</Th>
          <Th>পরিমাণ</Th>
          <Th>গেটওয়ে</Th>
          <Th>অবস্থা</Th>
          <Th>তারিখ</Th>
          {admin.role === "SUPER_ADMIN" ? <Th>রিফান্ড</Th> : null}
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((payment) => (
            <tr key={payment.id}>
              <Td>
                <span className="font-mono text-xs text-ink-800">{payment.transaction_id}</span>
                {payment.validation_id ? (
                  <p className="font-mono text-[0.7rem] text-ink-400">
                    val: {payment.validation_id}
                  </p>
                ) : null}
                {payment.failure_reason ? (
                  <p className="text-[0.7rem] text-danger-700">{payment.failure_reason}</p>
                ) : null}
              </Td>
              <Td>
                <span className="text-ink-800">{payment.user_name}</span>
                <p className="text-xs text-ink-500">{payment.user_phone}</p>
              </Td>
              <Td>
                <Link
                  href={`/property/${payment.property_slug}`}
                  target="_blank"
                  className="text-ink-800 hover:text-brand-700"
                >
                  {payment.property_title}
                </Link>
              </Td>
              <Td className="whitespace-nowrap font-medium">
                ৳{toBanglaDigits(payment.amount)}
              </Td>
              <Td className="text-ink-500">{payment.gateway}</Td>
              <Td>
                <Badge tone={STATUS_TONE[payment.status]}>{payment.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-ink-500">
                {formatBanglaDate(payment.paid_at ?? payment.created_at)}
              </Td>
              {admin.role === "SUPER_ADMIN" ? (
                <Td>
                  {payment.status === "PAID" ? (
                    <RefundForm paymentId={payment.id} amount={payment.amount} />
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTable>
  );
}
