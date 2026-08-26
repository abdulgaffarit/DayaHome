"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { refundPaymentAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Records a refund that was already issued in the gateway's merchant panel.
 *
 * The wording is deliberate: this does NOT move money. It marks our ledger and
 * revokes the unlock the payment bought, and it demands the gateway's own
 * refund reference so the two records can be reconciled later.
 */
export function RefundForm({ paymentId, amount }: { paymentId: string; amount: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [reference, setReference] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("paymentId", paymentId);
    formData.set("refundRef", reference);

    startTransition(async () => {
      const result = await refundPaymentAction(formData);
      if (result.ok) {
        toast.show("রিফান্ড রেকর্ড করা হয়েছে এবং আনলক বাতিল হয়েছে।", "success");
        setOpen(false);
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        রিফান্ড
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="রিফান্ড রেকর্ড করুন"
        description={`৳${toBanglaDigits(amount)} — এই লেনদেনের জন্য`}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-[--radius-control] bg-gold-100 p-3 text-sm leading-relaxed text-gold-700">
            এই ফর্মটি টাকা ফেরত পাঠায় না। SSLCOMMERZ মার্চেন্ট প্যানেল থেকে
            রিফান্ড সম্পন্ন করার পর সেখানকার রেফারেন্স নম্বরটি এখানে লিখুন।
            রেকর্ড করলে ব্যবহারকারীর আনলক বাতিল হয়ে যাবে।
          </div>

          <Field label="গেটওয়ে রিফান্ড রেফারেন্স" htmlFor="refund-ref" required>
            <Input
              id="refund-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
              minLength={3}
            />
          </Field>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              রেকর্ড করুন
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
