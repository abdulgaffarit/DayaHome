"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setZoneEnabledAction, updateZoneAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Zone configuration.
 *
 * Every value here is operator-set: nothing about a zone is hardcoded in the
 * application, which is what lets placements be re-priced or switched off
 * without a deploy.
 */
export function ZoneControls({
  zoneId,
  basePriceBdt,
  maxActiveAds,
  priority,
  isEnabled,
  activeCampaigns,
}: {
  zoneId: string;
  basePriceBdt: number;
  maxActiveAds: number;
  priority: number;
  isEnabled: boolean;
  activeCampaigns: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [price, setPrice] = React.useState(String(basePriceBdt));
  const [slots, setSlots] = React.useState(String(maxActiveAds));
  const [weight, setWeight] = React.useState(String(priority));

  function save(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("zoneId", zoneId);
    formData.set("basePriceBdt", price);
    formData.set("maxActiveAds", slots);
    formData.set("priority", weight);

    startTransition(async () => {
      const result = await updateZoneAction(formData);
      toast.show(result.ok ? "জোন হালনাগাদ হয়েছে।" : result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  }

  function toggle() {
    const formData = new FormData();
    formData.set("zoneId", zoneId);
    formData.set("enabled", isEnabled ? "0" : "1");

    startTransition(async () => {
      const result = await setZoneEnabledAction(formData);
      toast.show(result.ok ? "সংরক্ষিত হয়েছে।" : result.message, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
      <NumberInput label="ভিত্তি দাম (৳)" value={price} onChange={setPrice} />
      <NumberInput label="সর্বোচ্চ বিজ্ঞাপন" value={slots} onChange={setSlots} min={1} />
      <NumberInput label="অগ্রাধিকার" value={weight} onChange={setWeight} />

      <Button type="submit" size="sm" disabled={pending}>
        সংরক্ষণ
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={toggle}>
        {isEnabled ? "বন্ধ করুন" : "চালু করুন"}
      </Button>

      {isEnabled && activeCampaigns > 0 ? (
        <span className="text-xs text-ink-500">
          এখন {toBanglaDigits(activeCampaigns)}টি চলমান
        </span>
      ) : null}
    </form>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
}) {
  return (
    <label className="text-xs text-ink-500">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-28 rounded-[--radius-control] border border-ink-200 px-2 py-1.5 text-sm text-ink-900"
      />
    </label>
  );
}
