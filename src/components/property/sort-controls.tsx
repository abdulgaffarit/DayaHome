import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { SORT_OPTIONS, type SortOption } from "@/domain/schemas";
import { cn } from "@/lib/cn";

const SORT_LABEL_BN: Record<SortOption, string> = {
  newest: "নতুন আগে",
  price_asc: "দাম: কম থেকে বেশি",
  price_desc: "দাম: বেশি থেকে কম",
  popular: "জনপ্রিয়",
};

/**
 * Sort and grid/list switch.
 *
 * Both are plain links that change the URL, which keeps them working without
 * JavaScript and keeps the resulting view shareable.
 */
export function SortAndViewControls({
  sort,
  view,
  hrefFor,
}: {
  sort: SortOption;
  view: "grid" | "list";
  hrefFor: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="hidden text-sm text-ink-500 sm:inline">সাজান:</span>
        {/* A <details> menu keeps this zero-JS while staying compact on mobile. */}
        <details className="relative">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[--radius-control] border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50">
            {SORT_LABEL_BN[sort]}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <ul className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-[--radius-control] border border-ink-100 bg-white py-1 shadow-[--shadow-pop]">
            {SORT_OPTIONS.map((option) => (
              <li key={option}>
                <Link
                  href={hrefFor({ sort: option, page: 1 })}
                  className={cn(
                    "block px-4 py-2.5 text-sm hover:bg-surface-mint",
                    option === sort ? "font-semibold text-brand-800" : "text-ink-700",
                  )}
                >
                  {SORT_LABEL_BN[option]}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div
        className="hidden items-center rounded-[--radius-control] border border-ink-200 p-0.5 sm:flex"
        role="group"
        aria-label="দেখার ধরন"
      >
        <ViewLink href={hrefFor({ view: "grid" })} active={view === "grid"} label="গ্রিড ভিউ">
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        </ViewLink>
        <ViewLink href={hrefFor({ view: "list" })} active={view === "list"} label="লিস্ট ভিউ">
          <List className="h-4 w-4" aria-hidden="true" />
        </ViewLink>
      </div>
    </div>
  );
}

function ViewLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[calc(var(--radius-control)-2px)] transition-colors",
        active ? "bg-brand-700 text-white" : "text-ink-500 hover:bg-ink-100",
      )}
    >
      {children}
    </Link>
  );
}
