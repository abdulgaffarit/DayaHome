"use client";

import * as React from "react";
import Link from "next/link";
import { LogOut, Menu, X } from "lucide-react";
import { ALL_CATEGORY_LINKS } from "./nav-links";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Mobile navigation drawer.
 *
 * Rendered from the server-side Header, which passes in only the display name —
 * no session token or role-sensitive data crosses to the client here.
 */
export function MobileMenu({ userName }: { userName?: string | null }) {
  const [open, setOpen] = React.useState(false);

  // Lock body scroll while the drawer is open.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="মেনু খুলুন"
        aria-expanded={open}
        className="inline-flex h-11 w-11 items-center justify-center rounded-[--radius-control] text-ink-700 hover:bg-ink-100 lg:hidden"
      >
        <Menu className="h-6 w-6" aria-hidden="true" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/45"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="প্রধান মেনু"
            className="absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col overflow-y-auto bg-white shadow-[--shadow-pop]"
          >
            <div className="flex items-center justify-between border-b border-ink-100 p-4">
              <span className="font-semibold text-ink-900">
                {userName ? userName : "মেনু"}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="মেনু বন্ধ করুন"
                className="rounded-full p-2 text-ink-500 hover:bg-ink-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <ul className="flex-1 p-2">
              <MenuItem href="/" onNavigate={() => setOpen(false)}>
                হোম
              </MenuItem>
              {ALL_CATEGORY_LINKS.map((link) => (
                <MenuItem key={link.href} href={link.href} onNavigate={() => setOpen(false)}>
                  {link.label}
                </MenuItem>
              ))}
              <li className="my-2 border-t border-ink-100" />
              {userName ? (
                <>
                  <MenuItem href="/dashboard" onNavigate={() => setOpen(false)}>
                    ড্যাশবোর্ড
                  </MenuItem>
                  <MenuItem href="/dashboard/properties" onNavigate={() => setOpen(false)}>
                    আমার বিজ্ঞাপন
                  </MenuItem>
                  <MenuItem href="/dashboard/unlocked" onNavigate={() => setOpen(false)}>
                    আনলক করা তথ্য
                  </MenuItem>
                </>
              ) : (
                <>
                  <MenuItem href="/login" onNavigate={() => setOpen(false)}>
                    লগইন
                  </MenuItem>
                  <MenuItem href="/register" onNavigate={() => setOpen(false)}>
                    রেজিস্টার
                  </MenuItem>
                </>
              )}
            </ul>

            <div className="space-y-3 border-t border-ink-100 p-4">
              <Link
                href="/post-ad"
                onClick={() => setOpen(false)}
                className={buttonVariants({ full: true })}
              >
                বিজ্ঞাপন দিন
              </Link>
              {userName ? (
                <form action="/api/auth/logout" method="post">
                  <Button type="submit" variant="outline" full>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    লগআউট
                  </Button>
                </form>
              ) : null}
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}

function MenuItem({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className="block rounded-[--radius-control] px-4 py-3 text-[0.98rem] font-medium text-ink-700 hover:bg-surface-mint hover:text-brand-900"
      >
        {children}
      </Link>
    </li>
  );
}
