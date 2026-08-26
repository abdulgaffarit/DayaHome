import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/cloudflare/env";
import { listUnlocks } from "@/server/admin/payments";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "আনলক" };

const PAGE_SIZE = 50;

export default async function AdminUnlocksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const rows = await listUnlocks(getDb(), PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <AdminTable
      title="যোগাযোগ আনলক"
      description="কে কোন বিজ্ঞাপনের তথ্য আনলক করেছেন"
      total={rows.length}
      page={page}
      pageSize={PAGE_SIZE}
      buildHref={(nextPage) => `/admin/unlocks?page=${nextPage}`}
    >
      <table className="w-full min-w-[48rem]">
        <caption className="sr-only">আনলকের তালিকা</caption>
        <TableHead>
          <Th>ব্যবহারকারী</Th>
          <Th>বিজ্ঞাপন</Th>
          <Th>পরিমাণ</Th>
          <Th>অবস্থা</Th>
          <Th>আনলকের সময়</Th>
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>
                <span className="text-ink-800">{row.user_name}</span>
                <p className="text-xs text-ink-500">{row.user_phone}</p>
              </Td>
              <Td>
                <Link
                  href={`/property/${row.property_slug}`}
                  target="_blank"
                  className="text-ink-800 hover:text-brand-700"
                >
                  {row.property_title}
                </Link>
                {row.transaction_id ? (
                  <p className="font-mono text-[0.7rem] text-ink-400">{row.transaction_id}</p>
                ) : null}
              </Td>
              <Td>{row.amount !== null ? `৳${toBanglaDigits(row.amount)}` : "—"}</Td>
              <Td>
                <Badge tone={row.status === "ACTIVE" ? "brand" : "neutral"}>{row.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-ink-500">
                {row.unlocked_at ? formatBanglaDate(row.unlocked_at) : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTable>
  );
}
