"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

export interface PromotionPlan {
  id: string;
  payment_type: "FEATURED_PROPERTY" | "PROPERTY_BOOST";
  label_bn: string;
  duration_days: number;
  price_bdt: number;
}

/**
 * Buys a featured placement or a boost for one of the owner's listings.
 *
 * The client sends only a property id and a plan id. Price and duration come
 * from the plan row on the server, so there is nothing here for a tampered
 * request to change.
 */
export function PromoteProperty({
  propertyId,
  plans,
  featuredUntil,
  boostedUntil,
}: {
  propertyId: string;
  plans: PromotionPlan[];
  featuredUntil: string | null;
  boostedUntil: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [manual, setManual] = React.useState<{ instructionsBn: string; reference: string }>();

  const featured = plans.filter((p) => p.payment_type === "FEATURED_PROPERTY");
  const boost = plans.filter((p) => p.payment_type === "PROPERTY_BOOST");

  async function purchase(planId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/properties/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, planId }),
      });
      const data = (await response.json()) as {
        manual?: boolean;
        redirectUrl?: string;
        instructionsBn?: string;
        reference?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        toast.show(data.error?.message ?? "পেমেন্ট শুরু করা যায়নি।", "error");
        return;
      }
      if (data.manual) {
        setManual({
          instructionsBn: data.instructionsBn ?? "",
          reference: data.reference ?? "",
        });
        router.refresh();
        return;
      }
      window.location.href = data.redirectUrl!;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        প্রমোট করুন
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="বিজ্ঞাপন প্রমোট করুন">
        {manual ? (
          <div className="rounded-[--radius-card] border border-brand-200 bg-surface-mint p-4">
            <p className="font-medium text-ink-900">{manual.instructionsBn}</p>
            <p className="mt-2 text-sm text-ink-700">
              রেফারেন্স: <strong className="font-mono">{manual.reference}</strong>
            </p>
            <p className="mt-2 text-sm text-ink-600">
              অ্যাডমিন যাচাই করার পর প্রমোশন চালু হবে।
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <Section
              icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              title="ফিচার্ড"
              body="তালিকার একদম উপরে দেখানো হবে এবং একটি ব্যাজ যুক্ত হবে।"
              activeUntil={featuredUntil}
              plans={featured}
              busy={busy}
              onBuy={purchase}
            />
            <Section
              icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
              title="বুস্ট"
              body="সাধারণ বিজ্ঞাপনের চেয়ে উপরে দেখানো হবে।"
              activeUntil={boostedUntil}
              plans={boost}
              busy={busy}
              onBuy={purchase}
            />
          </div>
        )}
      </Modal>
    </>
  );
}

function Section({
  icon,
  title,
  body,
  activeUntil,
  plans,
  busy,
  onBuy,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  activeUntil: string | null;
  plans: PromotionPlan[];
  busy: boolean;
  onBuy: (planId: string) => void;
}) {
  // `activeUntil` is already filtered to a live window by the server, so its
  // mere presence is the answer — no clock reading during render.
  return (
    <section>
      <h3 className="flex items-center gap-2 font-semibold text-ink-900">
        {icon}
        {title}
      </h3>
      <p className="mt-1 text-sm text-ink-600">{body}</p>

      {activeUntil ? (
        <p className="mt-2 rounded-[--radius-control] bg-success-50 px-3 py-1.5 text-sm text-success-800">
          চালু আছে — {toBanglaDigits(activeUntil.slice(0, 10))} পর্যন্ত। আবার কিনলে মেয়াদ যোগ হবে।
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            disabled={busy}
            onClick={() => onBuy(plan.id)}
            className={cn(
              "rounded-[--radius-control] border border-ink-200 px-3 py-2 text-sm transition-colors",
              "hover:border-brand-500 disabled:opacity-50",
            )}
          >
            <span className="block font-medium text-ink-900">
              {toBanglaDigits(plan.duration_days)} দিন
            </span>
            <span className="block text-brand-700">{formatTaka(plan.price_bdt)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
