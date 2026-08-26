"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { PropertyStatus } from "@/domain/enums";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * Owner-side status actions.
 *
 * Note what is absent: there is no "approve" action. An owner can pause,
 * resume a previously approved listing, mark it rented/sold or archive it —
 * publishing is an admin decision, and the server enforces that regardless of
 * what this menu offers.
 */
export function OwnerPropertyActions({
  propertyId,
  status,
  title,
}: {
  propertyId: string;
  status: PropertyStatus;
  title: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function call(action: string, body: Record<string, unknown> = {}) {
    setPending(true);
    try {
      const response = await fetch(`/api/dashboard/properties/${encodeURIComponent(propertyId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: { message?: string } };
        toast.show(data.error?.message ?? "কাজটি সম্পন্ন হয়নি।", "error");
        return;
      }
      toast.show("সম্পন্ন হয়েছে।", "success");
      router.refresh();
    } catch {
      toast.show("কাজটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setPending(false);
      setConfirmArchive(false);
    }
  }

  const canPause = status === "APPROVED";
  const canResume = status === "PAUSED";
  const canClose = status === "APPROVED" || status === "PAUSED";
  const canRenew = status === "EXPIRED";

  return (
    <>
      <details className="relative">
        <summary
          className="inline-flex h-9 cursor-pointer list-none items-center justify-center gap-1.5 rounded-[--radius-control] border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50"
          aria-label={`${title} — আরও অপশন`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </summary>
        <ul className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-[--radius-control] border border-ink-100 bg-white py-1 shadow-[--shadow-pop]">
          {canPause ? (
            <MenuButton onClick={() => call("pause")} disabled={pending}>
              সাময়িকভাবে বন্ধ করুন
            </MenuButton>
          ) : null}
          {canResume ? (
            <MenuButton onClick={() => call("resume")} disabled={pending}>
              আবার চালু করুন
            </MenuButton>
          ) : null}
          {canClose ? (
            <>
              <MenuButton onClick={() => call("rented")} disabled={pending}>
                ভাড়া হয়ে গেছে
              </MenuButton>
              <MenuButton onClick={() => call("sold")} disabled={pending}>
                বিক্রি হয়ে গেছে
              </MenuButton>
            </>
          ) : null}
          {canRenew ? (
            <MenuButton onClick={() => call("renew")} disabled={pending}>
              মেয়াদ বাড়ান
            </MenuButton>
          ) : null}
          <MenuButton
            onClick={() => setConfirmArchive(true)}
            disabled={pending}
            tone="danger"
          >
            বিজ্ঞাপন সরান
          </MenuButton>
        </ul>
      </details>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="বিজ্ঞাপন সরাবেন?"
        description={title}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>
              বাতিল
            </Button>
            <Button variant="danger" loading={pending} onClick={() => call("archive")}>
              হ্যাঁ, সরান
            </Button>
          </>
        }
      >
        <p className="text-ink-700">
          বিজ্ঞাপনটি সাইট থেকে সরিয়ে ফেলা হবে।{" "}
          <strong className="font-semibold">এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।</strong>
        </p>
      </Modal>
    </>
  );
}

function MenuButton({
  onClick,
  disabled,
  tone,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={
          "block w-full px-4 py-2.5 text-start text-sm transition-colors disabled:opacity-50 " +
          (tone === "danger"
            ? "text-danger-700 hover:bg-danger-50"
            : "text-ink-700 hover:bg-surface-mint")
        }
      >
        {children}
      </button>
    </li>
  );
}
