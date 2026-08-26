import type { Metadata } from "next";
import { getDb } from "@/server/cloudflare/env";
import { listAdminLogs } from "@/server/admin/audit";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate } from "@/lib/bangla";

export const metadata: Metadata = { title: "অ্যাডমিন লগ" };

const PAGE_SIZE = 50;

/**
 * The audit trail, read-only.
 *
 * There is intentionally no delete or edit control anywhere in the admin UI —
 * an audit log that staff can rewrite is not an audit log.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const rows = await listAdminLogs(getDb(), PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <AdminTable
      title="অ্যাডমিন লগ"
      description="সংবেদনশীল কাজের স্থায়ী রেকর্ড"
      total={rows.length}
      page={page}
      pageSize={PAGE_SIZE}
      buildHref={(nextPage) => `/admin/logs?page=${nextPage}`}
    >
      <table className="w-full min-w-[48rem]">
        <caption className="sr-only">অ্যাডমিন কার্যক্রমের লগ</caption>
        <TableHead>
          <Th>সময়</Th>
          <Th>অ্যাডমিন</Th>
          <Th>কাজ</Th>
          <Th>বিষয়</Th>
          <Th>বিস্তারিত</Th>
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((log) => (
            <tr key={log.id}>
              <Td className="whitespace-nowrap text-ink-500">{formatBanglaDate(log.created_at)}</Td>
              <Td className="text-ink-800">{log.admin_name ?? "—"}</Td>
              <Td>
                <Badge tone="neutral">{log.action}</Badge>
              </Td>
              <Td className="text-ink-600">
                {log.entity_type}
                {log.entity_id ? (
                  <span className="ms-1 font-mono text-xs text-ink-400">{log.entity_id}</span>
                ) : null}
              </Td>
              <Td className="max-w-sm truncate font-mono text-xs text-ink-500">
                {log.metadata ?? "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTable>
  );
}
