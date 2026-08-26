import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { BadgeCheck, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PropertyStatus } from "@/domain/enums";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[--radius-pill] px-2.5 py-0.5 text-xs font-medium leading-6",
  {
    variants: {
      tone: {
        brand: "bg-brand-700 text-white",
        soft: "bg-surface-mint text-brand-900",
        neutral: "bg-ink-100 text-ink-700",
        gold: "bg-gold-100 text-gold-700",
        danger: "bg-danger-50 text-danger-700",
        info: "bg-info-50 text-info-500",
        outline: "border border-ink-200 bg-white/90 text-ink-700 backdrop-blur-sm",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Listing status shown to owners and admins. Public cards only ever see APPROVED. */
const STATUS_LABEL_BN: Record<PropertyStatus, { label: string; tone: "brand" | "soft" | "neutral" | "gold" | "danger" | "info" }> = {
  DRAFT: { label: "খসড়া", tone: "neutral" },
  PENDING: { label: "অনুমোদনের অপেক্ষায়", tone: "gold" },
  APPROVED: { label: "খালি আছে", tone: "brand" },
  REJECTED: { label: "প্রত্যাখ্যাত", tone: "danger" },
  PAUSED: { label: "সাময়িক বন্ধ", tone: "neutral" },
  RENTED: { label: "ভাড়া হয়ে গেছে", tone: "neutral" },
  SOLD: { label: "বিক্রি হয়ে গেছে", tone: "neutral" },
  EXPIRED: { label: "মেয়াদ শেষ", tone: "neutral" },
  ARCHIVED: { label: "সরানো হয়েছে", tone: "neutral" },
};

export function StatusBadge({ status, className }: { status: PropertyStatus; className?: string }) {
  const config = STATUS_LABEL_BN[status];
  return (
    <Badge tone={config.tone} className={className}>
      {config.label}
    </Badge>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="soft" className={className}>
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
      যাচাইকৃত
    </Badge>
  );
}

export function FeaturedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="gold" className={className}>
      <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      ফিচার্ড
    </Badge>
  );
}
