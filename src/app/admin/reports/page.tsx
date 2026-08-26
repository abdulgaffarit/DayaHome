import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { REPORT_STATUSES, type ReportReason, type ReportStatus } from "@/domain/enums";
import { getDb } from "@/server/cloudflare/env";
import { listReports } from "@/server/properties/reports";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { ActionButton } from "@/components/admin/action-button";
import { updateReportAction } from "@/server/admin/actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBanglaDate } from "@/lib/bangla";

export const metadata: Metadata = { title: "রিপোর্ট" };

const PAGE_SIZE = 25;

const REASON_LABEL_BN: Record<ReportReason, string> = {
  FAKE_PROPERTY: "ভুয়া বিজ্ঞাপন",
  WRONG_PRICE: "দাম ভুল",
  WRONG_INFORMATION: "তথ্য ভুল",
  WRONG_LOCATION: "লোকেশন ভুল",
  SCAM: "প্রতারণা",
  DUPLICATE: "ডুপ্লিকেট",
  ALREADY_RENTED: "ইতিমধ্যে ভাড়া/বিক্রি",
  OTHER: "অন্যান্য",
};

const STATUS_TONE: Record<ReportStatus, "gold" | "info" | "brand" | "neutral"> = {
  OPEN: "gold",
  INVESTIGATING: "info",
  RESOLVED: "brand",
  DISMISSED: "neutral",
};

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = REPORT_STATUSES.includes(statusParam as ReportStatus)
    ? (statusParam as ReportStatus)
    : undefined;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);

  const rows = await listReports(getDb(), status, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (nextPage > 1) next.set("page", String(nextPage));
    return `/admin/reports?${next}`;
  };

  if (rows.length === 0 && page === 1 && !status) {
    return (
      <div className="rounded-[--radius-card] border border-ink-100 bg-white p-6">
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
          title="কোনো রিপোর্ট নেই"
          description="ব্যবহারকারীরা কোনো বিজ্ঞাপন রিপোর্ট করলে এখানে দেখা যাবে।"
        />
      </div>
    );
  }

  return (
    <AdminTable
      title="রিপোর্ট"
      total={rows.length}
      description="ব্যবহারকারীদের জমা দেওয়া অভিযোগ"
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
          {REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      }
    >
      <table className="w-full min-w-[56rem]">
        <caption className="sr-only">রিপোর্টের তালিকা</caption>
        <TableHead>
          <Th>বিজ্ঞাপন</Th>
          <Th>কারণ</Th>
          <Th>বিস্তারিত</Th>
          <Th>রিপোর্টকারী</Th>
          <Th>অবস্থা</Th>
          <Th>তারিখ</Th>
          <Th>ব্যবস্থা</Th>
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((report) => (
            <tr key={report.id}>
              <Td>
                <Link
                  href={`/property/${report.property_slug}`}
                  target="_blank"
                  className="font-medium text-ink-900 hover:text-brand-700"
                >
                  {report.property_title}
                </Link>
              </Td>
              <Td>
                <Badge tone="neutral">{REASON_LABEL_BN[report.reason]}</Badge>
              </Td>
              <Td className="max-w-xs text-ink-600">{report.details ?? "—"}</Td>
              <Td className="text-ink-600">{report.reporter_name ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[report.status]}>{report.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-ink-500">
                {formatBanglaDate(report.created_at)}
              </Td>
              <Td>
                {report.status === "OPEN" || report.status === "INVESTIGATING" ? (
                  <div className="flex flex-wrap gap-2">
                    {report.status === "OPEN" ? (
                      <ActionButton
                        action={updateReportAction}
                        fields={{ reportId: report.id, status: "INVESTIGATING" }}
                        size="sm"
                        variant="outline"
                      >
                        তদন্তাধীন
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      action={updateReportAction}
                      fields={{ reportId: report.id, status: "RESOLVED" }}
                      size="sm"
                    >
                      সমাধান হয়েছে
                    </ActionButton>
                    <ActionButton
                      action={updateReportAction}
                      fields={{ reportId: report.id, status: "DISMISSED" }}
                      size="sm"
                      variant="ghost"
                    >
                      বাতিল
                    </ActionButton>
                  </div>
                ) : (
                  <span className="text-xs text-ink-400">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTable>
  );
}
