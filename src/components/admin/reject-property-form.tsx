"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { rejectPropertyAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const PRESETS = [
  "ছবিগুলো স্পষ্ট নয় — পরিষ্কার ছবি যুক্ত করুন।",
  "বিবরণে যথেষ্ট তথ্য নেই।",
  "দেওয়া দাম বাস্তবসম্মত মনে হচ্ছে না।",
  "ঠিকানা বা লোকেশনের তথ্য অসম্পূর্ণ।",
  "যোগাযোগের নম্বরটি যাচাই করা যায়নি।",
];

/**
 * Rejection requires a written reason, which the owner sees on their dashboard
 * and in a notification. The presets exist so a busy moderator still leaves
 * something actionable rather than a one-word dismissal.
 */
export function RejectPropertyForm({ propertyId, title }: { propertyId: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("propertyId", propertyId);
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await rejectPropertyAction(formData);
      if (result.ok) {
        toast.show("বিজ্ঞাপনটি প্রত্যাখ্যান করা হয়েছে।", "success");
        setOpen(false);
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <XCircle className="h-4 w-4" aria-hidden="true" />
        প্রত্যাখ্যান
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="বিজ্ঞাপন প্রত্যাখ্যান"
        description={title}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="প্রত্যাখ্যানের কারণ"
            htmlFor="reject-reason"
            required
            hint="মালিক এই কারণটি দেখতে পাবেন, তাই স্পষ্ট করে লিখুন।"
          >
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              required
              className="min-h-28"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className="rounded-[--radius-pill] border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:border-brand-300 hover:bg-surface-mint"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              প্রত্যাখ্যান করুন
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
