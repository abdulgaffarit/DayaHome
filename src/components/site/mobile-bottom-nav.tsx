"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Home, PlusSquare, Search, User } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/", label: "হোম", icon: Home },
  { href: "/search", label: "খুঁজুন", icon: Search },
  { href: "/post-ad", label: "বিজ্ঞাপন", icon: PlusSquare },
  { href: "/favorites", label: "পছন্দ", icon: Heart },
  { href: "/dashboard", label: "প্রোফাইল", icon: User },
] as const;

/**
 * Thumb-reachable bottom navigation for phones.
 *
 * Hidden on `lg` and above, and hidden inside the admin panel — which is
 * desktop-first and has its own navigation.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <nav
      aria-label="মোবাইল নেভিগেশন"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[0.7rem] font-medium transition-colors",
                  active ? "text-brand-700" : "text-ink-500 hover:text-ink-700",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "fill-brand-100")}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
