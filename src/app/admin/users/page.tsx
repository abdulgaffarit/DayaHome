import type { Metadata } from "next";
import { ROLES, type Role, type UserStatus } from "@/domain/enums";
import { getDb } from "@/server/cloudflare/env";
import { requireAdmin } from "@/server/auth/current-user";
import { listUsers } from "@/server/admin/users";
import { AdminTable, TableHead, Td, Th } from "@/components/admin/data-table";
import { ActionButton } from "@/components/admin/action-button";
import { RoleSelect } from "@/components/admin/role-select";
import { setUserStatusAction } from "@/server/admin/actions";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate, toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = { title: "ব্যবহারকারী" };

const PAGE_SIZE = 25;

const ROLE_LABEL_BN: Record<Role, string> = {
  VISITOR: "দর্শনার্থী",
  USER: "ব্যবহারকারী",
  OWNER: "মালিক",
  ADMIN: "অ্যাডমিন",
  SUPER_ADMIN: "সুপার অ্যাডমিন",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  const roleParam = typeof params.role === "string" ? params.role : undefined;
  const role = ROLES.includes(roleParam as Role) ? (roleParam as Role) : undefined;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);

  const { rows, total } = await listUsers(getDb(), {
    q,
    role,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (role) next.set("role", role);
    if (nextPage > 1) next.set("page", String(nextPage));
    return `/admin/users?${next}`;
  };

  return (
    <AdminTable
      title="ব্যবহারকারী"
      total={total}
      searchValue={q}
      searchPlaceholder="নাম, নম্বর বা ইমেইল"
      page={page}
      pageSize={PAGE_SIZE}
      buildHref={buildHref}
      filters={
        <select
          name="role"
          defaultValue={role ?? ""}
          aria-label="ভূমিকা"
          className="h-10 rounded-[--radius-control] border border-ink-200 bg-white px-3 text-sm"
        >
          <option value="">সব ভূমিকা</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABEL_BN[value]}
            </option>
          ))}
        </select>
      }
    >
      <table className="w-full min-w-[56rem]">
        <caption className="sr-only">ব্যবহারকারীর তালিকা</caption>
        <TableHead>
          <Th>নাম</Th>
          <Th>যোগাযোগ</Th>
          <Th>ভূমিকা</Th>
          <Th>বিজ্ঞাপন</Th>
          <Th>আনলক</Th>
          <Th>যোগদান</Th>
          <Th>ব্যবস্থা</Th>
        </TableHead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((user) => {
            const isSelf = user.id === admin.id;
            const suspended: UserStatus = user.status;
            return (
              <tr key={user.id} className={isSelf ? "bg-surface-soft" : undefined}>
                <Td>
                  <span className="font-medium text-ink-900">{user.name}</span>
                  {isSelf ? <span className="ms-2 text-xs text-ink-400">(আপনি)</span> : null}
                  {suspended === "SUSPENDED" ? (
                    <Badge tone="danger" className="ms-2">
                      স্থগিত
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <span className="text-ink-700">{user.phone ?? "—"}</span>
                  <p className="text-xs text-ink-500">{user.email ?? ""}</p>
                </Td>
                <Td>
                  {/* Only a SUPER_ADMIN can change roles, and never their own —
                      the server enforces both regardless of what renders here. */}
                  {admin.role === "SUPER_ADMIN" && !isSelf ? (
                    <RoleSelect userId={user.id} currentRole={user.role} />
                  ) : (
                    <Badge tone="soft">{ROLE_LABEL_BN[user.role]}</Badge>
                  )}
                </Td>
                <Td>{toBanglaDigits(user.property_count)}</Td>
                <Td>{toBanglaDigits(user.unlock_count)}</Td>
                <Td className="whitespace-nowrap text-ink-500">
                  {formatBanglaDate(user.created_at)}
                </Td>
                <Td>
                  {isSelf ? (
                    <span className="text-xs text-ink-400">—</span>
                  ) : (
                    <ActionButton
                      action={setUserStatusAction}
                      fields={{
                        userId: user.id,
                        suspend: String(suspended !== "SUSPENDED"),
                      }}
                      size="sm"
                      variant={suspended === "SUSPENDED" ? "outline" : "danger"}
                      confirmTitle={
                        suspended === "SUSPENDED"
                          ? "স্থগিতাদেশ তুলে নেবেন?"
                          : "অ্যাকাউন্ট স্থগিত করবেন?"
                      }
                      confirmBody={
                        suspended === "SUSPENDED"
                          ? "ব্যবহারকারী আবার লগইন করতে পারবেন।"
                          : "ব্যবহারকারীর সব সেশন বাতিল হবে এবং তিনি আর লগইন করতে পারবেন না।"
                      }
                      successMessage="অবস্থা পরিবর্তন হয়েছে।"
                    >
                      {suspended === "SUSPENDED" ? "সক্রিয় করুন" : "স্থগিত"}
                    </ActionButton>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </AdminTable>
  );
}
