import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Wordmark. The house glyph is inline SVG rather than an image file so it
 * inherits the text colour and costs no extra request.
 */
export function Logo({
  className,
  showTagline = true,
}: {
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn("group flex items-center gap-2.5 rounded-lg", className)}
      aria-label="dayarampur.com — হোমপেজ"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition-colors group-hover:bg-brand-800">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
          <path
            d="M3 10.5 12 3l9 7.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M5.5 9.5V20h13V9.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M10 20v-5.5h4V20" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[1.05rem] font-bold leading-tight tracking-tight text-ink-900">
          dayarampur<span className="text-brand-700">.com</span>
        </span>
        {showTagline ? (
          <span className="block truncate text-xs leading-tight text-ink-500">
            দয়ারামপুরের নিজের ঠিকানা
          </span>
        ) : null}
      </span>
    </Link>
  );
}
