"use client";

import * as React from "react";
import { MapPin, Phone } from "lucide-react";
import type { ContactResponse } from "@/domain/property";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Fetches the unlocked contact details for one property on demand.
 *
 * The server re-verifies the unlock on every call; this component holds no
 * credential of its own and caches nothing beyond the current page view.
 */
export function RevealContact({ propertyId }: { propertyId: string }) {
  const toast = useToast();
  const [contact, setContact] = React.useState<Extract<ContactResponse, { locked: false }> | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);

  async function reveal() {
    setLoading(true);
    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/contact`);
      const data = (await response.json()) as ContactResponse;
      if ("locked" in data && data.locked === false) {
        setContact(data);
        return;
      }
      toast.show("তথ্যটি এখন আর দেখা যাচ্ছে না। সহায়তার জন্য যোগাযোগ করুন।", "error");
    } catch {
      toast.show("তথ্য আনা যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setLoading(false);
    }
  }

  if (!contact) {
    return (
      <Button size="sm" variant="outline" className="mt-3" loading={loading} onClick={reveal}>
        যোগাযোগের তথ্য দেখুন
      </Button>
    );
  }

  return (
    <dl className="mt-3 space-y-1.5 rounded-[--radius-control] bg-surface-soft px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-brand-600" aria-hidden="true" />
        <dt className="sr-only">ফোন</dt>
        <dd>
          <a href={`tel:${contact.phone}`} className="font-semibold text-brand-700 hover:underline">
            {contact.phone}
          </a>
        </dd>
      </div>
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
        <dt className="sr-only">ঠিকানা</dt>
        <dd className="text-ink-700">{contact.exactLocation}</dd>
      </div>
    </dl>
  );
}
