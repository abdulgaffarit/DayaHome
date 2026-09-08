import type { Metadata } from "next";
import { AdvertiserSidebar } from "@/components/advertiser/sidebar";
import { requireUser } from "@/server/auth/current-user";
import { NOINDEX } from "@/lib/seo";

/**
 * Advertiser shell.
 *
 * The guard lives here, so every page beneath `/advertiser` is protected by
 * default and a new page cannot forget to check. NOINDEX for the same reason
 * the user dashboard carries it: this is private business data, never a search
 * result.
 */
export const metadata: Metadata = {
  title: { default: "বিজ্ঞাপনদাতা", template: "%s | বিজ্ঞাপনদাতা" },
  robots: NOINDEX,
};

export default async function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/advertiser");

  return (
    <div className="container-page py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          বিজ্ঞাপনদাতা প্যানেল
        </h1>
        <p className="mt-1 text-ink-500">{user.name} — আপনার ক্যাম্পেইন ও পরিসংখ্যান।</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <AdvertiserSidebar />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
