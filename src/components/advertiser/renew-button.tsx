"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Starts a renewal.
 *
 * The server creates a NEW campaign in DRAFT at today's price; this only sends
 * the advertiser to it. Nothing goes live without payment and review.
 */
export function RenewButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function renew() {
    setBusy(true);
    try {
      const response = await fetch(`/api/advertise/campaigns/${campaignId}/renew`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        campaignId?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        toast.show(data.error?.message ?? "নবায়ন করা যায়নি।", "error");
        return;
      }
      toast.show("নবায়নের জন্য নতুন ক্যাম্পেইন তৈরি হয়েছে।", "success");
      router.push(`/advertiser/campaigns/${data.campaignId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" disabled={busy} onClick={() => void renew()}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      নবায়ন করুন
    </Button>
  );
}
