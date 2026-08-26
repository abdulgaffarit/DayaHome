import type { Metadata } from "next";
import { getDb } from "@/server/cloudflare/env";
import { requireUser } from "@/server/auth/current-user";
import { queryOne } from "@/server/db/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { Badge } from "@/components/ui/badge";
import { formatBanglaDate } from "@/lib/bangla";

export const metadata: Metadata = { title: "প্রোফাইল" };

const ROLE_LABEL_BN: Record<string, string> = {
  USER: "ব্যবহারকারী",
  OWNER: "মালিক",
  ADMIN: "অ্যাডমিন",
  SUPER_ADMIN: "সুপার অ্যাডমিন",
  VISITOR: "দর্শনার্থী",
};

export default async function ProfilePage() {
  const user = await requireUser("/dashboard/profile");
  const meta = await queryOne<{ created_at: string; last_login_at: string | null }>(
    getDb(),
    `SELECT created_at, last_login_at FROM users WHERE id = ?`,
    [user.id],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="প্রোফাইল" description="আপনার তথ্য হালনাগাদ করুন" />
        <CardBody>
          <ProfileForm
            defaultName={user.name}
            defaultEmail={user.email ?? ""}
            phone={user.phone ?? ""}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="অ্যাকাউন্টের তথ্য" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-500">ভূমিকা</dt>
              <dd className="mt-1">
                <Badge tone="soft">{ROLE_LABEL_BN[user.role] ?? user.role}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-500">যোগদানের তারিখ</dt>
              <dd className="mt-1 font-medium text-ink-800">
                {formatBanglaDate(meta?.created_at)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-500">সর্বশেষ লগইন</dt>
              <dd className="mt-1 font-medium text-ink-800">
                {meta?.last_login_at ? formatBanglaDate(meta.last_login_at) : "—"}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
