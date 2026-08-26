import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "অনুমতি নেই", robots: NOINDEX };

export default function ForbiddenPage() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <ShieldAlert className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-danger-700">৪০৩</p>
      <h1 className="mt-2 text-2xl font-bold text-ink-900 sm:text-3xl">
        এই পাতায় প্রবেশের অনুমতি নেই
      </h1>
      <p className="mt-3 max-w-md text-ink-600">
        আপনার অ্যাকাউন্টের জন্য এই অংশটি উন্মুক্ত নয়। ভুল মনে হলে সহায়তার সাথে
        যোগাযোগ করুন।
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className={buttonVariants({})}>
          ড্যাশবোর্ডে যান
        </Link>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          হোমপেজ
        </Link>
      </div>
    </div>
  );
}
