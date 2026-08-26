import type { Metadata } from "next";
import { getDb } from "@/server/cloudflare/env";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { queryAll } from "@/server/db/client";
import { SettingsForm } from "@/components/admin/settings-form";
import { formatBanglaDate } from "@/lib/bangla";

export const metadata: Metadata = { title: "সেটিংস" };

/**
 * Platform configuration.
 *
 * SUPER_ADMIN only — enforced here as well as in `updateSettingAction`, so a
 * direct POST from an ADMIN session is rejected regardless of what the sidebar
 * showed them.
 */
export default async function AdminSettingsPage() {
  await requireSuperAdmin("/admin/settings");
  const settings = await queryAll<{
    key: string;
    value: string;
    description: string | null;
    updated_at: string;
  }>(getDb(), `SELECT key, value, description, updated_at FROM settings ORDER BY key ASC`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">প্ল্যাটফর্ম সেটিংস</h1>
        <p className="mt-1 text-sm text-ink-500">
          পেমেন্ট ও তালিকার মূল কনফিগারেশন। পরিবর্তন সঙ্গে সঙ্গে কার্যকর হয়।
        </p>
      </div>

      <div className="rounded-[--radius-card] border border-gold-500/30 bg-gold-100 p-4 text-sm leading-relaxed text-gold-700">
        গেটওয়ের গোপন তথ্য (SSLCOMMERZ স্টোর আইডি ও পাসওয়ার্ড, সেশন সিক্রেট,
        Turnstile সিক্রেট) এখানে রাখা হয় না। সেগুলো Cloudflare Worker সিক্রেট
        হিসেবে <code className="font-mono">wrangler secret put</code> দিয়ে সেট
        করতে হয় — কোনো অবস্থাতেই ডেটাবেসে নয়।
      </div>

      <div className="space-y-4">
        {settings.map((setting) => (
          <div
            key={setting.key}
            className="rounded-[--radius-card] border border-ink-100 bg-white p-5"
          >
            <SettingsForm
              settingKey={setting.key}
              value={setting.value}
              description={setting.description}
            />
            <p className="mt-2 text-xs text-ink-400">
              সর্বশেষ পরিবর্তন: {formatBanglaDate(setting.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
