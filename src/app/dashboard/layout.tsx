import type { Metadata } from "next";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { requireUser } from "@/server/auth/current-user";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { default: "ড্যাশবোর্ড", template: "%s | ড্যাশবোর্ড" },
  robots: NOINDEX,
};

/**
 * Dashboard shell.
 *
 * The guard lives in the layout, so every page beneath `/dashboard` is
 * protected by default — a new page cannot forget to check.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/dashboard");

  return (
    <div className="container-page py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          স্বাগতম, {user.name}
        </h1>
        <p className="mt-1 text-ink-500">আপনার বিজ্ঞাপন, পেমেন্ট ও প্রোফাইল এক জায়গায়।</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DashboardSidebar />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
