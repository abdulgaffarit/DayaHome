import Link from "next/link";
import { Heart, LayoutDashboard, Plus } from "lucide-react";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { PRIMARY_NAV } from "./nav-links";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/current-user";
import { hasAtLeastRole } from "@/domain/enums";

/**
 * Site header. A server component, so the signed-in state is correct on first
 * paint with no flash of the logged-out UI and no client-side session fetch.
 */
export async function Header() {
  const user = await getCurrentUser();
  const isStaff = user ? hasAtLeastRole(user.role, "ADMIN") : false;

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="container-page flex h-16 items-center gap-4 lg:h-[4.5rem]">
        <Logo className="shrink-0" />

        <nav aria-label="প্রধান নেভিগেশন" className="ms-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-[--radius-control] px-3 py-2 text-[0.95rem] font-medium text-ink-700 transition-colors hover:bg-surface-mint hover:text-brand-900"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <Link
            href="/favorites"
            aria-label="পছন্দের তালিকা"
            className="hidden h-11 w-11 items-center justify-center rounded-[--radius-control] text-ink-600 hover:bg-ink-100 sm:inline-flex"
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
          </Link>

          <Link
            href="/post-ad"
            className={buttonVariants({ size: "sm", className: "hidden sm:inline-flex" })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            বিজ্ঞাপন দিন
          </Link>

          {user ? (
            <Link
              href={isStaff ? "/admin" : "/dashboard"}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "hidden lg:inline-flex",
              })}
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              {isStaff ? "অ্যাডমিন" : "ড্যাশবোর্ড"}
            </Link>
          ) : (
            <Link
              href="/login"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "hidden lg:inline-flex",
              })}
            >
              লগইন / রেজিস্টার
            </Link>
          )}

          <MobileMenu userName={user?.name ?? null} />
        </div>
      </div>
    </header>
  );
}
