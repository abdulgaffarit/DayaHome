"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { rejectCampaignAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const PRESETS = [
  "ব্যানারের মান যথেষ্ট ভালো নয় — স্পষ্ট ছবি দিন।",
  "বিজ্ঞাপনের বিষয়বস্তু আমাদের নীতিমালার সাথে সামঞ্জস্যপূর্ণ নয়।",
  "লিংকটি কাজ করছে না বা ভুল পেজে নিয়ে যাচ্ছে।",
  "ব্যানারে দেওয়া তথ্য যাচাই করা যায়নি।",
  "ব্যানারের মাপ এই জোনের জন্য উপযুক্ত নয়।",
];

/**
 * Rejection requires a written reason.
 *
 * The advertiser sees this text on their dashboard, so a one-word dismissal
 * would leave them unable to fix anything. Enforced three times over: here,
 * in the Server Action, and by a CHECK constraint on the table.
 */
export function RejectCampaignForm({
  campaignId,
  title,
}: {
  campaignId: string;
  title: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("campaignId", campaignId);
    formData.set("reason", reason.trim());

    startTransition(async () => {
      const result = await rejectCampaignAction(formData);
      if (result.ok) {
        toast.show("ক্যাম্পেইনটি প্রত্যাখ্যান করা হয়েছে।", "success");
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
    });
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <XCircle className="h-4 w-4" aria-hidden="true" />
        প্রত্যাখ্যান
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`প্রত্যাখ্যান — ${title}`}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="কারণ" htmlFor="reason" required hint="বিজ্ঞাপনদাতা এটি দেখতে পাবেন।">
            <Textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={5}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:border-ink-300"
              >
                {preset.slice(0, 28)}…
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button type="submit" variant="danger" disabled={pending || reason.trim().length < 5}>
              প্রত্যাখ্যান করুন
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
