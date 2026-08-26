import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentResult } from "@/components/property/payment-result";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "পেমেন্টের ফলাফল",
  robots: NOINDEX,
};

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "pending";
  const transactionId = typeof params.tran === "string" ? params.tran : null;

  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-12">
      <Suspense fallback={null}>
        <PaymentResult status={status} transactionId={transactionId} />
      </Suspense>
    </div>
  );
}
