import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";

export const metadata: Metadata = {
  title: "কীভাবে কাজ করে",
  description:
    "dayarampur.com কীভাবে কাজ করে — বিজ্ঞাপন দেওয়া বিনামূল্যে, যোগাযোগের তথ্য দেখতে ৳৫০।",
  alternates: { canonical: "/how-it-works" },
};

const RENTER_STEPS = [
  { title: "খুঁজুন", body: "ক্যাটাগরি, এলাকা ও ভাড়া অনুযায়ী দয়ারামপুরের বিজ্ঞাপন দেখুন।" },
  { title: "বিস্তারিত দেখুন", body: "ছবি, দাম, রুম সংখ্যা, সুবিধা — সবই বিনামূল্যে দেখা যায়।" },
  { title: "৳৫০ পেমেন্ট করুন", body: "পছন্দ হলে শুধু সেই বিজ্ঞাপনের জন্য একবার ৳৫০ দিন।" },
  { title: "যোগাযোগ করুন", body: "মালিকের ফোন নম্বর ও সঠিক ঠিকানা দেখে সরাসরি কথা বলুন।" },
];

const OWNER_STEPS = [
  { title: "রেজিস্টার করুন", body: "মোবাইল নম্বর দিয়ে কয়েক সেকেন্ডে অ্যাকাউন্ট খুলুন।" },
  { title: "বিজ্ঞাপন দিন", body: "ছবি, দাম ও বিবরণ দিয়ে বিজ্ঞাপন জমা দিন — সম্পূর্ণ বিনামূল্যে।" },
  { title: "অনুমোদনের অপেক্ষা", body: "আমাদের টিম যাচাই করে অনুমোদন দেয়, তারপর বিজ্ঞাপন সাইটে আসে।" },
  { title: "আগ্রহীদের ফোন পান", body: "যারা সত্যিই আগ্রহী তারাই ফোন করবেন — অপ্রয়োজনীয় কল কমে যাবে।" },
];

export default function HowItWorksPage() {
  return (
    <div className="container-page max-w-4xl py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
        কীভাবে কাজ করে
      </h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink-600">
        dayarampur.com দয়ারামপুরের বাসা, দোকান, অফিস ও জমির বিজ্ঞাপনের জায়গা।
        মালিকদের জন্য বিজ্ঞাপন দেওয়া সম্পূর্ণ বিনামূল্যে; শুধু যোগাযোগের তথ্য
        দেখতে চাইলে ৳{toBanglaDigits(50)} লাগে।
      </p>

      <StepSection title="যারা বাসা খুঁজছেন" steps={RENTER_STEPS} />
      <StepSection title="যারা বিজ্ঞাপন দিতে চান" steps={OWNER_STEPS} />

      <section className="mt-12 rounded-[--radius-card] border border-ink-100 bg-surface-soft p-6">
        <h2 className="text-lg font-semibold text-ink-900">
          ৳{toBanglaDigits(50)} কেন নেওয়া হয়?
        </h2>
        <p className="mt-2 leading-relaxed text-ink-700">
          মালিকের নম্বর সবার জন্য উন্মুক্ত থাকলে অসংখ্য অপ্রয়োজনীয় ফোন আসে এবং
          দালালরা নম্বর সংগ্রহ করে নেয়। ছোট্ট একটি ফি থাকায় শুধু সত্যিকারের
          আগ্রহীরাই যোগাযোগ করেন — মালিক ও ভাড়াটিয়া দুজনেরই সময় বাঁচে।
          একটি বিজ্ঞাপনের জন্য একবারই টাকা লাগে; পরে যতবার খুশি সেই তথ্য দেখা যায়।
        </p>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/basha-vhara" className={buttonVariants({})}>
          বাসা খুঁজুন
        </Link>
        <Link href="/post-ad" className={buttonVariants({ variant: "outline" })}>
          বিজ্ঞাপন দিন
        </Link>
      </div>
    </div>
  );
}

function StepSection({
  title,
  steps,
}: {
  title: string;
  steps: { title: string; body: string }[];
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-[--radius-card] border border-ink-100 bg-white p-5"
          >
            <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">
              {toBanglaDigits(index + 1)}
            </span>
            <h3 className="font-semibold text-ink-900">{step.title}</h3>
            <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
