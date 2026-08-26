import Link from "next/link";
import { Search } from "lucide-react";
import { toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

/**
 * Table shell for admin lists.
 *
 * The search box is a plain GET form and pagination is plain links, so the
 * whole table works server-side with no client JavaScript — which also means it
 * survives a slow connection in a field office.
 */
export function AdminTable({
  title,
  description,
  total,
  searchName = "q",
  searchValue,
  searchPlaceholder = "খুঁজুন…",
  filters,
  children,
  page,
  pageSize,
  buildHref,
}: {
  title: string;
  description?: string;
  total: number;
  searchName?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  children: React.ReactNode;
  page: number;
  pageSize: number;
  buildHref: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="rounded-[--radius-card] border border-ink-100 bg-white shadow-[--shadow-card]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 p-5">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">{title}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {description ? `${description} · ` : ""}
            মোট {toBanglaDigits(total)} টি
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-2">
          {filters}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              type="search"
              name={searchName}
              defaultValue={searchValue}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-10 w-56 rounded-[--radius-control] border border-ink-200 bg-white pe-3 ps-9 text-sm focus-visible:outline-2 focus-visible:outline-brand-700"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-[--radius-control] bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
          >
            ফিল্টার
          </button>
        </form>
      </header>

      <div className="overflow-x-auto">{children}</div>

      {totalPages > 1 ? (
        <footer className="flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-4 text-sm">
          <span className="text-ink-500">
            পৃষ্ঠা {toBanglaDigits(page)} / {toBanglaDigits(totalPages)}
          </span>
          <div className="flex gap-2">
            <PagerLink href={buildHref(page - 1)} disabled={page <= 1}>
              আগের
            </PagerLink>
            <PagerLink href={buildHref(page + 1)} disabled={page >= totalPages}>
              পরের
            </PagerLink>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "rounded-[--radius-control] border border-ink-200 px-3 py-1.5 font-medium text-ink-700 hover:bg-ink-50",
    disabled && "pointer-events-none opacity-40",
  );
  return disabled ? (
    <span className={className} aria-disabled="true">
      {children}
    </span>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide text-ink-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-5 py-3.5 align-middle text-sm", className)}>{children}</td>;
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-ink-100 bg-ink-50">
      <tr>{children}</tr>
    </thead>
  );
}
