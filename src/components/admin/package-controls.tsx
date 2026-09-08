"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { updatePackageAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Package pricing and duration.
 *
 * Changing these sets what is on sale from now on. Campaigns already bought
 * keep the price and duration copied onto their own row at purchase, so an
 * advertiser is never re-charged by an edit made after the fact.
 */
export function PackageControls({
  packageId,
  priceBdt,
  durationDays,
  isActive,
}: {
  packageId: string;
  priceBdt: number;
  durationDays: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [price, setPrice] = React.useState(String(priceBdt));
  const [days, setDays] = React.useState(String(durationDays));
  const [active, setActive] = React.useState(isActive);

  function save(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("packageId", packageId);
    formData.set("priceBdt", price);
    formData.set("durationDays", days);
    formData.set("isActive", active ? "1" : "0");

    startTransition(async () => {
      const result = await updatePackageAction(formData);
      toast.show(
        result.ok ? "প্যাকেজ হালনাগাদ হয়েছে।" : result.message,
        result.ok ? "success" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-xs text-ink-500">
        দাম (৳)
        <input
          type="number"
          min={0}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          className="mt-1 block w-28 rounded-[--radius-control] border border-ink-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs text-ink-500">
        মেয়াদ (দিন)
        <input
          type="number"
          min={1}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="mt-1 block w-28 rounded-[--radius-control] border border-ink-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="h-4 w-4"
        />
        বিক্রির জন্য চালু
      </label>

      <Button type="submit" size="sm" disabled={pending}>
        সংরক্ষণ
      </Button>
    </form>
  );
}
