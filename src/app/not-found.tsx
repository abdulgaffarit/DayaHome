import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-mint text-brand-700">
        <SearchX className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-brand-700">৪০৪</p>
      <h1 className="mt-2 text-2xl font-bold text-ink-900 sm:text-3xl">
        পেজটি পাওয়া যায়নি
      </h1>
      <p className="mt-3 max-w-md text-ink-600">
        আপনি যে পেজটি খুঁজছেন সেটি সরানো হয়েছে, অথবা ঠিকানাটি ভুল। নিচের লিংক
        থেকে আবার শুরু করুন।
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonVariants({})}>
          হোমপেজে যান
        </Link>
        <Link href="/basha-vhara" className={buttonVariants({ variant: "outline" })}>
          বাসা ভাড়া দেখুন
        </Link>
      </div>
    </div>
  );
}
