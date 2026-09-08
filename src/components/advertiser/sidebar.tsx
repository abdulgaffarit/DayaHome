"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, LayoutDashboard, Megaphone, PlusCircle } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { href: "/advertiser", label: "ওভারভিউ", icon: LayoutDashboard, exact: true },
  { href: "/advertiser/payments", label: "পেমেন্ট", icon: CreditCard },
  { href: "/advertise", label: "নতুন ক্যাম্পেইন", icon: PlusCircle },
];

export function AdvertiserSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="বিজ্ঞাপনদাতা নেভিগেশন">
      <p className="mb-3 flex items-center gap-2 px-4 text-sm font-semibold text-ink-500">
        <Megaphone className="h-4 w-4" aria-hidden="true" />
        বিজ্ঞাপনদাতা
      </p>
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
    </nav>
  );
}
