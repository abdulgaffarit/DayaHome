"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Post-gateway landing page.
 *
 * The `status` in the URL is only a hint about which message to show first.
 * When it says "pending" — the return leg arrived before the IPN settled — the
 * page polls `/api/payments/status`, which reads the authoritative payment row.
 * The success message is shown only once that endpoint reports PAID.
 */
export function PaymentResult({
  status,
  transactionId,
}: {
  status: string;
  transactionId: string | null;
}) {
  const [resolved, setResolved] = React.useState(status);
  const [propertySlug, setPropertySlug] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (resolved !== "pending" || !transactionId) return;

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/payments/status?tran=${encodeURIComponent(transactionId!)}`,
        );
        if (response.ok) {
          const data = (await response.json()) as { status: string; propertySlug: string };
          if (data.status === "PAID") {
            setPropertySlug(data.propertySlug);
            setResolved("paid");
            return;
          }
          if (data.status === "FAILED" || data.status === "CANCELLED") {
            setResolved(data.status.toLowerCase());
            return;
          }
        }
      } catch {
        // Keep waiting; a transient network error is not a payment failure.
      }
      // Back off, and give up after roughly a minute rather than polling forever.
      if (attempts < 10) timer = setTimeout(poll, Math.min(2000 * attempts, 8000));
    }

    timer = setTimeout(poll, 1500);
    return () => clearTimeout(timer);
  }, [resolved, transactionId]);

  if (resolved === "paid") {
    return (
      <ResultCard
        tone="success"
        icon={<CheckCircle2 className="h-7 w-7" aria-hidden="true" />}
        title="পেমেন্ট সফল হয়েছে"
        description="ধন্যবাদ! এখন আপনি এই বিজ্ঞাপনের মালিকের ফোন নম্বর ও সঠিক লোকেশন দেখতে পারবেন।"
        transactionId={transactionId}
        primary={
          propertySlug
            ? { href: `/property/${propertySlug}`, label: "যোগাযোগের তথ্য দেখুন" }
            : { href: "/dashboard/unlocked", label: "আনলক করা বিজ্ঞাপন দেখুন" }
        }
      />
    );
  }

  if (resolved === "cancelled") {
    return (
      <ResultCard
        tone="neutral"
        icon={<XCircle className="h-7 w-7" aria-hidden="true" />}
        title="পেমেন্ট বাতিল করা হয়েছে"
        description="আপনার কোনো টাকা কাটা হয়নি। চাইলে আবার চেষ্টা করতে পারেন।"
        transactionId={transactionId}
        primary={{ href: "/", label: "হোমপেজে যান" }}
      />
    );
  }

  if (resolved === "failed") {
    return (
      <ResultCard
        tone="error"
        icon={<AlertCircle className="h-7 w-7" aria-hidden="true" />}
        title="পেমেন্ট সম্পন্ন হয়নি"
        description="লেনদেনটি সফল হয়নি। টাকা কেটে থাকলে তা স্বয়ংক্রিয়ভাবে ফেরত যাবে। আবার চেষ্টা করুন।"
        transactionId={transactionId}
        primary={{ href: "/dashboard/payments", label: "পেমেন্ট হিস্ট্রি দেখুন" }}
      />
    );
  }

  return (
    <ResultCard
      tone="neutral"
      icon={<Clock className="h-7 w-7 animate-pulse" aria-hidden="true" />}
      title="পেমেন্ট যাচাই করা হচ্ছে…"
      description="ব্যাংক থেকে নিশ্চিতকরণ আসতে কয়েক সেকেন্ড সময় লাগতে পারে। এই পেজটি বন্ধ করবেন না।"
      transactionId={transactionId}
      primary={{ href: "/dashboard/payments", label: "পেমেন্ট হিস্ট্রি দেখুন" }}
    />
  );
}

function ResultCard({
  tone,
  icon,
  title,
  description,
  transactionId,
  primary,
}: {
  tone: "success" | "error" | "neutral";
  icon: React.ReactNode;
  title: string;
  description: string;
  transactionId: string | null;
  primary: { href: string; label: string };
}) {
  const toneClass =
    tone === "success"
      ? "bg-surface-mint text-brand-700"
      : tone === "error"
        ? "bg-danger-50 text-danger-700"
        : "bg-ink-100 text-ink-600";

  return (
    <div className="w-full max-w-md rounded-[--radius-card] border border-ink-100 bg-white p-8 text-center shadow-[--shadow-card]">
      <span className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${toneClass}`}>
        {icon}
      </span>
      <h1 className="text-xl font-bold text-ink-900">{title}</h1>
      <p className="mt-3 leading-relaxed text-ink-600">{description}</p>

      {transactionId ? (
        <p className="mt-5 rounded-[--radius-control] bg-ink-50 px-4 py-2.5 text-xs text-ink-500">
          ট্রানজেকশন আইডি: <span className="font-mono text-ink-700">{transactionId}</span>
        </p>
      ) : null}

      <Link href={primary.href} className={buttonVariants({ full: true, className: "mt-6" })}>
        {primary.label}
      </Link>
    </div>
  );
}
