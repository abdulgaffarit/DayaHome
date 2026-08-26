"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";

/**
 * Save/unsave a listing.
 *
 * Optimistic: the heart fills immediately and reverts if the request fails.
 * A 401 sends the visitor to login rather than silently doing nothing.
 */
export function FavoriteButton({
  propertyId,
  initialSaved = false,
  className,
  variant = "overlay",
}: {
  propertyId: string;
  initialSaved?: boolean;
  className?: string;
  variant?: "overlay" | "inline";
}) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = React.useState(initialSaved);
  const [pending, setPending] = React.useState(false);

  async function toggle(event: React.MouseEvent) {
    // The card is wrapped in a link; keep the click here.
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;

    const next = !saved;
    setSaved(next);
    setPending(true);

    try {
      const response = await fetch(
        next ? "/api/favorites" : `/api/favorites/${encodeURIComponent(propertyId)}`,
        {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: next ? JSON.stringify({ propertyId }) : undefined,
        },
      );

      if (response.status === 401) {
        setSaved(!next);
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      toast.show(next ? "পছন্দের তালিকায় যোগ হয়েছে" : "পছন্দের তালিকা থেকে সরানো হয়েছে", "success");
      router.refresh();
    } catch {
      setSaved(!next);
      toast.show("সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "পছন্দের তালিকা থেকে সরান" : "পছন্দের তালিকায় যোগ করুন"}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-colors",
        variant === "overlay"
          ? "h-9 w-9 bg-white/90 text-ink-600 shadow-sm backdrop-blur hover:bg-white hover:text-danger-500"
          : "h-11 w-11 border border-ink-200 bg-white text-ink-600 hover:border-danger-500 hover:text-danger-500",
        saved && "text-danger-500",
        className,
      )}
    >
      <Heart className={cn("h-[1.15rem] w-[1.15rem]", saved && "fill-current")} aria-hidden="true" />
    </button>
  );
}
