"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Users see a Bangla message and a way forward — never a stack trace. The real
 * error is logged server-side; `digest` is the only identifier surfaced, so
 * support can correlate a report with the log entry.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">কিছু একটা ভুল হয়েছে</h1>
      <p className="mt-3 max-w-md text-ink-600">
        সাময়িক সমস্যার কারণে পেজটি দেখানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।
      </p>
      {error.digest ? (
        <p className="mt-4 rounded-[--radius-control] bg-ink-50 px-3 py-1.5 font-mono text-xs text-ink-500">
          রেফারেন্স: {error.digest}
        </p>
      ) : null}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>আবার চেষ্টা করুন</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          হোমপেজ
        </Link>
      </div>
    </div>
  );
}
