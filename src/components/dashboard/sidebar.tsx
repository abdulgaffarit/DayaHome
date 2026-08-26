"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  Heart,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Unlock,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { href: "/dashboard", label: "ড্যাশবোর্ড", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/properties", label: "আমার বিজ্ঞাপন", icon: ListChecks },
  { href: "/dashboard/unlocked", label: "আনলক করা তথ্য", icon: Unlock },
  { href: "/dashboard/favorites", label: "পছন্দের তালিকা", icon: Heart },
  { href: "/dashboard/payments", label: "পেমেন্ট", icon: CreditCard },
  { href: "/dashboard/profile", label: "প্রোফাইল", icon: UserCog },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="ড্যাশবোর্ড নেভিগেশন">
      {/* Horizontally scrollable tab strip on mobile, vertical rail on desktop. */}
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-[--radius-control] px-4 py-2.5 text-[0.95rem] font-medium transition-colors",
                  active
                    ? "bg-surface-mint text-brand-900"
                    : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <form action="/api/auth/logout" method="post" className="mt-4 hidden lg:block">
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-[--radius-control] px-4 py-2.5 text-[0.95rem] font-medium text-ink-600 transition-colors hover:bg-danger-50 hover:text-danger-700"
        >
          <LogOut className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
          লগআউট
        </button>
      </form>
    </nav>
  );
}
