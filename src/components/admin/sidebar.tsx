"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  CreditCard,
  Flag,
  Gauge,
  Home,
  ListChecks,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  Unlock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface Item {
  href: string;
  label: string;
  icon: typeof Gauge;
  exact?: boolean;
  superAdminOnly?: boolean;
  badgeKey?: "pending" | "reports";
}

const ITEMS: Item[] = [
  { href: "/admin", label: "ড্যাশবোর্ড", icon: Gauge, exact: true },
  { href: "/admin/properties/pending", label: "অনুমোদনের অপেক্ষায়", icon: ClipboardList, badgeKey: "pending" },
  { href: "/admin/properties", label: "সব বিজ্ঞাপন", icon: ListChecks, exact: true },
  { href: "/admin/users", label: "ব্যবহারকারী", icon: Users },
  { href: "/admin/payments", label: "পেমেন্ট", icon: CreditCard },
  { href: "/admin/unlocks", label: "আনলক", icon: Unlock },
  { href: "/admin/reports", label: "রিপোর্ট", icon: Flag, badgeKey: "reports" },
  { href: "/admin/logs", label: "অ্যাডমিন লগ", icon: ScrollText },
  { href: "/admin/settings", label: "সেটিংস", icon: Settings, superAdminOnly: true },
  { href: "/admin/admins", label: "অ্যাডমিনগণ", icon: ShieldCheck, superAdminOnly: true },
];

export function AdminSidebar({
  isSuperAdmin,
  badges,
}: {
  isSuperAdmin: boolean;
  badges: { pending: number; reports: number };
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="অ্যাডমিন নেভিগেশন" className="flex h-full flex-col">
      <ul className="flex-1 space-y-0.5">
        {ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          const count = item.badgeKey ? badges[item.badgeKey] : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-700 text-white"
                    : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Icon className="h-[1.1rem] w-[1.1rem] shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{item.label}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "rounded-[--radius-pill] px-2 py-0.5 text-xs font-semibold",
                      active ? "bg-white/20 text-white" : "bg-gold-100 text-gold-700",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-1 border-t border-ink-100 pt-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <Home className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
          সাইটে ফিরে যান
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-[--radius-control] px-3 py-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-danger-50 hover:text-danger-700"
          >
            <LogOut className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
            লগআউট
          </button>
        </form>
      </div>
    </nav>
  );
}
