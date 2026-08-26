import type { Metadata } from "next";
import { AdminSidebar } from "@/components/admin/sidebar";
import { requireAdmin } from "@/server/auth/current-user";
import { getDb } from "@/server/cloudflare/env";
import { queryOne } from "@/server/db/client";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { default: "অ্যাডমিন", template: "%s | অ্যাডমিন" },
  robots: NOINDEX,
};

/**
 * Admin shell.
 *
 * `requireAdmin` runs in the layout, so every route under /admin is gated by
 * default. Individual pages that need SUPER_ADMIN re-check for themselves, and
 * so does every mutation — the sidebar hiding a link is convenience, not
 * access control.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin("/admin");
  const db = getDb();

  const counts = await queryOne<{ pending: number; reports: number }>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM properties WHERE status = 'PENDING')               AS pending,
       (SELECT COUNT(*) FROM reports WHERE status IN ('OPEN','INVESTIGATING'))  AS reports`,
  );

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-[100rem] gap-6 px-4 py-6 lg:px-6">
        <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 rounded-[--radius-card] border border-ink-100 bg-white p-3 lg:block">
          <AdminSidebar
            isSuperAdmin={user.role === "SUPER_ADMIN"}
            badges={{ pending: counts?.pending ?? 0, reports: counts?.reports ?? 0 }}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {/* On narrow screens the same navigation becomes a scrolling strip. */}
          <div className="mb-4 overflow-x-auto rounded-[--radius-card] border border-ink-100 bg-white p-2 lg:hidden">
            <AdminSidebar
              isSuperAdmin={user.role === "SUPER_ADMIN"}
              badges={{ pending: counts?.pending ?? 0, reports: counts?.reports ?? 0 }}
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
