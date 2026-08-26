"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { REPORT_REASONS, type ReportReason } from "@/domain/enums";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const REASON_LABEL_BN: Record<ReportReason, string> = {
  FAKE_PROPERTY: "ভুয়া বিজ্ঞাপন",
  WRONG_PRICE: "দাম ভুল",
  WRONG_INFORMATION: "তথ্য ভুল",
  WRONG_LOCATION: "লোকেশন ভুল",
  SCAM: "প্রতারণা",
  DUPLICATE: "একই বিজ্ঞাপন একাধিকবার",
  ALREADY_RENTED: "ইতিমধ্যে ভাড়া/বিক্রি হয়ে গেছে",
  OTHER: "অন্যান্য",
};

export function ReportDialog({
  propertyId,
  isAuthenticated,
}: {
  propertyId: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          reason: data.get("reason"),
          details: data.get("details"),
        }),
      });
      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        toast.show(body.error?.message ?? "রিপোর্ট পাঠানো যায়নি।", "error");
        return;
      }
      toast.show("ধন্যবাদ। রিপোর্টটি পর্যালোচনা করা হবে।", "success");
      setOpen(false);
    } catch {
      toast.show("রিপোর্ট পাঠানো যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!isAuthenticated) {
            router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
            return;
          }
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-danger-500"
      >
        <Flag className="h-4 w-4" aria-hidden="true" />
        এই বিজ্ঞাপনটি রিপোর্ট করুন
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="বিজ্ঞাপন রিপোর্ট করুন"
        description="সমস্যাটি জানালে আমরা দ্রুত ব্যবস্থা নিতে পারব।"
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="কারণ" htmlFor="report-reason" required>
            <Select id="report-reason" name="reason" required defaultValue="">
              <option value="" disabled>
                একটি কারণ বেছে নিন
              </option>
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REASON_LABEL_BN[reason]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="বিস্তারিত" htmlFor="report-details" hint="ঐচ্ছিক">
            <Textarea
              id="report-details"
              name="details"
              maxLength={1000}
              placeholder="কী সমস্যা দেখেছেন সংক্ষেপে লিখুন…"
            />
          </Field>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              বাতিল
            </Button>
            <Button type="submit" loading={pending}>
              রিপোর্ট পাঠান
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
