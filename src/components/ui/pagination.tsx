import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

/**
 * Server-rendered pagination.
 *
 * Real `<a href>` links rather than buttons, so results are crawlable and
 * middle-clickable. `rel=prev/next` helps search engines understand the series.
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
  className,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);

  return (
    <nav aria-label="পৃষ্ঠা নেভিগেশন" className={cn("flex items-center justify-center gap-1.5", className)}>
      <PageLink
        href={buildHref(page - 1)}
        disabled={page <= 1}
        rel="prev"
        aria-label="আগের পৃষ্ঠা"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </PageLink>

      {pages.map((entry, index) =>
        entry === "gap" ? (
          <span key={`gap-${index}`} className="px-2 text-ink-400" aria-hidden="true">
            …
          </span>
        ) : (
          <PageLink
            key={entry}
            href={buildHref(entry)}
            current={entry === page}
            aria-label={`পৃষ্ঠা ${toBanglaDigits(entry)}`}
            aria-current={entry === page ? "page" : undefined}
          >
            {toBanglaDigits(entry)}
          </PageLink>
        ),
      )}

      <PageLink
        href={buildHref(page + 1)}
        disabled={page >= totalPages}
        rel="next"
        aria-label="পরের পৃষ্ঠা"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  current,
  children,
  ...props
}: {
  href: string;
  disabled?: boolean;
  current?: boolean;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "children">) {
  const className = cn(
    "inline-flex h-10 min-w-10 items-center justify-center rounded-[--radius-control] px-3 text-sm font-medium transition-colors",
    current
      ? "bg-brand-700 text-white"
      : "border border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
    disabled && "pointer-events-none opacity-40",
  );

  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...props}>
      {children}
    </Link>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  const window = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => window.add(p));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => window.add(p));

  const sorted = [...window].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("gap");
    out.push(p);
    previous = p;
  }
  return out;
}
