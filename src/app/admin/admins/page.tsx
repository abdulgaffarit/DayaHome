import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/server/cloudflare/env";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listUsers } from "@/server/admin/users";
import { TableHead, Td, Th } from "@/components/admin/data-table";
import { RoleSelect } from "@/components/admin/role-select";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate } from "@/lib/bangla";

export const metadata: Metadata = { title: "অ্যাডমিনগণ" };

/**
 * Staff roster. SUPER_ADMIN only.
 *
 * There is no "add admin" form: an account is promoted from the users list,
 * which guarantees the person already exists and has verified contact details.
 */
export default async function AdminAdminsPage() {
  const actor = await requireSuperAdmin("/admin/admins");
  const db = getDb();

  const [admins, superAdmins] = await Promise.all([
    listUsers(db, { role: "ADMIN", limit: 100 }),
    listUsers(db, { role: "SUPER_ADMIN", limit: 100 }),
  ]);
  const rows = [...superAdmins.rows, ...admins.rows];

  return (
    <section className="rounded-[--radius-card] border border-ink-100 bg-white shadow-[--shadow-card]">
      <header className="border-b border-ink-100 p-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          <ShieldCheck className="h-5 w-5 text-brand-700" aria-hidden="true" />
          অ্যাডমিনগণ
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          নতুন অ্যাডমিন যোগ করতে &ldquo;ব্যবহারকারী&rdquo; পাতা থেকে সংশ্লিষ্ট
          ব্যক্তির ভূমিকা পরিবর্তন করুন। নিজের ভূমিকা নিজে পরিবর্তন করা যায় না।
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem]">
          <caption className="sr-only">অ্যাডমিনদের তালিকা</caption>
          <TableHead>
            <Th>নাম</Th>
            <Th>যোগাযোগ</Th>
            <Th>ভূমিকা</Th>
            <Th>সর্বশেষ লগইন</Th>
          </TableHead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((user) => {
              const isSelf = user.id === actor.id;
              return (
                <tr key={user.id} className={isSelf ? "bg-surface-soft" : undefined}>
                  <Td>
                    <span className="font-medium text-ink-900">{user.name}</span>
                    {isSelf ? <span className="ms-2 text-xs text-ink-400">(আপনি)</span> : null}
                  </Td>
                  <Td>
                    <span className="text-ink-700">{user.phone ?? "—"}</span>
                    <p className="text-xs text-ink-500">{user.email ?? ""}</p>
                  </Td>
                  <Td>
                    {isSelf ? (
                      <Badge tone="soft">{user.role}</Badge>
                    ) : (
                      <RoleSelect userId={user.id} currentRole={user.role} />
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-500">
                    {user.last_login_at ? formatBanglaDate(user.last_login_at) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
